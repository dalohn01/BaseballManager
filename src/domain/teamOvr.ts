import { BALANCE } from '../balance/config';
import type { GameState } from './state';
import { defaultStaff, type PitchingStaff } from './staff';
import type { ClubId, DefensivePosition, LineupPosition, Player, PlayerId, RatingKey } from './types';

/*
 * Team OVR: a comparison number for a club's basic playing strength on the
 * 0–100 rating scale (player ratings already use 0–100, so no mapping or
 * league-relative normalisation is applied). It is derived, never fed back
 * into the simulator, and uses base ratings only: no fitness, happiness,
 * pep talks or match tactics. The same functions are used for every club.
 *
 * - Reference lineup: the regular lineup from squad roles. Players with the
 *   'starter' role fill the eight positions and DH (bench players only fill a
 *   position no starter can play, or a missing place), chosen by base ratings
 *   with the simulator's position rules and stable id tie-breaks.
 * - Batting: the simulator's offense mix (contact 0.5, power 0.35, speed 0.15)
 *   per lineup place, equally weighted over the nine places.
 * - Defense: base fielding of the eight defenders at their reference positions,
 *   minus the out-of-position penalty the simulator applies; a plain average,
 *   as the simulator uses.
 * - Pitching: base pitching weighted by expected share of innings: a rotation
 *   (starter-role pitchers) shares the starters' innings equally, the best
 *   remaining arm takes the relief innings. Other pitchers are not counted.
 */

export interface TeamOvr {
  /** Full precision; round only for display. */
  batting: number;
  pitching: number;
  defense: number;
  overall: number;
  lineup: { playerId: PlayerId; position: LineupPosition }[];
  /** Pitchers counted, with their weight (sums to 1). */
  staff: { playerId: PlayerId; weight: number; role: 'rotation' | 'relief' }[];
}

const T = () => BALANCE.teamOvr;
const FILL_ORDER: DefensivePosition[] = ['C', 'SS', 'CF', '2B', '3B', 'RF', 'LF', '1B'];

export const baseOffense = (p: Player) => {
  const w = T().offense;
  return p.ratings.contact * w.contact + p.ratings.power * w.power + p.ratings.speed * w.speed;
};

export function baseFieldingAt(p: Player, pos: LineupPosition): number {
  if (pos === 'DH') return 0;
  return p.positions.includes(pos) ? p.ratings.fielding : p.ratings.fielding - BALANCE.match.outOfPositionFieldingPenalty;
}

const rating = (p: Player, k: RatingKey) => p.ratings[k];

/**
 * The regular lineup by squad roles and base ratings (deterministic). Null if
 * nine distinct hitters cannot be found.
 */
export function referenceLineup(players: Player[]): TeamOvr['lineup'] | null {
  const hitters = players.filter((p) => !p.isPitcher);
  if (hitters.length < 9) return null;
  const value = (p: Player, pos: LineupPosition) => baseOffense(p) * 0.6 + baseFieldingAt(p, pos) * 0.4;
  const used = new Set<PlayerId>();
  const out: TeamOvr['lineup'] = [];
  const pick = (pos: LineupPosition) => {
    const free = hitters.filter((p) => !used.has(p.id));
    const starters = free.filter((p) => p.role === 'starter');
    // Starters who can play the spot, then any starter, then the bench (same order as the auto lineup's eligibility).
    const tiers = pos === 'DH' ? [starters, free] : [starters.filter((p) => p.positions.includes(pos)), free.filter((p) => p.positions.includes(pos)), starters, free];
    const pool = tiers.find((t) => t.length > 0) ?? [];
    const chosen = [...pool].sort((a, b) => value(b, pos) - value(a, pos) || a.id.localeCompare(b.id))[0];
    if (!chosen) return;
    used.add(chosen.id);
    out.push({ playerId: chosen.id, position: pos });
  };
  for (const pos of FILL_ORDER) pick(pos);
  pick('DH');
  return out.length === 9 ? out : null;
}

/**
 * Pitchers by expected share of innings: the club's standing staff when given
 * (rotation, then closer/setup/long relief), otherwise squad roles and base
 * pitching. Null without any pitcher.
 */
