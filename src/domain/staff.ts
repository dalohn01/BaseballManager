import { BALANCE } from '../balance/config';
import { seasonDayOf } from './seasonDates';
import type { Calendar, GameState } from './state';
import type { ClubId, Player, PlayerId } from './types';

/*
 * The old standing pitching staff (a rotation in order and three bullpen
 * roles). Pitching is now set per game (todayPitching.ts); this remains for
 * save migrations and as the depth chart behind Team OVR (defaultStaff).
 */

export interface PitchingStaff {
  rotation: PlayerId[];
  closer: PlayerId | null;
  setup: PlayerId | null;
  long: PlayerId | null;
  /** Index in the rotation of the next scheduled starter. */
  next: number;
}

export type StaffRole = 'rotation' | 'closer' | 'setup' | 'long' | 'depth';
export const BULLPEN_ROLES = ['closer', 'setup', 'long'] as const;
export type BullpenRole = (typeof BULLPEN_ROLES)[number];

export const ROLE_LABEL: Record<StaffRole, string> = {
  rotation: 'Rotation',
  closer: 'Closer',
  setup: 'Setup',
  long: 'Long relief',
  depth: 'Depth',
};

const pitchersOf = (state: GameState, clubId: ClubId) => state.clubs[clubId].roster.map((id) => state.players[id]).filter((p) => p?.isPitcher);
const byPitching = (a: Player, b: Player) => b.ratings.pitching - a.ratings.pitching || a.id.localeCompare(b.id);

/** A sensible staff from squad roles and base ratings: three starters, then closer, setup, long relief. */
export function defaultStaff(state: GameState, clubId: ClubId): PitchingStaff {
  const all = pitchersOf(state, clubId).sort(byPitching);
  // Starters by stamina (SP) first, the rest after; within each, the better pitcher.
  const isSP = (p: Player) => (p.ratings.stamina ?? 0) >= BALANCE.pitching.starterStaminaFrom;
  const rotation = [...all.filter(isSP), ...all.filter((p) => !isSP(p))].slice(0, BALANCE.pitching.rotationSize).map((p) => p.id);
  const pen = all.filter((p) => !rotation.includes(p.id));
  return { rotation, closer: pen[0]?.id ?? null, setup: pen[1]?.id ?? null, long: pen[2]?.id ?? null, next: 0 };
}

/**
 * Keeps a staff valid after roster changes: only own pitchers, no one in two
 * roles, at least one starter in the rotation (filled from the bench).
 */
export function normalizeStaff(state: GameState, clubId: ClubId, staff: PitchingStaff | undefined): PitchingStaff {
  if (!staff) return defaultStaff(state, clubId);
  const own = new Set(pitchersOf(state, clubId).map((p) => p.id));
  const seen = new Set<PlayerId>();
  const keep = (id: PlayerId | null) => (id && own.has(id) && !seen.has(id) ? (seen.add(id), id) : null);
  const rotation = staff.rotation.map((id) => keep(id)).filter((x): x is PlayerId => !!x).slice(0, 5);
  const out: PitchingStaff = { rotation, closer: keep(staff.closer), setup: keep(staff.setup), long: keep(staff.long), next: staff.next };
  if (out.rotation.length === 0) {
    const best = pitchersOf(state, clubId).filter((p) => !seen.has(p.id)).sort(byPitching)[0];
    if (best) out.rotation.push(best.id);
  }
  // AI clubs keep their bullpen filled from depth after roster changes; the user's empty roles stay empty.
  if (!state.clubs[clubId].isUser) {
    const depth = pitchersOf(state, clubId).filter((p) => !seen.has(p.id) && !out.rotation.includes(p.id)).sort(byPitching);
    for (const r of BULLPEN_ROLES) if (!out[r] && depth.length) out[r] = depth.shift()!.id;
  }
  out.next = out.rotation.length ? ((staff.next % out.rotation.length) + out.rotation.length) % out.rotation.length : 0;
  return out;
}

export function staffRole(staff: PitchingStaff, id: PlayerId): StaffRole {
  if (staff.rotation.includes(id)) return 'rotation';
  if (staff.closer === id) return 'closer';
  if (staff.setup === id) return 'setup';
  if (staff.long === id) return 'long';
  return 'depth';
}

const restedValue = (p: Player) => p.ratings.pitching - (100 - p.fitness) * 1.5;

/** Old saves: the next pitcher in the rotation who was ready (for migrations up to v13). */
export function nextStarter(state: GameState, clubId: ClubId, rest: PlayerId[] = []): PlayerId {
  const staff = normalizeStaff(state, clubId, state.clubs[clubId].staff);
  const n = staff.rotation.length;
  for (let i = 0; i < n; i++) {
    const p = state.players[staff.rotation[(staff.next + i) % n]];
    if (p && !rest.includes(p.id) && p.fitness >= 80) return p.id;
  }
  const pool = pitchersOf(state, clubId).filter((p) => !rest.includes(p.id));
  return [...pool].sort((a, b) => restedValue(b) - restedValue(a) || a.id.localeCompare(b.id))[0]?.id ?? pitchersOf(state, clubId)[0]?.id ?? '';
}

// ---------------------------------------------------------------- Rest days

/** A stable day number across seasons (for "pitched yesterday"). */
export const absDay = (cal: Calendar) => {
  const sd = seasonDayOf(cal);
  return sd.season * 1000 + sd.day;
};

/** Daily recovery for hitters; pitchers' rest is counted in games (restAfterGame). */
export function recoverDay(state: GameState, _endedDay: number) {
  const f = BALANCE.fitness;
  for (const p of Object.values(state.players)) {
    if (!p.clubId || p.isPitcher) continue;
    p.fitness = Math.max(0, Math.min(100, p.fitness + f.naturalRecoveryPerDay));
  }
}
