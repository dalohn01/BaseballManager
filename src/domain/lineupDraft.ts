import { bestPitching, emptyBullpen, RELIEF_SLOTS, slotOf, type PitchingSlot } from './todayPitching';
import { BALANCE } from '../balance/config';
import { autoLineup, orderBatters, validateLineup, validatePitchingPlan, type LineupIssue } from './lineup';
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

const clone = (d: LineupDraft): LineupDraft => structuredClone(d);

/**
 * A new game's draft starts from the strongest setup by effective value (OVR
 * plus Fitness, Morale, Team and Form): the best nine and today's pitching.
 * Only the hook is carried over from the last game.
 */
export function draftFromClub(state: GameState): LineupDraft {
  const club = userClub(state);
  const lineup = autoLineup(state, club.id);
  const best = bestPitching(state, club.id, lineup.pitcherId);
  return { lineup, plan: { relieverId: null, rest: [], bullpen: best.bullpen, hook: club.pitchingPlan.hook } };
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

/** Today's slot for a pitcher, or null (not used today). */
export const pitcherSlot = (d: LineupDraft, id: PlayerId): PitchingSlot | null => slotOf(d.lineup.pitcherId, d.plan.bullpen ?? emptyBullpen(), id);

const pitcherIn = (d: LineupDraft, slot: PitchingSlot): PlayerId | null => (slot === 'starter' ? d.lineup.pitcherId : (d.plan.bullpen ?? emptyBullpen())[slot]);

function put(d: LineupDraft, slot: PitchingSlot, id: PlayerId | null) {
  if (slot === 'starter') {
    if (id) d.lineup.pitcherId = id;
  } else {
    d.plan.bullpen = { ...(d.plan.bullpen ?? emptyBullpen()), [slot]: id };
  }
}

/**
 * Puts a pitcher in a slot for today. If he already has another slot, the two
 * swap; a pitcher coming from the bench sends the slot's pitcher to the bench
 * (the starting slot can never be left empty).
 */
export function assignPitcher(d: LineupDraft, slot: PitchingSlot, id: PlayerId): LineupDraft {
  const next = clone(d);
  next.plan.bullpen = { ...(next.plan.bullpen ?? emptyBullpen()) };
  const from = pitcherSlot(next, id);
  if (from === slot) return next;
  const current = pitcherIn(next, slot);
  if (from) put(next, from, current);
  put(next, slot, id);
  return next;
}

/** Swaps the pitchers in two slots. */
export function swapSlots(d: LineupDraft, a: PitchingSlot, b: PitchingSlot): LineupDraft {
  const pa = pitcherIn(d, a);
  const pb = pitcherIn(d, b);
  if (pa) return assignPitcher(d, b, pa);
  if (pb) return assignPitcher(d, a, pb);
  return clone(d);
}

/** Takes a reliever out of today's staff (the starting slot is never empty). */
export function benchPitcher(d: LineupDraft, slot: Exclude<PitchingSlot, 'starter'>): LineupDraft {
  const next = clone(d);
  put(next, slot, null);
  return next;
}

export const filledReliefSlots = (d: LineupDraft) => RELIEF_SLOTS.filter((s) => (d.plan.bullpen ?? emptyBullpen())[s]).length;

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

/** The strongest pitching for today by effective value: starter and the three relief slots. */
export function suggestPitching(state: GameState, d: LineupDraft): LineupDraft {
  const next = clone(d);
  const best = bestPitching(state, state.userClubId);
  next.lineup.pitcherId = best.starterId;
  next.plan = { ...next.plan, relieverId: null, rest: [], bullpen: best.bullpen };
  return next;
}

/** Positions a player is suited to, for display. */
export function suitability(state: GameState, playerId: PlayerId, pos: LineupPosition): 'natural' | 'dh' | 'out' {
  const p = state.players[playerId];
  if (pos === 'DH') return 'dh';
  return p.positions.includes(pos) ? 'natural' : 'out';
}
