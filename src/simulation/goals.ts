import { BALANCE } from '../balance/config';
import type { GameState, SeasonDirection } from '../domain/state';
import { absoluteRound, userClub } from '../domain/state';
import type { ClubId } from '../domain/types';

export const DIRECTION_LABEL: Record<SeasonDirection, string> = {
  winNow: 'Win now',
  rebuild: 'Rebuild',
  balanced: 'Sustainable contender',
};

export function userRecord(state: GameState, season = state.calendar.season) {
  let wins = 0;
  let losses = 0;
  for (const g of state.schedule) {
    if (g.season !== season || !g.result) continue;
    if (g.homeId !== state.userClubId && g.awayId !== state.userClubId) continue;
    const home = g.homeId === state.userClubId;
    const us = home ? g.result.homeRuns : g.result.awayRuns;
    const them = home ? g.result.awayRuns : g.result.homeRuns;
    if (us > them) wins++;
    else losses++;
  }
  return { wins, losses, played: wins + losses };
}

/** Starts (batting order or starting pitcher) by young players in the club's own games, from stored match lineups. */
export function prospectStarts(state: GameState, season = state.calendar.season, fromRound = 1, clubId: ClubId = state.userClubId): number {
  const maxAge = BALANCE.seasonPlan.rebuild.prospectMaxAge;
  let n = 0;
  for (const m of Object.values(state.matches)) {
    if (m.season !== season || m.round < fromRound) continue;
    const side = m.homeId === clubId ? 'home' : m.awayId === clubId ? 'away' : null;
    if (!side) continue;
    const l = m.lineups[side];
    for (const id of [...l.battingOrder.map((s) => s.playerId), l.pitcherId]) {
      if ((state.players[id]?.age ?? 99) <= maxAge) n++;
    }
  }
  return n;
}

export interface GoalItem {
  label: string;
  current: number;
  target: number;
  met: boolean;
  format?: 'cash';
}

/** Current progress toward the agreed season goals, computed from actual results. */
export function goalProgress(state: GameState): { direction: SeasonDirection; items: GoalItem[]; met: boolean; onTrack: boolean } | null {
  const club = userClub(state);
  const plan = club.seasonPlan;
  if (!plan) return null;
  const rec = userRecord(state);
  const items: GoalItem[] = [];
  if (plan.winsTarget !== null) items.push({ label: 'Wins', current: rec.wins, target: plan.winsTarget, met: rec.wins >= plan.winsTarget });
  if (plan.prospectStartsTarget !== null) {
    const ps = prospectStarts(state);
    items.push({ label: `Starts by players ≤${BALANCE.seasonPlan.rebuild.prospectMaxAge}`, current: ps, target: plan.prospectStartsTarget, met: ps >= plan.prospectStartsTarget });
  }
  if (plan.cashTarget !== null) items.push({ label: 'Cash at season end', current: club.cash, target: plan.cashTarget, met: club.cash >= plan.cashTarget, format: 'cash' });
  const rounds = BALANCE.season.rounds;
  const left = rounds - rec.played;
  // On track = the pace so far would reach every count target.
  const onTrack = items.every((i) => {
    if (i.format === 'cash' || rec.played === 0) return true;
    return i.current + (i.current / rec.played) * left >= i.target - 0.5;
  });
  return { direction: plan.direction, items, met: items.every((i) => i.met), onTrack };
}

export function goalText(state: GameState): string {
  const g = goalProgress(state);
  if (!g) return 'No season plan';
  return `${DIRECTION_LABEL[g.direction]}: ${g.items.map((i) => `${i.label} ${i.format === 'cash' ? '$' + i.target.toLocaleString('en-US') : i.target}+`).join(', ')}`;
}

export const currentAbs = (state: GameState) => absoluteRound(state.calendar.season, state.calendar.round);
