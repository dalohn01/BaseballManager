import { BALANCE } from '../balance/config';
import { clamp, createRng, hashSeed } from './rng';
import type { Player, RatingKey } from './types';

/*
 * Pitchers have four values, like hitters: Velocity (arm strength: strikeouts),
 * Control (walks and mistakes), Stamina (how long he lasts) and Fielding.
 * "Pitching" is kept as the derived quality, the average of velocity and
 * control, so forecasts, team strength and OVR keep one comparable number.
 * The position follows stamina: SP (starter) or RP (reliever).
 */

export const PITCHER_KEYS: RatingKey[] = ['velocity', 'control', 'stamina', 'fielding'];
export const HITTER_KEYS: RatingKey[] = ['contact', 'power', 'speed', 'fielding'];

export type PitcherPosition = 'SP' | 'RP';

export const pitcherPosition = (p: Player): PitcherPosition => (p.ratings.stamina >= BALANCE.pitching.starterStaminaFrom ? 'SP' : 'RP');

/** Display position: SP/RP for pitchers, the primary field position for hitters. */
export const positionLabel = (p: Player): string => (p.isPitcher ? pitcherPosition(p) : p.positions.join('/'));

/** Keeps the derived pitching quality in line with velocity and control. */
export function syncPitching(p: Player) {
  if (!p.isPitcher) return;
  p.ratings.pitching = Math.round((p.ratings.velocity + p.ratings.control) / 2);
}

/**
 * Splits a pitching level into velocity and control around it (their average
 * stays the level) and gives a stamina that fits the role: starters long,
 * relievers short. Stable per player (own seed), independent of the main RNG.
 */
export function splitPitching(id: string, pitching: number, starter: boolean): { velocity: number; control: number; stamina: number } {
  const rng = createRng(hashSeed(`pitch:${id}`));
  const d = rng.int(-9, 9);
  const velocity = clamp(Math.round(pitching + d), 20, 95);
  const control = clamp(2 * pitching - velocity, 20, 95);
  const stamina = starter ? rng.int(62, 82) : rng.int(28, 52);
  return { velocity, control, stamina };
}

/** Ratings for a new player: hitters get placeholder pitching values, pitchers a split. */
export function withPitchingRatings(id: string, isPitcher: boolean, ratings: { contact: number; power: number; speed: number; fielding: number; pitching: number }, starter: boolean): Record<RatingKey, number> {
  if (!isPitcher) return { ...ratings, velocity: 10, control: 10, stamina: 10 };
  const s = splitPitching(id, ratings.pitching, starter);
  return { ...ratings, ...s, pitching: Math.round((s.velocity + s.control) / 2) };
}

/** Batters a pitcher faces before he tires, from his stamina (style adds or saves a few). */
export function staminaBatters(stamina: number): number {
  const S = BALANCE.pitching;
  return Math.round(S.tiresBase + stamina * S.tiresPerStamina);
}
