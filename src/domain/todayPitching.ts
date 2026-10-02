import { BALANCE } from '../balance/config';
import { effectiveValue, teamStatus, type TeamStatus } from './effective';
import type { GameState } from './state';
import type { ClubId, PitchingBullpen, Player, PlayerId } from './types';

/*
 * Today's pitching staff, set per game: a starter and three relief slots
 * (Long relief, Setup, Closer). Pitchers in none of them are not used today.
 * The strongest setup is chosen by effective value (OVR + Fitness, Morale,
 * Team and Form), as a starter for the start and as a reliever for the
 * bullpen; a starting pitcher in a relief slot counts a little lower, since he
 * usually only starts.
 */

export const RELIEF_SLOTS = ['long', 'setup', 'closer'] as const;
export type ReliefSlot = (typeof RELIEF_SLOTS)[number];
export type PitchingSlot = 'starter' | ReliefSlot;
export const PITCHING_SLOTS: PitchingSlot[] = ['starter', 'long', 'setup', 'closer'];

export const SLOT_LABEL: Record<PitchingSlot, string> = { starter: 'Starting pitcher', long: 'Long relief', setup: 'Setup', closer: 'Closer' };
export const SLOT_SHORT: Record<PitchingSlot, string> = { starter: 'SP', long: 'LR', setup: 'SU', closer: 'CL' };

export const emptyBullpen = (): PitchingBullpen => ({ long: null, setup: null, closer: null });

const pitchersOf = (state: GameState, clubId: ClubId) => state.clubs[clubId].roster.map((id) => state.players[id]).filter((p) => p?.isPitcher);

/** Effective value as today's starter. */
export const starterValue = (state: GameState, p: Player, status?: TeamStatus) => effectiveValue(state, p, 'SP', status).effective;

/** Effective value in relief. */
export const relieverValue = (state: GameState, p: Player, status?: TeamStatus) => effectiveValue(state, p, 'RP', status).effective;

/** The value used to rank a pitcher for a slot (relief slots prefer relievers). */
function slotScore(state: GameState, p: Player, slot: PitchingSlot, status: TeamStatus): number {
  if (slot === 'starter') return starterValue(state, p, status);
  const sp = p.ratings.stamina >= BALANCE.pitching.starterStaminaFrom;
  return relieverValue(state, p, status) - (sp ? BALANCE.modifiers.starterInReliefPenalty : 0);
}

/**
 * The strongest pitching for today: the best starter by effective value, then
 * the best three others for relief: the best of them closes, the next sets up,
 * the third is long relief. A given starter is kept.
 */
export function bestPitching(state: GameState, clubId: ClubId, starterId?: PlayerId): { starterId: PlayerId; bullpen: PitchingBullpen } {
  const status = teamStatus(state, clubId);
  const all = pitchersOf(state, clubId);
  const rank = (list: Player[], slot: PitchingSlot) => [...list].sort((a, b) => slotScore(state, b, slot, status) - slotScore(state, a, slot, status) || a.id.localeCompare(b.id));
  const starter = (starterId && all.find((p) => p.id === starterId)) || rank(all, 'starter')[0];
  if (!starter) return { starterId: '', bullpen: emptyBullpen() };
  const pen = rank(
    all.filter((p) => p.id !== starter.id),
    'closer',
  );
  return { starterId: starter.id, bullpen: { closer: pen[0]?.id ?? null, setup: pen[1]?.id ?? null, long: pen[2]?.id ?? null } };
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
  const given = plan ? { long: ok(plan.long), setup: ok(plan.setup), closer: ok(plan.closer) } : null;
  if (given && (given.long || given.setup || given.closer)) return given;
  const best = bestPitching(state, clubId, starterId).bullpen;
  const get = (id: PlayerId | null) => (id ? state.players[id] : null);
  return { long: get(best.long), setup: get(best.setup), closer: get(best.closer) };
}

/** Which slot a pitcher has today, or null (not used). */
export function slotOf(starterId: PlayerId, bullpen: PitchingBullpen, id: PlayerId): PitchingSlot | null {
  if (starterId === id) return 'starter';
  for (const s of RELIEF_SLOTS) if (bullpen[s] === id) return s;
  return null;
}
