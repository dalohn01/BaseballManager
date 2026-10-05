import { bestPitching, canPitchIn, emptyBullpen, RELIEF_SLOTS, slotOf, type PitchingSlot } from './todayPitching';
import { autoLineup, validateLineup, validatePitchingPlan, type LineupIssue } from './lineup';
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

/** Bench player replaces a starter: same position, same batting spot; the starter goes to the bench. */
export function swapFromBench(d: LineupDraft, slotIndex: number, playerId: PlayerId): LineupDraft {
  const next = clone(d);
  next.lineup.battingOrder[slotIndex] = { ...next.lineup.battingOrder[slotIndex], playerId };
  return next;
}

/** A starter goes to the bench: his batting spot and position stay, open until someone comes in. */
export function benchBatter(d: LineupDraft, slotIndex: number): LineupDraft {
  const next = clone(d);
  if (next.lineup.battingOrder[slotIndex]) next.lineup.battingOrder[slotIndex] = { ...next.lineup.battingOrder[slotIndex], playerId: '' };
  return next;
}

/** The first open batting spot, or -1. */
export const openSpot = (d: LineupDraft) => d.lineup.battingOrder.findIndex((s) => !s.playerId);

/**
 * A starter takes another defensive position. Whoever had it takes his old
 * one, so every position stays filled exactly once; batting spots do not move.
 */
export function setPosition(d: LineupDraft, slotIndex: number, pos: LineupPosition): LineupDraft {
  const j = d.lineup.battingOrder.findIndex((s) => s.position === pos);
  if (j < 0) {
    const next = clone(d);
    next.lineup.battingOrder[slotIndex].position = pos;
    return next;
  }
  return j === slotIndex ? clone(d) : swapPositions(d, slotIndex, j);
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

/** Why a pitcher cannot take a slot today (starters only start, relievers only relieve), or null. */
export function slotBlocker(state: GameState, slot: PitchingSlot, id: PlayerId): string | null {
  const p = state.players[id];
  if (!p?.isPitcher) return 'Only pitchers can take a pitching role.';
  if (canPitchIn(p, slot)) return null;
  return slot === 'starter' ? `${p.lastName} is a reliever and cannot start.` : `${p.lastName} is a starter and cannot pitch in relief.`;
}

/**
 * Puts a pitcher in a slot for today. If he already has another slot, the two
 * swap; a pitcher coming from the bench sends the slot's pitcher to the bench
 * (the starting slot can never be left empty). A starter can only take the
 * starting slot and a reliever only a relief slot; anything else is ignored.
 */
export function assignPitcher(state: GameState, d: LineupDraft, slot: PitchingSlot, id: PlayerId): LineupDraft {
  if (slotBlocker(state, slot, id)) return d;
  const next = clone(d);
  next.plan.bullpen = { ...(next.plan.bullpen ?? emptyBullpen()) };
  const from = pitcherSlot(next, id);
  if (from === slot) return next;
  const current = pitcherIn(next, slot);
  if (from) put(next, from, current);
  put(next, slot, id);
  return next;
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

/** The strongest pitching for today by effective value: starter and the three relief slots. */
export function suggestPitching(state: GameState, d: LineupDraft): LineupDraft {
  const next = clone(d);
  const best = bestPitching(state, state.userClubId);
  next.lineup.pitcherId = best.starterId;
  next.plan = { ...next.plan, relieverId: null, rest: [], bullpen: best.bullpen };
  return next;
}

