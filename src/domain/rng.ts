/**
 * Seeded, serialisable PRNG (mulberry32). The whole generator state is a single
 * uint32 so it can be stored in GameState and restored exactly after load.
 */
export interface Rng {
  next(): number;
  int(min: number, maxInclusive: number): number;
  range(min: number, max: number): number;
  chance(p: number): boolean;
  pick<T>(items: readonly T[]): T;
  weighted<T>(items: readonly { item: T; weight: number }[]): T | undefined;
  shuffle<T>(items: readonly T[]): T[];
  getState(): number;
}

export function createRng(state: number): Rng {
  let s = state >>> 0;

  const next = (): number => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  const rng: Rng = {
    next,
    int: (min, maxInclusive) => min + Math.floor(next() * (maxInclusive - min + 1)),
    range: (min, max) => min + next() * (max - min),
    chance: (p) => next() < p,
    pick: (items) => {
      if (items.length === 0) throw new Error('rng.pick on empty list');
      return items[Math.floor(next() * items.length)];
    },
    weighted: (items) => {
      const total = items.reduce((sum, i) => sum + Math.max(0, i.weight), 0);
      if (total <= 0) return undefined;
      let roll = next() * total;
      for (const i of items) {
        const w = Math.max(0, i.weight);
        if (roll < w) return i.item;
        roll -= w;
      }
      return items[items.length - 1].item;
    },
    shuffle: (items) => {
      const copy = [...items];
      for (let i = copy.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1));
        [copy[i], copy[j]] = [copy[j], copy[i]];
      }
      return copy;
    },
    getState: () => s,
  };
  return rng;
}

/** FNV-1a string hash, used to turn user-entered seeds into a uint32. */
export function hashSeed(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));
