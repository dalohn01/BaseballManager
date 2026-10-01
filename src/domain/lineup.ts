import { nextStarter } from './staff';
import { BALANCE } from '../balance/config';
import type { GameState } from './state';
import type {
  ClubId,
  DefensivePosition,
  Lineup,
  LineupPosition,
  LineupSlot,
  PitchingPlan,
  Player,
  PlayerId,
  RatingKey,
} from './types';
import { DEFENSIVE_POSITIONS, LINEUP_POSITIONS } from './types';

/** Rating as used in matches: fitness below 100% lowers it, satisfaction nudges it slightly. */
export function effectiveRating(p: Player, key: RatingKey): number {
  const m = BALANCE.match;
  const v = p.ratings[key] - (100 - p.fitness) * m.fitnessPenaltyPerPoint + (p.satisfaction - 50) * m.satisfactionSwing;
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
    if (p.fitness < BALANCE.fitness.exhaustedBelow) issues.push({ severity: 'warning', text: `${p.lastName} is exhausted (fitness ${p.fitness}%).` });
  }
  for (const pos of LINEUP_POSITIONS) {
    if (!seenPositions.has(pos)) issues.push({ severity: 'error', text: `Nobody is playing ${pos}.` });
  }
  const pitcher = state.players[lineup.pitcherId];
  if (!pitcher || !roster.has(lineup.pitcherId) || !pitcher.isPitcher) {
    issues.push({ severity: 'error', text: 'Choose a starting pitcher from the roster.' });
  } else if (pitcher.fitness < BALANCE.fitness.needsRestBelow) {
    issues.push({ severity: 'warning', text: `${pitcher.lastName} is tired (fitness ${pitcher.fitness}%) and will pitch worse.` });
  }
  return issues;
}

export const isLineupValid = (state: GameState, clubId: ClubId, lineup: Lineup) =>
  validateLineup(state, clubId, lineup).every((i) => i.severity !== 'error');

export const defaultPitchingPlan = (): PitchingPlan => ({ relieverId: null, rest: [], hook: 'balanced' });

/** Problems with a pitching plan for a given starter. Errors block confirmation; warnings inform. */
export function validatePitchingPlan(state: GameState, clubId: ClubId, starterId: PlayerId, plan: PitchingPlan): LineupIssue[] {
  const club = state.clubs[clubId];
  const issues: LineupIssue[] = [];
  const pitchers = club.roster.map((id) => state.players[id]).filter((p) => p.isPitcher);
  const name = (id: PlayerId) => state.players[id]?.lastName ?? 'That pitcher';
  if (plan.rest.includes(starterId)) issues.push({ severity: 'error', text: `${name(starterId)} is today's starter and cannot also rest.` });
  if (plan.relieverId) {
    if (plan.relieverId === starterId) issues.push({ severity: 'error', text: `${name(starterId)} cannot be both starter and reliever.` });
    else if (!pitchers.some((p) => p.id === plan.relieverId)) issues.push({ severity: 'error', text: 'The planned reliever is not on the roster.' });
    else if (plan.rest.includes(plan.relieverId)) issues.push({ severity: 'error', text: `${name(plan.relieverId)} cannot relieve and rest at the same time.` });
  }
  const available = pitchers.filter((p) => p.id !== starterId && !plan.rest.includes(p.id));
  if (available.length === 0) {
    issues.push({ severity: 'warning', text: 'No reliever is available: the starter will pitch the whole game, whatever happens.' });
  }
  return issues;
}

/** Scarce positions are filled first so the greedy pick stays sensible. */
const FILL_ORDER: DefensivePosition[] = ['C', 'SS', 'CF', '2B', '3B', 'RF', 'LF', '1B'];

export interface AutoLineupOptions {
  /** Players below this fitness (%) are benched if a replacement exists. */
  restBelow?: number;
  /** Players to prefer (e.g. prospects that were promised starts). */
  prefer?: string[];
}

export function autoLineup(state: GameState, clubId: ClubId, opts: AutoLineupOptions = {}): Lineup {
  const players = state.clubs[clubId].roster.map((id) => state.players[id]);
  const hitters = players.filter((p) => !p.isPitcher);
  const restBelow = opts.restBelow ?? 0;
  const prefer = new Set(opts.prefer ?? []);

  const restPenalty = (p: Player) => (p.fitness < restBelow ? 40 : 0);
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

  return { battingOrder, pitcherId: nextStarter(state, clubId) };
}

/** Rotation helper: strongest pitcher once fitness is taken into account. */
export function bestRestedPitcher(state: GameState, clubId: ClubId): string {
  const pitchers = state.clubs[clubId].roster.map((id) => state.players[id]).filter((p) => p.isPitcher);
  const value = (p: Player) => effectiveRating(p, 'pitching') - (100 - p.fitness) * 1.5;
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
