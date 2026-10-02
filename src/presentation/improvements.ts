import type { EffectRecord, GameState } from '../domain/state';
import { defaultStaff } from '../domain/staff';
import { computeTeamOvr, ovrDisplay } from '../domain/teamOvr';
import type { ClubId, PlayerId, RatingKey } from '../domain/types';

/*
 * What a training (or any event) improved, read from the saved effect
 * records: whole rating steps per player, players close to their next step,
 * and the team OVR before and after. Presentation only; nothing here changes
 * game data.
 */

export const RATING_KEYS: RatingKey[] = ['contact', 'power', 'speed', 'fielding', 'velocity', 'control', 'stamina'];
const isRating = (stat: string): stat is RatingKey => (RATING_KEYS as string[]).includes(stat);

export interface PlayerImprovement {
  playerId: PlayerId;
  rows: { key: RatingKey; label: string; before: number; after: number }[];
}

/** Whole rating steps, grouped by player (players in the order they first appear). */
export function improvementsOf(state: GameState, effects: EffectRecord[]): PlayerImprovement[] {
  const out = new Map<PlayerId, PlayerImprovement>();
  for (const e of effects) {
    if (e.targetKind !== 'player' || !isRating(e.stat) || e.after <= e.before || !state.players[e.targetId]) continue;
    const g = out.get(e.targetId) ?? { playerId: e.targetId, rows: [] };
    g.rows.push({ key: e.stat, label: e.statLabel, before: e.before, after: e.after });
    out.set(e.targetId, g);
  }
  return [...out.values()];
}

/** Players whose progress moved and who are now closest to their next whole step. */
export function nearNextStep(state: GameState, effects: EffectRecord[], limit = 3): { playerId: PlayerId; key: RatingKey; label: string; progress: number; rating: number }[] {
  return effects
    .filter((e) => e.targetKind === 'player' && e.stat.endsWith('Progress') && e.after > e.before && state.players[e.targetId])
    .map((e) => {
      const key = e.stat.replace('Progress', '') as RatingKey;
      return { playerId: e.targetId, key, label: e.statLabel.replace(' progress', ''), progress: e.after, rating: state.players[e.targetId].ratings[key] };
    })
    .sort((a, b) => b.progress - a.progress || a.playerId.localeCompare(b.playerId))
    .slice(0, limit);
}

/**
 * Team OVR before and after the recorded rating changes, with the same
 * calculation as everywhere else (before = today's squad with those ratings
 * set back).
 */
export function teamOvrChange(state: GameState, clubId: ClubId, effects: EffectRecord[]): { before: number; after: number } | null {
  const club = state.clubs[clubId];
  const staff = defaultStaff(state, clubId);
  const now = club.roster.map((id) => state.players[id]).filter(Boolean);
  const after = computeTeamOvr(now, staff);
  if (!after) return null;
  const back = new Map<PlayerId, Partial<Record<RatingKey, number>>>();
  for (const e of effects) {
    if (e.targetKind !== 'player' || !isRating(e.stat) || e.after === e.before) continue;
    const m = back.get(e.targetId) ?? {};
    // The earliest "before" wins if one rating changed twice.
    if (m[e.stat] === undefined) m[e.stat] = e.before;
    back.set(e.targetId, m);
  }
  const then = now.map((p) => {
    if (!back.has(p.id)) return p;
    const ratings = { ...p.ratings, ...back.get(p.id) };
    // A pitcher's quality is derived from velocity and control.
    if (p.isPitcher) ratings.pitching = Math.round((ratings.velocity + ratings.control) / 2);
    return { ...p, ratings };
  });
  const before = computeTeamOvr(then, staff);
  if (!before) return null;
  return { before: ovrDisplay(before.overall), after: ovrDisplay(after.overall) };
}
