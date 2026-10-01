import { BALANCE } from '../balance/config';
import { seasonDayOf } from './seasonDates';
import type { Calendar, GameState } from './state';
import type { ClubId, Player, PlayerId } from './types';

/*
 * The pitching staff as a standing plan: a rotation in order (the next
 * starter comes up in turn) and three bullpen roles. Used the same way for
 * every club; the user edits it, AI clubs keep the default.
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

export const ROLE_HELP: Record<BullpenRole, string> = {
  closer: 'Save situations from the 9th: a lead of 1–3 runs when the inning starts.',
  setup: 'Takes over in the 6th–8th when the starter comes out.',
  long: 'Takes over early (to the 5th) when the starter is knocked out.',
};

const pitchersOf = (state: GameState, clubId: ClubId) => state.clubs[clubId].roster.map((id) => state.players[id]).filter((p) => p?.isPitcher);
const byPitching = (a: Player, b: Player) => b.ratings.pitching - a.ratings.pitching || a.id.localeCompare(b.id);

/** A sensible staff from squad roles and base ratings: three starters, then closer, setup, long relief. */
export function defaultStaff(state: GameState, clubId: ClubId): PitchingStaff {
  const all = pitchersOf(state, clubId).sort(byPitching);
  const starters = all.filter((p) => p.role === 'starter');
  const rotation = [...starters, ...all.filter((p) => p.role !== 'starter')].slice(0, BALANCE.pitching.rotationSize).map((p) => p.id);
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
  const rotation = staff.rotation.map((id) => keep(id)).filter((x): x is PlayerId => !!x).slice(0, BALANCE.pitching.maxRotation);
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

/** Today's readiness value for picking among pitchers (base pitching minus missing fitness). */
const restedValue = (p: Player) => p.ratings.pitching - (100 - p.fitness) * 1.5;

/**
 * Who starts today: the next pitcher in the rotation, skipping anyone below
 * the ready line (or resting today); if nobody in the rotation is ready, the
 * best-rested pitcher who is not resting.
 */
export function nextStarter(state: GameState, clubId: ClubId, rest: PlayerId[] = []): PlayerId {
  const staff = normalizeStaff(state, clubId, state.clubs[clubId].staff);
  const n = staff.rotation.length;
  for (let i = 0; i < n; i++) {
    const p = state.players[staff.rotation[(staff.next + i) % n]];
    if (p && !rest.includes(p.id) && p.fitness >= BALANCE.pitching.starterReadyFitness) return p.id;
  }
  const pool = pitchersOf(state, clubId).filter((p) => !rest.includes(p.id));
  return [...pool].sort((a, b) => restedValue(b) - restedValue(a) || a.id.localeCompare(b.id))[0]?.id ?? pitchersOf(state, clubId)[0]?.id ?? '';
}

/** After a game: the rotation moves on past whoever started (an off-rotation start leaves it in place). */
export function advanceRotation(state: GameState, clubId: ClubId, starterId: PlayerId) {
  const club = state.clubs[clubId];
  const staff = normalizeStaff(state, clubId, club.staff);
  const i = staff.rotation.indexOf(starterId);
  if (i >= 0) staff.next = (i + 1) % staff.rotation.length;
  club.staff = staff;
}

export interface Bullpen {
  closer: Player | null;
  setup: Player | null;
  long: Player | null;
}

/**
 * Today's bullpen: each role's pitcher if he can pitch (not starting, not
 * resting, fit enough). An empty or unavailable long-relief role is covered
 * by the best-rested depth arm, and with no bullpen at all the best-rested
 * other pitcher is kept as long relief, so the starter is never left alone.
 */
export function bullpenFor(state: GameState, clubId: ClubId, starterId: PlayerId, rest: PlayerId[] = []): Bullpen {
  const staff = normalizeStaff(state, clubId, state.clubs[clubId].staff);
  const ok = (id: PlayerId | null) => {
    const p = id ? state.players[id] : null;
    return p && p.id !== starterId && !rest.includes(p.id) && p.fitness >= BALANCE.pitching.relieverMinFitness ? p : null;
  };
  const pen: Bullpen = { closer: ok(staff.closer), setup: ok(staff.setup), long: ok(staff.long) };
  const taken = new Set([starterId, ...[pen.closer, pen.setup, pen.long].filter(Boolean).map((p) => p!.id)]);
  const others = pitchersOf(state, clubId)
    .filter((p) => !taken.has(p.id) && !rest.includes(p.id))
    .sort((a, b) => restedValue(b) - restedValue(a) || a.id.localeCompare(b.id));
  if (!pen.long) {
    const depth = others.find((p) => !staff.rotation.includes(p.id) && p.fitness >= BALANCE.pitching.relieverMinFitness);
    if (depth) pen.long = depth;
  }
  if (!pen.closer && !pen.setup && !pen.long && others[0]) pen.long = others[0];
  return pen;
}

// ---------------------------------------------------------------- Rest days

/** A stable day number across seasons (for "pitched yesterday"). */
export const absDay = (cal: Calendar) => {
  const sd = seasonDayOf(cal);
  return sd.season * 1000 + sd.day;
};

/** Daily recovery: everyone a little; pitchers who did not pitch the day before recover more. */
export function recoverDay(state: GameState, endedDay: number) {
  const f = BALANCE.fitness;
  for (const p of Object.values(state.players)) {
    if (!p.clubId) continue;
    let delta = f.naturalRecoveryPerDay;
    if (p.isPitcher && p.pitchedOn !== endedDay) delta += f.pitcherRecoveryPerDay;
    p.fitness = Math.max(0, Math.min(100, p.fitness + delta));
  }
}

const perDay = () => BALANCE.fitness.naturalRecoveryPerDay + BALANCE.fitness.pitcherRecoveryPerDay;

/** Days until a pitcher reaches a fitness level (0 = already there). Resting days only. */
export const daysUntil = (p: Player, level: number) => Math.max(0, Math.ceil((level - p.fitness) / perDay()));

/** A short availability line: "Pitched yesterday", "Pitched today", "Ready", "Ready in 2 days". */
export function pitcherReadiness(state: GameState, p: Player, role: StaffRole): string {
  const today = absDay(state.calendar);
  if (p.pitchedOn === today) return 'Pitched today';
  if (p.pitchedOn === today - 1) return 'Pitched yesterday';
  const level = role === 'rotation' ? BALANCE.pitching.starterReadyFitness : BALANCE.pitching.relieverMinFitness;
  const d = daysUntil(p, level);
  return d === 0 ? 'Ready' : `Ready in ${d} day${d === 1 ? '' : 's'}`;
}