export function pitchingStaff(players: Player[], staff?: PitchingStaff): TeamOvr['staff'] | null {
  const cfg = T().pitching;
  const pitchers = players.filter((p) => p.isPitcher).sort((a, b) => rating(b, 'pitching') - rating(a, 'pitching') || a.id.localeCompare(b.id));
  if (pitchers.length === 0) return null;
  const byId = new Map(pitchers.map((p) => [p.id, p]));
  const fromStaff = staff ? staff.rotation.map((id) => byId.get(id)).filter((p): p is Player => !!p) : [];
  const starters = pitchers.filter((p) => p.role === 'starter');
  const rotation = fromStaff.length ? fromStaff : [...starters, ...pitchers.filter((p) => p.role !== 'starter')].slice(0, cfg.rotationSize);
  const pen = staff ? [staff.closer, staff.setup, staff.long].map((id) => (id ? byId.get(id) : undefined)).filter((p): p is Player => !!p && !rotation.includes(p)) : [];
  const relief = pen.length ? pen : pitchers.filter((p) => !rotation.includes(p)).slice(0, cfg.reliefSize);
  // Without a relief arm the rotation pitches every inning.
  const rotationShare = relief.length ? cfg.rotationShare : 1;
  return [
    ...rotation.map((p) => ({ playerId: p.id, weight: rotationShare / rotation.length, role: 'rotation' as const })),
    ...relief.map((p) => ({ playerId: p.id, weight: (1 - rotationShare) / relief.length, role: 'relief' as const })),
  ];
}

/** Team OVR from players' base ratings; null for an incomplete roster (shown as "— OVR"). */
export function computeTeamOvr(players: Player[], pitchingPlan?: PitchingStaff): TeamOvr | null {
  const lineup = referenceLineup(players);
  const staff = pitchingStaff(players, pitchingPlan);
  if (!lineup || !staff) return null;
  const byId = new Map(players.map((p) => [p.id, p]));
  const batting = lineup.reduce((a, s) => a + baseOffense(byId.get(s.playerId)!), 0) / lineup.length;
  const defenders = lineup.filter((s) => s.position !== 'DH');
  const defense = defenders.reduce((a, s) => a + baseFieldingAt(byId.get(s.playerId)!, s.position), 0) / defenders.length;
  const pitching = staff.reduce((a, s) => a + rating(byId.get(s.playerId)!, 'pitching') * s.weight, 0);
  const overall = combineOvr(batting, pitching, defense);
  return { batting, pitching, defense, overall, lineup, staff };
}

/** rawTeamOVR = 0.40 × batting + 0.40 × pitching + 0.20 × defense (weights in BALANCE.teamOvr). */
export function combineOvr(batting: number, pitching: number, defense: number): number {
  const w = T().weights;
  return w.batting * batting + w.pitching * pitching + w.defense * defense;
}

/** Display value: an integer 0–100. */
export const ovrDisplay = (v: number) => Math.round(Math.max(0, Math.min(100, v)));

// Derived per saved state (states are never mutated after a command), so the
// league is computed once per change instead of on every render.
const cache = new WeakMap<GameState, Map<ClubId, TeamOvr | null>>();

export function teamOvr(state: GameState, clubId: ClubId): TeamOvr | null {
  let m = cache.get(state);
  if (!m) {
    m = new Map();
    cache.set(state, m);
  }
  if (!m.has(clubId)) m.set(clubId, computeTeamOvr(state.clubs[clubId].roster.map((id) => state.players[id]).filter(Boolean), defaultStaff(state, clubId)));
  return m.get(clubId)!;
}

const AREA = { batting: 'Batting', pitching: 'Pitching', defense: 'Defense' } as const;

/**
 * A short profile comparing the team's own areas (never against other teams):
 * "Balanced team" when the spread is under 5, otherwise the strongest area and
 * the relatively weakest one.
 */
export function ovrProfile(o: TeamOvr): string {
  const parts = (['batting', 'pitching', 'defense'] as const).map((k) => ({ k, v: ovrDisplay(o[k]) }));
  const hi = [...parts].sort((a, b) => b.v - a.v)[0];
  const lo = [...parts].sort((a, b) => a.v - b.v)[0];
  if (hi.v - lo.v < T().balancedSpread) return 'Balanced team';
  return `${AREA[hi.k]}-led team · ${AREA[lo.k]} is the relative weak spot`;
}
