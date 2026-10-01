import { BALANCE } from '../balance/config';
import type { EffectSink } from '../domain/effects';
import type { GameState } from '../domain/state';
import { absoluteRound, nextId } from '../domain/state';
import type { Club, ClubId, FacilityId, FacilityModifier } from '../domain/types';

const ROUNDS = BALANCE.season.rounds;

/** Exact per-round share of a season amount; the 20 shares always sum to the total. */
export function roundShare(perSeason: number, round: number): number {
  return Math.floor((perSeason * round) / ROUNDS) - Math.floor((perSeason * (round - 1)) / ROUNDS);
}

/** Training progress multiplier from active happenings (1 = none). */
export function trainingModifier(club: Club): number {
  return club.modifiers.filter((m) => m.kind === 'trainingBoost').reduce((f, m) => f * (1 + m.value), 1);
}

/** Share of seats available after happenings (1 = all). */
export function capacityModifier(club: Club): number {
  return club.modifiers.filter((m) => m.kind === 'capacityCut').reduce((f, m) => f * (1 - m.value), 1);
}

/** One league game played: every happening counts down; expired ones are removed. */
export function tickModifiers(club: Club): FacilityModifier[] {
  const expired: FacilityModifier[] = [];
  club.modifiers = club.modifiers.filter((m) => {
    m.matchesLeft -= 1;
    if (m.matchesLeft <= 0) {
      expired.push(m);
      return false;
    }
    return true;
  });
  return expired;
}

export const ticketPrice = (club: Club) => BALANCE.economy.ticketPrices[club.ticketPriceLevel - 1];

export function projectedAttendance(club: Club, priceLevel = club.ticketPriceLevel, support = club.fanSupport): number {
  const e = BALANCE.economy;
  const supportFactor = 0.5 + support / 200;
  const localFactor = 1 + (club.brand.local - 50) / 500;
  const demand = club.fanBase * supportFactor * e.ticketDemand[priceLevel - 1] * localFactor;
  // A capacity happening (e.g. floodlight failure) closes part of the seats.
  return Math.round(Math.min(e.stadiumCapacity[club.facilities.stadium - 1] * capacityModifier(club), demand));
}

export function projectedTicketRevenue(club: Club, priceLevel = club.ticketPriceLevel, support = club.fanSupport): number {
  return projectedAttendance(club, priceLevel, support) * BALANCE.economy.ticketPrices[priceLevel - 1];
}

export function payrollPerSeason(state: GameState, clubId: ClubId): number {
  return state.clubs[clubId].roster.reduce((sum, id) => sum + state.players[id].contract.salary, 0);
}

export function upkeepPerRound(club: Club): number {
  const e = BALANCE.economy;
  return (
    e.stadiumUpkeepPerRound[club.facilities.stadium - 1] +
    e.trainingUpkeepPerRound[club.facilities.training - 1] +
    e.scoutingUpkeepPerRound[club.facilities.scouting - 1]
  );
}

/** Exact split of a round amount over its days (earlier days take the remainder); sums to the round amount. */
export function dayShare(perRound: number, day: number): number {
  const D = BALANCE.season.daysPerRound;
  return Math.floor((perRound * day) / D) - Math.floor((perRound * (day - 1)) / D);
}

/** Ledger id for one day's running costs. */
export const dayLedgerId = (season: number, round: number, day: number) => `day:${season}:${round}:${day}`;

export interface DayCosts {
  salaries: number;
  upkeep: number;
}

/** Running costs of one regular-season day: salaries and facility upkeep, split exactly from the round amounts. */
export function dayCosts(state: GameState, clubId: ClubId, season: number, round: number, day: number): DayCosts {
  const club = state.clubs[clubId];
  return {
    salaries: club.roster.reduce((sum, id) => sum + dayShare(salaryDue(state, id, season, round), day), 0),
    upkeep: dayShare(upkeepPerRound(club), day),
  };
}

/**
 * Charges today's running costs once, when a regular-season day starts
 * (preseason and the off-season have none). Income stays on match day.
 */
export function chargeDay(state: GameState, sink: EffectSink): DayCosts | null {
  const { season, round, day, phase } = state.calendar;
  if (phase !== 'regular' || round < 1) return null;
  const c = dayCosts(state, state.userClubId, season, round, day);
  if (c.salaries) sink.cash(state.userClubId, -c.salaries, 'salaries', 'Player salaries');
  if (c.upkeep) sink.cash(state.userClubId, -c.upkeep, 'upkeep', 'Facility running costs');
  return c;
}

