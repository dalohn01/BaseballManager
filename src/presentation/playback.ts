import { buildPresentation, isHighlight, type DisplayState, type MatchContext, type Presentation } from './adapter';
import { TIMING } from './fieldConfig';
import { frameAt, type Frame } from './frame';

export type PlaybackMode = 'highlights' | 'all';
export type PlaybackPhase = 'ready' | 'playing' | 'finished';

/**
 * Playback controller for an already simulated match. One clock (`tick`), one
 * sequence at a time, no side effects on the game: it only decides what is
 * shown. The match result itself is final and stored before playback starts.
 */
export class MatchPlayback {
  phase: PlaybackPhase = 'ready';
  /** Sequence being played, or the last one completed. −1 before the first. */
  cursor = -1;
  /** Everything up to this index may be shown in the log and stats. */
  revealedThrough = -1;
  t = 0;
  auto = false;
  presentation: Presentation | null = null;
  private autoWait = 0;
  private readonly count: number;

  constructor(
    private readonly ctx: MatchContext,
    public mode: PlaybackMode = 'highlights',
    private readonly reducedMotion = false,
    startCursor = -1,
  ) {
    this.count = ctx.match.sequence?.length ?? 0;
    if (this.count === 0) {
      this.phase = 'finished';
      return;
    }
    if (startCursor >= this.count - 1) {
      this.skip();
    } else if (startCursor >= 0) {
      // Resume after a completed sequence (e.g. returning to the screen).
      this.cursor = startCursor;
      this.revealedThrough = startCursor;
      this.presentation = buildPresentation(ctx, startCursor, { reducedMotion });
      this.t = this.presentation.duration;
    } else {
      this.presentation = buildPresentation(ctx, 0, { reducedMotion });
      this.t = 0;
    }
  }

  private nextIndex(): number | null {
    const seq = this.ctx.match.sequence!;
    for (let i = this.cursor + 1; i < this.count; i++) {
      if (this.mode === 'all' || isHighlight(seq, i)) return i;
    }
    return null;
  }

  /** Starts the next sequence. Ignored while one is playing (no double playback). */
  next(): boolean {
    if (this.phase !== 'ready') return false;
    const i = this.nextIndex();
    if (i === null) {
      this.skip();
      return false;
    }
    // Steps passed over in highlight mode are revealed (log and scoreboard catch up to this step's before-state).
    this.revealedThrough = i - 1;
    this.cursor = i;
    this.presentation = buildPresentation(this.ctx, i, { reducedMotion: this.reducedMotion });
    this.t = 0;
    this.autoWait = 0;
    this.phase = 'playing';
    return true;
  }

  /** Advances the single playback clock. `dt` is capped by the caller (background tabs pause). */
  tick(dt: number) {
    if (this.phase === 'playing' && this.presentation) {
      this.t = Math.min(this.presentation.duration, this.t + dt);
      if (this.t >= this.presentation.duration) {
        this.revealedThrough = this.cursor;
        this.phase = this.cursor >= this.count - 1 ? 'finished' : 'ready';
        this.autoWait = 0;
      }
      return;
    }
    if (this.phase === 'ready' && this.auto) {
      this.autoWait += dt;
      const pause = this.reducedMotion ? TIMING.autoPause * TIMING.reducedScale : TIMING.autoPause;
      if (this.autoWait >= pause) this.next();
    }
  }

  setAuto(on: boolean) {
    // Turning auto off lets the current sequence finish but starts no new one.
    this.auto = on;
    this.autoWait = 0;
  }

  setMode(mode: PlaybackMode) {
    this.mode = mode;
  }

  /** Ends playback and shows the authoritative final result. */
  skip() {
    this.phase = 'finished';
    this.cursor = this.count - 1;
    this.revealedThrough = this.count - 1;
    this.auto = false;
    if (this.count > 0) {
      this.presentation = buildPresentation(this.ctx, this.count - 1, { reducedMotion: this.reducedMotion });
      this.t = this.presentation.duration;
    }
  }

  /** Last index whose result may be shown right now (the playing one only after its result moment). */
  get logThrough(): number {
    if (this.phase === 'playing' && this.presentation && this.t >= this.presentation.resultAt) return this.cursor;
    return this.revealedThrough;
  }

  frame(): Frame | null {
    return this.presentation ? frameAt(this.presentation, this.t) : null;
  }

  /** Scoreboard state currently shown. */
  display(): DisplayState | null {
    return this.frame()?.state ?? null;
  }
}
