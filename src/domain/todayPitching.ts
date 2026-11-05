import { effectiveValue, teamStatus, type TeamStatus } from './effective';
import { pitcherPosition } from './pitching';
import type { GameState } from './state';
import type { ClubId, PitchingBullpen, Player, PlayerId } from './types';

/*
 * Today's pitching staff, set per game: a starter and three relief slots
 * (Long relief, Setup, Closer). Pitchers in none of them are not used today.
 * The strongest setup is chosen by effective value (OVR + Fitness, Morale,
 * Team and Form), as a starter for the start and as a reliever for the
 * bullpen. Only starting pitchers (SP) start and only relievers (RP) relieve;
 * the default only bends that when a club is short of one kind.
 */

export const RELIEF_SLOTS = ['long', 'middle', 'setup', 'closer'] as const;
export type ReliefSlot = (typeof RELIEF_SLOTS)[number];
export type PitchingSlot = 'starter' | ReliefSlot;
export const PITCHING_SLOTS: PitchingSlot[] = ['starter', 'long', 'middle', 'setup', 'closer'];

export const SLOT_LABEL: Record<PitchingSlot, string> = { starter: 'Starting pitcher', long: 'Long relief', middle: 'Middle relief', setup: 'Setup', closer: 'Closer' };
export const SLOT_SHORT: Record<PitchingSlot, string> = { starter: 'SP', long: 'LR', middle: 'MR', setup: 'SU', closer: 'CL' };

export const emptyBullpen = (): PitchingBullpen => ({ long: null, middle: null, setup: null, closer: null });

const pitchersOf = (state: GameState, clubId: ClubId) => state.clubs[clubId].roster.map((id) => state.players[id]).filter((p) => p?.isPitcher);

/** Effective value as today's starter. */
export const starterValue = (state: GameState, p: Player, status?: TeamStatus) => effectiveValue(state, p, 'SP', status).effective;

/** Effective value in relief. */
export const relieverValue = (state: GameState, p: Player, status?: TeamStatus) => effectiveValue(state, p, 'RP', status).effective;

/** Starters (SP) take the starting slot, relievers (RP) the relief slots. */
export const canPitchIn = (p: Player, slot: PitchingSlot) => (slot === 'starter') === (pitcherPosition(p) === 'SP');

const slotScore = (state: GameState, p: Player, slot: PitchingSlot, status: TeamStatus) => (slot === 'starter' ? starterValue(state, p, status) : relieverValue(state, p, status));

/**
 * The strongest pitching for today: the best rested (Ready or Fresh) starting
 * pitcher by effective value, then the best three relievers: the best of them closes, the next sets
 * up, the third is long relief. A given starter is kept. Only a club short of
 * one kind falls back to the other (so a game can always be played).
 */
export function bestPitching(state: GameState, clubId: ClubId, starterId?: PlayerId): { starterId: PlayerId; bullpen: PitchingBullpen } {
  // A fixed squad keeps its roles: the starter and the relief roles are the pitchers in those places.
  const fixed = fixedPitching(state, clubId);
  if (fixed && (!starterId || starterId === fixed.starterId)) return fixed;
  const status = teamStatus(state, clubId);
  const all = pitchersOf(state, clubId);
  const rank = (list: Player[], slot: PitchingSlot) => [...list].sort((a, b) => slotScore(state, b, slot, status) - slotScore(state, a, slot, status) || a.id.localeCompare(b.id));
  const sp = all.filter((p) => canPitchIn(p, 'starter'));
  const starter = (starterId && all.find((p) => p.id === starterId)) || rank(sp.length ? sp : all, 'starter')[0];
  if (!starter) return { starterId: '', bullpen: emptyBullpen() };
  const others = all.filter((p) => p.id !== starter.id);
  const pen = [...rank(others.filter((p) => canPitchIn(p, 'closer')), 'closer'), ...rank(others.filter((p) => !canPitchIn(p, 'closer')), 'closer')];
  return { starterId: starter.id, bullpen: { closer: pen[0]?.id ?? null, setup: pen[1]?.id ?? null, middle: pen[2]?.id ?? null, long: pen[3]?.id ?? null } };
}

/** The club's fixed pitching places when every one is filled by one of its pitchers, else null. */
export function fixedPitching(state: GameState, clubId: ClubId): { starterId: PlayerId; bullpen: PitchingBullpen } | null {
  const club = state.clubs[clubId];
  const own = new Set(pitchersOf(state, clubId).map((p) => p.id));
  const pen = { ...emptyBullpen(), ...club.pitchingPlan.bullpen };
  const ids = [club.lineup.pitcherId, ...RELIEF_SLOTS.map((s) => pen[s])];
  if (ids.some((id) => !id || !own.has(id)) || new Set(ids).size !== ids.length) return null;
  return { starterId: club.lineup.pitcherId, bullpen: pen };
}

/**
 * The bullpen the simulator uses: the plan's slots for pitchers who can pitch
 * (on the roster, not today's starter, no one twice). A plan with no slot
 * filled gets the strongest bullpen.
 */
export function bullpenToday(state: GameState, clubId: ClubId, starterId: PlayerId, plan: PitchingBullpen | undefined): Record<ReliefSlot, Player | null> {
  const own = new Set(pitchersOf(state, clubId).map((p) => p.id));
  const seen = new Set<PlayerId>([starterId]);
  const ok = (id: PlayerId | null) => (id && own.has(id) && !seen.has(id) ? (seen.add(id), state.players[id]) : null);
  const given = plan ? { long: ok(plan.long), middle: ok(plan.middle ?? null), setup: ok(plan.setup), closer: ok(plan.closer) } : null;
  if (given && (given.long || given.middle || given.setup || given.closer)) return given;
  const best = bestPitching(state, clubId, starterId).bullpen;
  const get = (id: PlayerId | null) => (id ? state.players[id] : null);
  return { long: get(best.long), middle: get(best.middle), setup: get(best.setup), closer: get(best.closer) };
}

/** Which slot a pitcher has today, or null (not used). */
export function slotOf(starterId: PlayerId, bullpen: PitchingBullpen, id: PlayerId): PitchingSlot | null {
  if (starterId === id) return 'starter';
  for (const s of RELIEF_SLOTS) if (bullpen[s] === id) return s;
  return null;
}