export interface RoundSettlement {
  tickets: number;
  attendance: number;
  sponsor: number;
  completed?: FacilityId;
  /** Happenings that ran out with this game. */
  expired: FacilityModifier[];
}

/** Match-day income (tickets at home, the sponsor's share) and project completion. Running costs are charged daily (chargeDay). */
export function settleRound(state: GameState, clubId: ClubId, isHome: boolean, sink: EffectSink): RoundSettlement {
  const club = state.clubs[clubId];
  const round = state.calendar.round;
  const out: RoundSettlement = { tickets: 0, attendance: 0, sponsor: 0, expired: [] };

  if (isHome) {
    out.attendance = projectedAttendance(club);
    out.tickets = out.attendance * ticketPrice(club);
    sink.cash(clubId, out.tickets, 'tickets', `Ticket sales (${out.attendance.toLocaleString('en-US')} fans)`);
  }
  if (club.sponsor) {
    out.sponsor = roundShare(club.sponsor.perSeason, round);
    sink.cash(clubId, out.sponsor, 'sponsor', `Sponsor: ${club.sponsor.name}`);
  }

  const p = club.project;
  // Happenings count down one per league game; expired ones are removed here, once.
  for (const m of tickModifiers(club)) out.expired.push(m);

  if (p && absoluteRound(state.calendar.season, round) >= p.completesRound) {
    const before = club.facilities[p.facility];
    club.facilities[p.facility] = p.toLevel;
    club.project = null;
    out.completed = p.facility;
    // Chain: the first training session in a new Training Center shows its contribution.
    if (p.facility === 'training') {
      state.followUps.push({
        id: nextId(state, 'fu'),
        templateId: 'team_training',
        dueRound: absoluteRound(state.calendar.season, round) + 1,
        originEventId: null,
        data: { facilityLevel: p.toLevel, completedRound: round },
      });
    }
    sink.record({ targetKind: 'club', targetId: clubId, targetLabel: FACILITY_LABELS[p.facility], stat: `facility.${p.facility}`, statLabel: 'Level', before, after: p.toLevel });
  }
  return out;
}

export const FACILITY_LABELS: Record<FacilityId, string> = {
  training: 'Training Center',
  scouting: 'Scouting Department',
  stadium: 'Stadium & Fan Facilities',
};

/** This round's salary share for a player, respecting when his contract started paying. */
export function salaryDue(state: GameState, playerId: string, season: number, round: number): number {
  const c = state.players[playerId].contract;
  return absoluteRound(season, round) >= c.startRound ? roundShare(c.salary, round) : 0;
}

export interface SeasonForecast {
  roundsLeft: number;
  homeGamesLeft: number;
  ticketIncome: number;
  sponsorIncome: number;
  salaries: number;
  upkeep: number;
  net: number;
  projectedCash: number;
}

/** Remaining income and commitments for the current season, before bigger decisions. */
export function seasonForecast(state: GameState, clubId: ClubId): SeasonForecast {
  const club = state.clubs[clubId];
  const { season, round } = state.calendar;
  const remaining = state.schedule.filter(
    (g) => g.season === season && !g.result && (g.homeId === clubId || g.awayId === clubId) && g.round >= round,
  );
  const homeGamesLeft = remaining.filter((g) => g.homeId === clubId).length;
  const roundsLeft = remaining.length;
  const rounds = remaining.map((g) => g.round);
  const sponsorIncome = club.sponsor ? rounds.reduce((s, r) => s + roundShare(club.sponsor!.perSeason, r), 0) : 0;
  const ticketIncome = homeGamesLeft * projectedTicketRevenue(club);
  // Running costs for every day not yet charged (today's were charged when it started).
  const cal = state.calendar;
  let salaries = 0;
  let upkeep = 0;
  if (cal.phase !== 'postseason') {
    for (let r = Math.max(1, round); r <= BALANCE.season.rounds; r++) {
      for (let d = 1; d <= BALANCE.season.daysPerRound; d++) {
        if (cal.phase === 'regular' && r === round && d <= cal.day) continue;
        const c = dayCosts(state, clubId, season, r, d);
        salaries += c.salaries;
        upkeep += c.upkeep;
      }
    }
  }
  const net = ticketIncome + sponsorIncome - salaries - upkeep;
  return { roundsLeft, homeGamesLeft, ticketIncome, sponsorIncome, salaries, upkeep, net, projectedCash: club.cash + net };
}
