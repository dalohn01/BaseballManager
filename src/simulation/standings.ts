import type { GameState } from '../domain/state';
import type { ClubId } from '../domain/types';

export interface StandingRow {
  clubId: ClubId;
  played: number;
  wins: number;
  losses: number;
  runsFor: number;
  runsAgainst: number;
  diff: number;
  pct: number;
  streak: string;
}

/**
 * Standings are derived from the schedule's stored results, so each game is
 * counted exactly once by construction. Tiebreak: wins → run differential →
 * head-to-head wins → stable club id.
 */
export function computeStandings(state: GameState, season = state.calendar.season): StandingRow[] {
  const rows = new Map<ClubId, StandingRow>();
  const results: { winner: ClubId; loser: ClubId; round: number }[] = [];
  for (const id of state.clubOrder) {
    rows.set(id, { clubId: id, played: 0, wins: 0, losses: 0, runsFor: 0, runsAgainst: 0, diff: 0, pct: 0, streak: '–' });
  }
  const games = state.schedule.filter((g) => g.season === season && g.result).sort((a, b) => a.round - b.round);
  for (const g of games) {
    const r = g.result!;
    const home = rows.get(g.homeId)!;
    const away = rows.get(g.awayId)!;
    home.played++;
    away.played++;
    home.runsFor += r.homeRuns;
    home.runsAgainst += r.awayRuns;
    away.runsFor += r.awayRuns;
    away.runsAgainst += r.homeRuns;
    const homeWon = r.homeRuns > r.awayRuns;
    (homeWon ? home : away).wins++;
    (homeWon ? away : home).losses++;
    results.push({ winner: homeWon ? g.homeId : g.awayId, loser: homeWon ? g.awayId : g.homeId, round: g.round });
  }
  for (const row of rows.values()) {
    row.diff = row.runsFor - row.runsAgainst;
    row.pct = row.played ? row.wins / row.played : 0;
    const mine = results.filter((x) => x.winner === row.clubId || x.loser === row.clubId).reverse();
    if (mine.length) {
      const won = mine[0].winner === row.clubId;
      let n = 0;
      for (const x of mine) {
        if ((x.winner === row.clubId) === won) n++;
        else break;
      }
      row.streak = `${won ? 'W' : 'L'}${n}`;
    }
  }
  const h2h = (a: ClubId, b: ClubId) => results.filter((x) => x.winner === a && x.loser === b).length;
  return [...rows.values()].sort(
    (a, b) =>
      b.wins - a.wins ||
      b.diff - a.diff ||
      h2h(b.clubId, a.clubId) - h2h(a.clubId, b.clubId) ||
      a.clubId.localeCompare(b.clubId),
  );
}

export function standingPosition(state: GameState, clubId: ClubId): number {
  return computeStandings(state).findIndex((r) => r.clubId === clubId) + 1;
}
