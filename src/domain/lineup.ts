import { BALANCE } from '../balance/config';
import type { GameState } from './state';
import type {
  ClubId,
  DefensivePosition,
  Lineup,
  LineupPosition,
  LineupSlot,
  Player,
  RatingKey,
} from './types';
import { DEFENSIVE_POSITIONS, LINEUP_POSITIONS } from './types';

/** Rating as used in matches: fatigue lowers it, satisfaction nudges it slightly. */
export function effectiveRating(p: Player, key: RatingKey): number {
  const m = BALANCE.match;
  const v = p.ratings[key] - p.fatigue * m.fatiguePenaltyPerPoint + (p.satisfaction - 50) * m.satisfactionSwing;
  return Math.max(1, v);
}

export const offenseScore = (p: Player) =>
  effectiveRating(p, 'contact') * 0.5 + effectiveRating(p, 'power') * 0.35 + effectiveRating(p, 'speed') * 0.15;

export function fieldingAt(p: Player, pos: LineupPosition): number {
  if (pos === 'DH') return 0;
  const base = effectiveRating(p, 'fielding');
  return p.positions.includes(pos) ? base : base - BALANCE.match.outOfPositionFieldingPenalty;
}

export interface LineupIssue {
  severity: 'error' | 'warning';
  text: string;
}

export function validateLineup(state: GameState, clubId: ClubId, lineup: Lineup): LineupIssue[] {
  const club = state.clubs[clubId];
  const issues: LineupIssue[] = [];
  const roster = new Set(club.roster);
  const seenPlayers = new Set<string>();
  const seenPositions = new Set<LineupPosition>();

  if (lineup.battingOrder.length !== 9) issues.push({ severity: 'error', text: 'The batting order needs exactly 9 players.' });
  for (const slot of lineup.battingOrder) {
    const p = state.players[slot.playerId];
    if (!p || !roster.has(slot.playerId)) {
      issues.push({ severity: 'error', text: 'A batter is no longer on the roster.' });
      continue;
    }
    if (p.isPitcher) issues.push({ severity: 'error', text: `${p.lastName} is a pitcher and cannot bat in this model.` });
    if (seenPlayers.has(slot.playerId)) issues.push({ severity: 'error', text: `${p.lastName} appears twice.` });
    seenPlayers.add(slot.playerId);
    if (seenPositions.has(slot.position)) issues.push({ severity: 'error', text: `Position ${slot.position} is used twice.` });
    seenPositions.add(slot.position);
    if (slot.position !== 'DH' && !p.positions.includes(slot.position)) {
      issues.push({ severity: 'warning', text: `${p.lastName} is out of position at ${slot.position} (fielding −${BALANCE.match.outOfPositionFieldingPenalty}).` });
    }
    if (p.fatigue >= 70) issues.push({ severity: 'warning', text: `${p.lastName} is exhausted (fatigue ${p.fatigue}).` });
  }
  for (const pos of LINEUP_POSITIONS) {
    if (!seenPositions.has(pos)) issues.push({ severity: 'error', text: `Nobody is playing ${pos}.` });
  }
  const pitcher = state.players[lineup.pitcherId];
  if (!pitcher || !roster.has(lineup.pitcherId) || !pitcher.isPitcher) {
    issues.push({ severity: 'error', text: 'Choose a starting pitcher from the roster.' });
  } else if (pitcher.fatigue >= 60) {
    issues.push({ severity: 'warning', text: `${pitcher.lastName} is tired (fatigue ${pitcher.fatigue}) and will pitch worse.` });
  }
  return issues;
}

export const isLineupValid = (state: GameState, clubId: ClubId, lineup: Lineup) =>
  validateLineup(state, clubId, lineup).every((i) => i.severity !== 'error');

/** Scarce positions are filled first so the greedy pick stays sensible. */
const FILL_ORDER: DefensivePosition[] = ['C', 'SS', 'CF', '2B', '3B', 'RF', 'LF', '1B'];

export interface AutoLineupOptions {
  /** Players at or above this fatigue are benched if a replacement exists. */
  restThreshold?: number;
  /** Players to prefer (e.g. prospects that were promised starts). */
  prefer?: string[];
}

export function autoLineup(state: GameState, clubId: ClubId, opts: AutoLineupOptions = {}): Lineup {
  const players = state.clubs[clubId].roster.map((id) => state.players[id]);
  const hitters = players.filter((p) => !p.isPitcher);
  const restThreshold = opts.restThreshold ?? 101;
  const prefer = new Set(opts.prefer ?? []);

  const restPenalty = (p: Player) => (p.fatigue >= restThreshold ? 40 : 0);
  const bonus = (p: Player) => (prefer.has(p.id) ? 25 : 0);
  const valueAt = (p: Player, pos: LineupPosition) =>
    offenseScore(p) * 0.6 + (pos === 'DH' ? 0 : fieldingAt(p, pos) * 0.4) - restPenalty(p) + bonus(p);

  const used = new Set<string>();
  const slots: LineupSlot[] = [];
  for (const pos of FILL_ORDER) {
    const candidates = hitters.filter((p) => !used.has(p.id));
    const eligible = candidates.filter((p) => p.positions.includes(pos));
    const pool = eligible.length > 0 ? eligible : candidates;
    pool.sort((a, b) => valueAt(b, pos) - valueAt(a, pos) || a.id.localeCompare(b.id));
    const chosen = pool[0];
    if (!chosen) continue;
    used.add(chosen.id);
    slots.push({ playerId: chosen.id, position: pos });
  }
  const dhPool = hitters.filter((p) => !used.has(p.id));
  dhPool.sort((a, b) => valueAt(b, 'DH') - valueAt(a, 'DH') || a.id.localeCompare(b.id));
  if (dhPool[0]) slots.push({ playerId: dhPool[0].id, position: 'DH' });

  const battingOrder = orderBatters(state, slots);

  return { battingOrder, pitcherId: bestRestedPitcher(state, clubId) };
}

/** Rotation helper: strongest pitcher once fatigue is taken into account. */
export function bestRestedPitcher(state: GameState, clubId: ClubId): string {
  const pitchers = state.clubs[clubId].roster.map((id) => state.players[id]).filter((p) => p.isPitcher);
  const value = (p: Player) => effectiveRating(p, 'pitching') - p.fatigue * 0.6;
  return [...pitchers].sort((a, b) => value(b) - value(a) || a.id.localeCompare(b.id))[0]?.id ?? '';
}

/** Classic shape: on-base/speed first, best hitters 2–4, rest descending. */
export function orderBatters(state: GameState, slots: LineupSlot[]): LineupSlot[] {
  const withScore = slots.map((s) => {
    const p = state.players[s.playerId];
    return { s, off: offenseScore(p), lead: effectiveRating(p, 'contact') * 0.6 + effectiveRating(p, 'speed') * 0.4 };
  });
  const byOff = [...withScore].sort((a, b) => b.off - a.off || a.s.playerId.localeCompare(b.s.playerId));
  const top4 = byOff.slice(0, 4);
  const leadoff = [...top4].sort((a, b) => b.lead - a.lead)[0];
  const rest = byOff.filter((x) => x !== leadoff);
  return [leadoff, ...rest].filter(Boolean).map((x) => x.s);
}

export const DEFENSIVE_ORDER = DEFENSIVE_POSITIONS;
