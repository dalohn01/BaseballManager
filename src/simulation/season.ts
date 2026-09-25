import { BALANCE } from '../balance/config';
import { createPlayer, emptyStats, marketSalary } from '../content/playerFactory';
import { autoLineup } from '../domain/lineup';
import type { Rng } from '../domain/rng';
import { positionNeeds, releasePlayer, squadProblem } from '../domain/roster';
import type { GameState } from '../domain/state';
import { absoluteRound, clubPlayers, nextId, playerName } from '../domain/state';
import type { ClubId, LineupPosition, Player } from '../domain/types';
import { generateSchedule } from './schedule';

const O = BALANCE.offseason;

/** Contracts that end with the current season (draftees who have not started yet are excluded). */
export function expiringPlayers(state: GameState, clubId: ClubId): Player[] {
  const seasonEnd = absoluteRound(state.calendar.season, BALANCE.season.rounds);
  return clubPlayers(state, clubId).filter((p) => p.contract.seasonsLeft <= 1 && p.contract.startRound <= seasonEnd);
}

/**
 * A renewing player asks for his market value (level and age), within a band
 * around his current salary; players who prioritise money ask a bit more.
 */
export function renewalTerms(p: Player): { salary: number; willing: boolean } {
  const level = p.isPitcher ? p.ratings.pitching : Math.max(p.ratings.contact, p.ratings.fielding);
  const market = Math.max(8, level - 30) * O.renewalPerRatingPoint * (p.age >= 33 ? 0.85 : 1);
  const [lo, hi] = O.renewalBand;
  const ask = Math.min(p.contract.salary * hi, Math.max(p.contract.salary * lo, market)) * (p.priority === 'money' ? 1 + O.renewalMoneyPremium : 1);
  return {
    salary: Math.round(ask / 1000) * 1000,
    willing: p.satisfaction >= O.renewalMinSatisfaction,
  };
}

export function renewContract(p: Player) {
  const t = renewalTerms(p);
  p.contract.salary = t.salary;
  p.contract.seasonsLeft += O.renewalSeasons;
}

export interface TransitionReport {
  departures: string[];
  replacements: string[];
  declines: string[];
  sponsorEnded: string | null;
}

/**
 * Off-season: archive stats, run contracts down, age players, complete every
 * squad with cheap replacements and set up the next season's schedule.
 */
export function startNextSeason(state: GameState, rng: Rng): TransitionReport {
  const season = state.calendar.season;
  const seasonEnd = absoluteRound(season, BALANCE.season.rounds);
  const nextStart = absoluteRound(season + 1, 1);
  const report: TransitionReport = { departures: [], replacements: [], declines: [], sponsorEnded: null };
  const user = state.userClubId;

  for (const clubId of state.clubOrder) {
    for (const p of clubPlayers(state, clubId)) {
      // Archive and reset season stats.
      p.pastSeasons.unshift({ season, clubId, stats: p.stats });
      p.pastSeasons.length = Math.min(p.pastSeasons.length, O.pastSeasonsKept);
      p.stats = emptyStats();

      // Contracts that have started run down by one season.
      if (p.contract.startRound <= seasonEnd) {
        p.contract.seasonsLeft -= 1;
        if (p.contract.seasonsLeft <= 0) {
          if (clubId !== user && p.age < O.aiRenewMaxAge) {
            p.contract.seasonsLeft = O.renewalSeasons;
          } else {
            releasePlayer(state, p.id);
            if (clubId === user) report.departures.push(`${playerName(p)} (contract ended)`);
            continue;
          }
        }
      }

      // Ageing: moderate decline from the configured age.
      p.age += 1;
      if (p.age >= O.ageingFrom) {
        const extra = p.age >= 34 ? 1 : 0;
        const keys = p.isPitcher ? (['pitching'] as const) : (['contact', 'power', 'speed'] as const);
        let total = 0;
        for (const k of keys) {
          const d = rng.int(0, 2) + extra;
          p.ratings[k] = Math.max(15, p.ratings[k] - d);
          total += d;
        }
        const f = rng.int(0, 1);
        p.ratings.fielding = Math.max(15, p.ratings.fielding - f);
        total += f;
        const best = p.isPitcher ? p.ratings.pitching : Math.max(p.ratings.contact, p.ratings.fielding);
        p.potential = Math.min(p.potential, Math.max(best, p.potential - total));
        if (clubId === user && total >= 3) report.declines.push(`${playerName(p)} (age ${p.age}) −${total} rating points`);
      }

      // A break between seasons: rested, moods settle toward a neutral level.
      p.fatigue = rng.int(O.fatigueAfterBreak[0], O.fatigueAfterBreak[1]);
      p.satisfaction = Math.round(p.satisfaction + (O.moodDriftToward - p.satisfaction) * O.moodDriftShare);
    }
  }

  for (const clubId of state.clubOrder) {
    const club = state.clubs[clubId];
    // Complete the squad with cheap replacements.
    for (let guard = 0; guard < 10; guard++) {
      const problem = squadProblem(state, club.roster);
      if (!problem && club.roster.length >= O.minRosterSize) break;
      if (club.roster.length >= BALANCE.roster.max) break;
      const need = neededPosition(state, clubId, problem);
      const level = rng.int(48, 56);
      const age = rng.int(22, 30);
      const p = createPlayer(
        {
          id: nextId(state, 'p'),
          clubId,
          primary: need,
          age,
          level,
          upside: rng.int(0, 6),
          role: 'reserve',
          salary: Math.max(10_000, Math.round((marketSalary(level, age) * 0.7) / 1000) * 1000),
          seasonsLeft: 1,
          startRound: nextStart,
          joinedSeason: season + 1,
          scoutingLevel: club.facilities.scouting,
          bio: 'Signed as a low-cost replacement in the off-season.',
        },
        rng,
      );
      state.players[p.id] = p;
      club.roster.push(p.id);
      if (clubId === user) report.replacements.push(`${playerName(p)} (${need}, $${p.contract.salary.toLocaleString('en-US')})`);
    }

    // Sponsor deals run down; AI clubs renew automatically.
    if (club.sponsor) {
      club.sponsor.seasonsLeft -= 1;
      if (club.sponsor.seasonsLeft <= 0) {
        if (clubId === user) {
          report.sponsorEnded = club.sponsor.name;
          club.sponsor = null;
        } else {
          club.sponsor.seasonsLeft = 2;
        }
      }
    }

    club.seasonPlan = null;
    club.seasonStartCash = club.cash;
    club.fanSupport = Math.round(club.fanSupport + (O.fanDriftToward - club.fanSupport) * O.fanDriftShare);
  }

  // Next season.
  state.calendar = { season: season + 1, round: 0, slot: 0, phase: 'preseason' };
  state.schedule.push(...generateSchedule(state.clubOrder, season + 1, rng));
  // Keep only the finished season's full match results.
  for (const [id, m] of Object.entries(state.matches)) if (m.season < season) delete state.matches[id];
  for (const clubId of state.clubOrder) state.clubs[clubId].lineup = autoLineup(state, clubId);
  for (const pr of state.promises) {
    if (pr.status === 'active') {
      pr.status = 'void';
      pr.closeReason = 'The season ended.';
    }
  }
  return report;
}

function neededPosition(state: GameState, clubId: ClubId, problem: string | null): LineupPosition | 'P' {
  if (problem?.includes('pitchers')) return 'P';
  if (problem?.includes('catcher')) return 'C';
  const needs = positionNeeds(state, clubId);
  return needs.find((n) => n !== 'P') ?? 'CF';
}
