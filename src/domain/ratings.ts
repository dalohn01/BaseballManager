import { BALANCE } from '../balance/config';
import type { LineupPosition, Player, RatingKey } from './types';

/**
 * Overall rating (OVR): one number that says how good a player is at his
 * primary job, on the same 0–100 scale as the individual ratings. It uses base
 * ratings (not today's fitness/mood) so it is stable between games.
 */
type Weights = Partial<Record<RatingKey, number>>;

const DEFENSIVE_SPINE: Weights = { contact: 0.3, power: 0.15, speed: 0.15, fielding: 0.4 };
const MIDDLE: Weights = { contact: 0.33, power: 0.2, speed: 0.12, fielding: 0.35 };
const CORNER: Weights = { contact: 0.38, power: 0.32, speed: 0.08, fielding: 0.22 };

export const OVR_WEIGHTS: Record<LineupPosition | 'P', Weights> = {
  C: DEFENSIVE_SPINE,
  SS: DEFENSIVE_SPINE,
  CF: { contact: 0.3, power: 0.15, speed: 0.22, fielding: 0.33 },
  '2B': MIDDLE,
  '3B': MIDDLE,
  '1B': CORNER,
  LF: CORNER,
  RF: CORNER,
  DH: { contact: 0.5, power: 0.42, speed: 0.08 },
  P: { pitching: 0.92, fielding: 0.08 },
};

export const primaryPosition = (p: Player): LineupPosition | 'P' => (p.isPitcher ? 'P' : (p.positions[0] ?? 'DH'));

function weighted(ratings: Record<RatingKey, number>, w: Weights): number {
  let sum = 0;
  let total = 0;
  for (const [k, v] of Object.entries(w) as [RatingKey, number][]) {
    sum += ratings[k] * v;
    total += v;
  }
  return Math.round(sum / total);
}

/** OVR at the player's primary position. */
export const overall = (p: Player): number => weighted(p.ratings, OVR_WEIGHTS[primaryPosition(p)]);

/** OVR if he played a given position, including the match engine's out-of-position fielding penalty. */
export function overallAt(p: Player, pos: LineupPosition | 'P'): number {
  const outOfPosition = pos !== 'DH' && pos !== 'P' && !p.positions.includes(pos);
  const ratings = outOfPosition ? { ...p.ratings, fielding: p.ratings.fielding - BALANCE.match.outOfPositionFieldingPenalty } : p.ratings;
  return weighted(ratings, OVR_WEIGHTS[pos]);
}

/**
 * Scouted potential translated to the OVR scale: the scouts' range for his
 * best rating, shifted by how far OVR sits below that rating today.
 */
export function potentialOverall(p: Player): { low: number; high: number } {
  const best = p.isPitcher ? p.ratings.pitching : Math.max(p.ratings.contact, p.ratings.fielding);
  const ovr = overall(p);
  const gap = best - ovr;
  return {
    low: Math.max(ovr, p.potentialEstimate.low - gap),
    high: Math.max(ovr, p.potentialEstimate.high - gap),
  };
}

export type OverallTier = 'elite' | 'good' | 'solid' | 'fringe' | 'weak';

export function overallTier(ovr: number): OverallTier {
  if (ovr >= 80) return 'elite';
  if (ovr >= 70) return 'good';
  if (ovr >= 60) return 'solid';
  if (ovr >= 50) return 'fringe';
  return 'weak';
}

export const TIER_LABEL: Record<OverallTier, string> = {
  elite: 'Elite',
  good: 'Good',
  solid: 'Solid',
  fringe: 'Fringe',
  weak: 'Weak',
};
