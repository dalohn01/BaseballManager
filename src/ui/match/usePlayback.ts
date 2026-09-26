import { useEffect, useReducer, useRef } from 'react';
import type { MatchContext } from '../../presentation/adapter';
import { MatchPlayback, type PlaybackMode } from '../../presentation/playback';

const cursorKey = (matchId: string) => `bm.match.${matchId}`;

function readCursor(matchId: string): number {
  try {
    const v = sessionStorage.getItem(cursorKey(matchId));
    return v === null ? -1 : Number(v);
  } catch {
    return -1;
  }
}
function writeCursor(matchId: string, cursor: number) {
  try {
    sessionStorage.setItem(cursorKey(matchId), String(cursor));
  } catch {
    /* storage unavailable: playback restarts from the beginning next time */
  }
}
function readMode(): PlaybackMode {
  try {
    return localStorage.getItem('bm.matchMode') === 'all' ? 'all' : 'highlights';
  } catch {
    return 'highlights';
  }
}

/**
 * Drives a MatchPlayback with a single requestAnimationFrame clock. Frame time
 * is capped, so a tab returning from the background never replays a storm of
 * delayed animation. Leaving the screen stops the loop; coming back resumes
 * after the last completed sequence.
 */
export function useMatchPlayback(ctx: MatchContext, matchId: string, reducedMotion: boolean) {
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  const ref = useRef<{ id: string; pb: MatchPlayback } | null>(null);
  if (!ref.current || ref.current.id !== matchId) {
    ref.current = { id: matchId, pb: new MatchPlayback(ctx, readMode(), reducedMotion, readCursor(matchId)) };
  }
  const pb = ref.current.pb;

  useEffect(() => {
    // requestAnimationFrame pauses in background tabs; the fallback keeps non-browser environments working.
    const requestFrame = typeof requestAnimationFrame === 'function' ? requestAnimationFrame : (cb: FrameRequestCallback) => window.setTimeout(() => cb(performance.now()), 16);
    const cancelFrame = typeof cancelAnimationFrame === 'function' ? cancelAnimationFrame : (id: number) => window.clearTimeout(id);
    let raf = 0;
    let last = performance.now();
    let saved = pb.revealedThrough;
    const loop = (now: number) => {
      const dt = Math.min(100, Math.max(0, now - last));
      last = now;
      if (pb.phase === 'playing' || (pb.auto && pb.phase === 'ready')) {
        pb.tick(dt);
        rerender();
      }
      if (pb.revealedThrough !== saved && pb.phase !== 'playing') {
        saved = pb.revealedThrough;
        writeCursor(matchId, saved);
      }
      raf = requestFrame(loop);
    };
    raf = requestFrame(loop);
    const onVisible = () => {
      last = performance.now();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      cancelFrame(raf);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [pb, matchId]);

  return {
    pb,
    next: () => {
      pb.next();
      rerender();
    },
    skip: () => {
      pb.skip();
      writeCursor(matchId, pb.revealedThrough);
      rerender();
    },
    setAuto: (on: boolean) => {
      pb.setAuto(on);
      if (on && pb.phase === 'ready') pb.next();
      rerender();
    },
    setMode: (mode: PlaybackMode) => {
      pb.setMode(mode);
      try {
        localStorage.setItem('bm.matchMode', mode);
      } catch {
        /* per-viewer convenience only */
      }
      rerender();
    },
  };
}
