import { BALANCE } from '../balance/config';
import { autoLineup, bestRestedPitcher, effectiveRating, orderBatters, validateLineup, validatePitchingPlan, type LineupIssue } from './lineup';
import type { GameState } from './state';
import { userClub } from './state';
import type { Lineup, LineupPosition, PitchingPlan, PlayerId } from './types';

/**
 * The pre-match draft: one editable lineup + pitching plan shared by the Field,
 * Batting order and Pitchers tabs. All operations are pure (they return a new
 * draft) and never touch the game state; only confirmation does.
 */
export interface LineupDraft {
  lineup: Lineup;
  plan: PitchingPlan;
}

export type PitcherRole = 'starter' | 'reliever' | 'available' | 'rest';

const clone = (d: LineupDraft): LineupDraft => structuredClone(d);

export function draftFromClub(state: GameState): LineupDraft {
  const club = userClub(state);
  return { lineup: structuredClone(club.lineup), plan: structuredClone(club.pitchingPlan) };
}

export function draftIssues(state: GameState, d: LineupDraft): LineupIssue[] {
  return [...validateLineup(state, state.userClubId, d.lineup), ...validatePitchingPlan(state, state.userClubId, d.lineup.pitcherId, d.plan)];
}

export const draftErrors = (state: GameState, d: LineupDraft) => draftIssues(state, d).filter((i) => i.severity === 'error');

/** Why `playerId` cannot take a slot, or null. Out-of-position play is allowed (with a visible penalty). */
export function benchSwapBlocker(state: GameState, d: LineupDraft, slotIndex: number, playerId: PlayerId): string | null {
  const p = state.players[playerId];
  if (!p || p.clubId !== state.userClubId) return 'He is not on the roster.';
  if (p.isPitcher) return 'Pitchers do not bat in this model.';
  if (d.lineup.battingOrder.some((s) => s.playerId === playerId)) return 'He is already in the lineup.';
  if (!d.lineup.battingOrder[slotIndex]) return 'No such lineup spot.';
  return null;
}

/** Bench player replaces a starter: same position, same batting spot; the starter goes to the bench. */
export function swapFromBench(d: LineupDraft, slotIndex: number, playerId: PlayerId): LineupDraft {
  const next = clone(d);
  next.lineup.battingOrder[slotIndex] = { ...next.lineup.battingOrder[slotIndex], playerId };
  return next;
}

/** Two starters exchange defensive positions (atomic); batting spots stay as they are. */
export function swapPositions(d: LineupDraft, a: number, b: number): LineupDraft {
  const next = clone(d);
  const pa = next.lineup.battingOrder[a].position;
  next.lineup.battingOrder[a].position = next.lineup.battingOrder[b].position;
  next.lineup.battingOrder[b].position = pa;
  return next;
}

/** Moves a batter to another spot in the order; others shift. Positions are unchanged. */
export function moveBatter(d: LineupDraft, from: number, to: number): LineupDraft {
  const next = clone(d);
  const order = next.lineup.battingOrder;
  if (to < 0 || to >= order.length || from === to) return next;
  const [slot] = order.splice(from, 1);
  order.splice(to, 0, slot);
  return next;
}

export function pitcherRole(d: LineupDraft, id: PlayerId): PitcherRole {
  if (d.lineup.pitcherId === id) return 'starter';
  if (d.plan.relieverId === id) return 'reliever';
  if (d.plan.rest.includes(id)) return 'rest';
  return 'available';
}

/** Gives a pitcher one role for today; roles stay exclusive (one starter, at most one planned reliever). */
export function setPitcherRole(d: LineupDraft, id: PlayerId, role: PitcherRole): LineupDraft {
  const next = clone(d);
  next.plan.rest = next.plan.rest.filter((x) => x !== id);
  if (next.plan.relieverId === id) next.plan.relieverId = null;
  if (role === 'starter') {
    // The previous starter simply becomes available.
    next.lineup.pitcherId = id;
  } else if (role === 'reliever') {
    if (next.lineup.pitcherId === id) return d;
    next.plan.relieverId = id;
  } else if (role === 'rest') {
    if (next.lineup.pitcherId === id) return d;
    next.plan.rest.push(id);
  }
  return next;
}

export function setHook(d: LineupDraft, hook: PitchingPlan['hook']): LineupDraft {
  const next = clone(d);
  next.plan.hook = hook;
  return next;
}

// ---------- Quick actions (they only change the draft) ----------

export function bestLineup(state: GameState, d: LineupDraft): LineupDraft {
  return { ...clone(d), lineup: autoLineup(state, state.userClubId) };
}

export function rotateTired(state: GameState, d: LineupDraft): LineupDraft {
  return { ...clone(d), lineup: autoLineup(state, state.userClubId, { restBelow: BALANCE.fitness.restBelow }) };
}

export function suggestOrder(state: GameState, d: LineupDraft): LineupDraft {
  const next = clone(d);
  next.lineup.battingOrder = orderBatters(state, next.lineup.battingOrder);
  return next;
}

/** Best-rested starter, next best as reliever, anyone below the warning line rests. */
export function suggestPitching(state: GameState, d: LineupDraft): LineupDraft {
  const next = clone(d);
  const starter = bestRestedPitcher(state, state.userClubId);
  next.lineup.pitcherId = starter;
  const others = userClub(state)
    .roster.map((id) => state.players[id])
    .filter((p) => p.isPitcher && p.id !== starter);
  const tired = others.filter((p) => p.fitness < BALANCE.fitness.warnBelow).map((p) => p.id);
  const fresh = others
    .filter((p) => !tired.includes(p.id))
    .sort((a, b) => effectiveRating(b, 'pitching') - (100 - b.fitness) * 1.5 - (effectiveRating(a, 'pitching') - (100 - a.fitness) * 1.5));
  // If nobody is fresh, keep the tired arms available so the starter is never left alone.
  next.plan = { ...next.plan, relieverId: fresh[0]?.id ?? null, rest: fresh.length ? tired : [] };
  return next;
}

/** Positions a player is suited to, for display. */
export function suitability(state: GameState, playerId: PlayerId, pos: LineupPosition): 'natural' | 'dh' | 'out' {
  const p = state.players[playerId];
  if (pos === 'DH') return 'dh';
  return p.positions.includes(pos) ? 'natural' : 'out';
}
