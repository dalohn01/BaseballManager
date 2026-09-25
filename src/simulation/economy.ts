import { BALANCE } from '../balance/config';
import type { EffectSink } from '../domain/effects';
import type { GameState } from '../domain/state';
import type { Club, ClubId } from '../domain/types';

const ROUNDS = BALANCE.season.rounds;

/** Exact per-round share of a season amount; the 20 shares always sum to the total. */
export function roundShare(perSeason: number, round: number): number {
  return Math.floor((perSeason * round) / ROUNDS) - Math.floor((perSeason * (round - 1)) / ROUNDS);
}

export const ticketPrice = (club: Club) => BALANCE.economy.ticketPrices[club.ticketPriceLevel - 1];

export function projectedAttendance(club: Club, priceLevel = club.ticketPriceLevel, support = club.fanSupport): number {
  const e = BALANCE.economy;
  const supportFactor = 0.5 + support / 200;
  const localFactor = 1 + (club.brand.local - 50) / 500;
  const demand = club.fanBase * supportFactor * e.ticketDemand[priceLevel - 1] * localFactor;
  return Math.round(Math.min(e.stadiumCapacity[club.facilities.stadium - 1], demand));
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

export interface RoundSettlement {
  tickets: number;
  attendance: number;
  sponsor: number;
  salaries: number;
  upkeep: number;
}

/** Charges/credits one round of club finances. Called exactly once per round, at the league game. */
export function settleRound(state: GameState, clubId: ClubId, isHome: boolean, sink: EffectSink): RoundSettlement {
  const club = state.clubs[clubId];
  const round = state.calendar.round;
  const out: RoundSettlement = { tickets: 0, attendance: 0, sponsor: 0, salaries: 0, upkeep: 0 };

  if (isHome) {
    out.attendance = projectedAttendance(club);
    out.tickets = out.attendance * ticketPrice(club);
    sink.cash(clubId, out.tickets, 'tickets', `Ticket sales (${out.attendance.toLocaleString('en-US')} fans)`);
  }
  if (club.sponsor) {
    out.sponsor = roundShare(club.sponsor.perSeason, round);
    sink.cash(clubId, out.sponsor, 'sponsor', `Sponsor: ${club.sponsor.name}`);
  }
  out.salaries = club.roster.reduce((sum, id) => sum + roundShare(state.players[id].contract.salary, round), 0);
  sink.cash(clubId, -out.salaries, 'salaries', 'Player salaries');
  out.upkeep = upkeepPerRound(club);
  sink.cash(clubId, -out.upkeep, 'upkeep', 'Facility running costs');
  return out;
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
  const salaries = rounds.reduce((s, r) => s + club.roster.reduce((a, id) => a + roundShare(state.players[id].contract.salary, r), 0), 0);
  const sponsorIncome = club.sponsor ? rounds.reduce((s, r) => s + roundShare(club.sponsor!.perSeason, r), 0) : 0;
  const ticketIncome = homeGamesLeft * projectedTicketRevenue(club);
  const upkeep = roundsLeft * upkeepPerRound(club);
  const net = ticketIncome + sponsorIncome - salaries - upkeep;
  return { roundsLeft, homeGamesLeft, ticketIncome, sponsorIncome, salaries, upkeep, net, projectedCash: club.cash + net };
}
