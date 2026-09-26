import type { FieldSpot } from '../domain/types';

/**
 * One logical coordinate system for everything that moves on the field.
 * Points are relative (0–1, origin top-left) inside the field area and are
 * converted to SVG units by `toView`. Calibrated visually for the stylised
 * top-down view; not real ballpark distances.
 */
export interface Pt {
  x: number;
  y: number;
}

export const VIEW = { width: 1000, height: 720 } as const;
export const toView = (p: Pt): Pt => ({ x: p.x * VIEW.width, y: p.y * VIEW.height });

export const BASES = {
  home: { x: 0.5, y: 0.88 },
  first: { x: 0.73, y: 0.59 },
  second: { x: 0.5, y: 0.3 },
  third: { x: 0.27, y: 0.59 },
} as const;

/** Index 0 = home, 1–3 = bases; 4 = home again (after scoring). */
export const BASE_PATH: Pt[] = [BASES.home, BASES.first, BASES.second, BASES.third, BASES.home];

export const MOUND: Pt = { x: 0.5, y: 0.65 };

export const FIELDER_SPOTS: Record<FieldSpot, Pt> = {
  P: MOUND,
  C: { x: 0.5, y: 0.95 },
  '1B': { x: 0.77, y: 0.53 },
  '2B': { x: 0.64, y: 0.42 },
  SS: { x: 0.37, y: 0.42 },
  '3B': { x: 0.24, y: 0.53 },
  LF: { x: 0.2, y: 0.22 },
  CF: { x: 0.5, y: 0.11 },
  RF: { x: 0.8, y: 0.22 },
  DH: { x: 0.5, y: 0.95 },
};

export const BATTER_BOX = { right: { x: 0.465, y: 0.87 }, left: { x: 0.535, y: 0.87 } } as const;

/** Where a runner stands on a base (slightly off the bag so the bag stays visible). */
export const RUNNER_OFFSET: Pt = { x: 0.018, y: 0.012 };

/** Dugouts: batting team leaves/enters here; relievers walk in from here. */
export const DUGOUT = { home: { x: 0.12, y: 0.92 }, away: { x: 0.88, y: 0.92 } } as const;

/** The outfield fence radius (from home plate, in the aspect-corrected unit used by ballTarget). */
export const FENCE_RADIUS = 0.82;

/**
 * Timing in ms (readability values, not physics). All animation code reads
 * from here; reduced motion scales everything by `reducedScale`.
 */
export const TIMING = {
  setup: 350,
  pitch: 550,
  swing: 170,
  flight: { ground: 700, line: 600, fly: 1100, pop: 950, over: 1300 },
  fielderReact: 150,
  throwMs: 420,
  perBase: 380,
  resultHold: 700,
  autoPause: 550,
  halfChange: 900,
  special: 1200,
  reducedScale: 0.35,
} as const;
