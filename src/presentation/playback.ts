import type { CommentaryStep } from './commentary';

/** Match tempo. Medium is the original pace; slow gives more reading time, fast halves it. */
export type Speed = 'slow' | 'medium' | 'fast';
export const TEMPO: Record<Speed, { label: string; factor: number }> = {
  slow: { label: 'Slow', factor: 0.65 },
  medium: { label: 'Medium', factor: 1 },
  fast: { label: 'Fast', factor: 2 },
};

/**
 * Playback position over precomputed commentary steps. It has no side effects
 * on the game: the match is already simulated and saved; this only decides
 * which step is shown. The UI hook owns the single timer that calls `next`.
 */
export class CommentaryPlayback {
  /** Step currently shown; −1 before the first. */
  index: number;
  auto = true;
  speed: Speed = 'medium';

  constructor(
    readonly steps: CommentaryStep[],
    startIndex = -1,
  ) {
    this.index = Math.max(-1, Math.min(steps.length - 1, startIndex));
  }

  get step(): CommentaryStep | null {
    return this.steps[this.index] ?? null;
  }

  get finished(): boolean {
    return this.steps.length === 0 || this.index >= this.steps.length - 1;
  }

  /** Shows the next step. Returns false at the end (nothing changes). */
  next(): boolean {
    if (this.finished) return false;
    this.index += 1;
    return true;
  }

  /** Jumps to the authoritative final step. */
  skip() {
    this.index = this.steps.length - 1;
    this.auto = false;
  }

  /** How long the current step stays before autoplay moves on; null when nothing is scheduled. */
  delay(): number | null {
    if (!this.auto || this.finished) return null;
    const d = this.step?.duration ?? 600;
    return Math.round(d / TEMPO[this.speed].factor);
  }
}
