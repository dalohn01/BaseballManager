import { syncPitching } from '../domain/pitching';
import { clamp } from '../domain/rng';
import { nd, type Personality } from '../domain/personality';

/** 0 … 1: how much personal terms weigh in a renewal (self-interest, need for recognition). */
export const contractWeight = (p: Personality) => clamp(0.6 * -nd(p.teamOrientation) + 0.4 * nd(p.recognitionNeed), 0, 1);
import { BALANCE } from '../balance/config';
import { emptyStats } from '../content/playerFactory';
import { contracted, fillEmptySlots, release, slotOf } from '../domain/squad';
import type { Rng } from '../domain/rng';
import type { GameState } from '../domain/state';
import { absoluteRound, clubPlayers, playerName } from '../domain/state';
import type { ClubId, Player } from '../domain/types';
import { generateSchedule } from './schedule';

const O = BALANCE.offseason;

/** Contracts that end with the current season (draftees who have not started yet are excluded). */
export function expiringPlayers(state: GameState, clubId: ClubId): Player[] {
  const seasonEnd = absoluteRound(state.calendar.season, BALANCE.season.rounds);
  return clubPlayers(state, clubId).filter((p) => p.contract.seasonsLeft <= 1 && p.contract.startRound <= seasonEnd);
}

/**
 * A renewing player asks for his market value (level and age), within a band
 * around his current salary. Self-focused players who want recognition ask a
 * bit more (up to the money premium); everyone still asks a fair salary.
 */
export function renewalTerms(p: Player): { salary: number; willing: boolean } {
  const level = p.isPitcher ? p.ratings.pitching : Math.max(p.ratings.contact, p.ratings.fielding);
  const market = Math.max(8, level - 30) * O.renewalPerRatingPoint * (p.age >= 33 ? 0.85 : 1);
  const [lo, hi] = O.renewalBand;
  const ask = Math.min(p.contract.salary * hi, Math.max(p.contract.salary * lo, market)) * (1 + O.renewalMoneyPremium * contractWeight(p.personality));
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
    // The squad and the transfer list: everyone the club still has under contract.
    for (const p of contracted(state, clubId).map((id) => state.players[id])) {
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
            release(state, p.id);
            if (clubId === user) report.departures.push(`${playerName(p)} (contract ended)`);
            continue;
          }
        }
      }

      // Ageing: moderate decline from the configured age.
      p.age += 1;
      if (p.age >= O.ageingFrom) {
        const extra = p.age >= 34 ? 1 : 0;
        const keys = p.isPitcher ? (['velocity', 'control', 'stamina'] as const) : (['contact', 'power', 'speed'] as const);
        let total = 0;
        for (const k of keys) {
          const d = rng.int(0, 2) + extra;
          p.ratings[k] = Math.max(15, p.ratings[k] - d);
          total += d;
        }
        const f = rng.int(0, 1);
        p.ratings.fielding = Math.max(15, p.ratings.fielding - f);
        total += f;
        syncPitching(p);
        const best = p.isPitcher ? p.ratings.pitching : Math.max(p.ratings.contact, p.ratings.fielding);
        p.potential = Math.min(p.potential, Math.max(best, p.potential - total));
        if (clubId === user && total >= 3) report.declines.push(`${playerName(p)} (age ${p.age}) −${total} rating points`);
      }

      // A break between seasons: moods settle toward a neutral level.
      p.satisfaction = Math.round(p.satisfaction + (O.moodDriftToward - p.satisfaction) * O.moodDriftShare);
    }
  }

  for (const clubId of state.clubOrder) {
    const club = state.clubs[clubId];
    // Every place left empty by an ended contract gets a cheap replacement for next season.
    for (const p of fillEmptySlots(state, clubId, rng, { startRound: nextStart, joinedSeason: season + 1 })) {
      if (clubId === user) report.replacements.push(`${playerName(p)} (${slotOf(state, clubId, p.id) ?? '?'}, $${p.contract.salary.toLocaleString('en-US')})`);
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
  // Preseason is its own day: it starts when the manager advances from the off-season.
  state.calendar = { season: season + 1, round: 0, slot: 0, phase: 'preseason', day: 0 };
  state.schedule.push(...generateSchedule(state.clubOrder, season + 1, rng));
  // Keep only the finished season's full match results.
  for (const [id, m] of Object.entries(state.matches)) if (m.season < season) delete state.matches[id];
  // The squads are fixed: each lineup keeps its places (newcomers took the empty ones).
  for (const pr of state.promises) {
    if (pr.status === 'active') {
      pr.status = 'void';
      pr.closeReason = 'The season ended.';
    }
  }
  return report;
}
