import { useEffect, useReducer, useRef, useState } from 'react';
import type { CommentaryStep } from '../../presentation/commentary';
import { CommentaryPlayback, type Speed } from '../../presentation/playback';

/*
 * Playback position is presentation state only: it is kept per viewer in
 * localStorage, separate from the saved game, so replaying or resuming a
 * match can never write results, stats or rewards again.
 */
const PREFIX = 'bm.cmt.';
const posKey = (matchId: string) => `${PREFIX}${matchId}`;

export function readPosition(matchId: string): number | null {
  try {
    const v = localStorage.getItem(posKey(matchId));
    return v === null ? null : Number(v);
  } catch {
    return null;
  }
}
function writePosition(matchId: string, index: number) {
  try {
    // Only one match is live at a time: drop positions of older matches.
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (k?.startsWith(PREFIX) && k !== posKey(matchId)) localStorage.removeItem(k);
    }
    localStorage.setItem(posKey(matchId), String(index));
  } catch {
    /* storage unavailable: the match simply starts over next time */
  }
}
function readSpeed(): Speed {
  try {
    const v = localStorage.getItem('bm.matchTempo');
    return v === 'slow' || v === 'fast' ? v : 'medium';
  } catch {
    return 'medium';
  }
}

/**
 * One controller for everything shown in the match: a single timeout moves to
 * the next step. Next moment, pause, speed changes, skip, hiding the tab and
 * leaving the screen all go through it, so no panel keeps its own timer and no
 * callback outlives the screen. A hidden tab pauses the clock; coming back
 * waits the full step again instead of catching up.
 */
export function useCommentaryPlayback(steps: CommentaryStep[], matchId: string, started: boolean) {
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  const ref = useRef<{ id: string; pb: CommentaryPlayback } | null>(null);
  if (!ref.current || ref.current.id !== matchId) {
    const pb = new CommentaryPlayback(steps, readPosition(matchId) ?? -1);
    pb.speed = readSpeed();
    ref.current = { id: matchId, pb };
  }
  const pb = ref.current.pb;
  const [hidden, setHidden] = useState(() => typeof document !== 'undefined' && document.visibilityState === 'hidden');

  useEffect(() => {
    const on = () => setHidden(document.visibilityState === 'hidden');
    document.addEventListener('visibilitychange', on);
    return () => document.removeEventListener('visibilitychange', on);
  }, []);

  // Starting after the intro shows the first step right away.
  useEffect(() => {
    if (started && pb.index < 0) {
      pb.next();
      writePosition(matchId, pb.index);
      rerender();
    }
  }, [started, pb, matchId]);

  const delay = started && !hidden ? pb.delay() : null;
  useEffect(() => {
    if (delay === null) return;
    const id = window.setTimeout(() => {
      if (pb.next()) writePosition(matchId, pb.index);
      rerender();
    }, delay);
    return () => window.clearTimeout(id);
    // pb.index is part of the key so each step gets exactly one timer.
  }, [delay, pb, pb.index, matchId]);

  return {
    pb,
    next: () => {
      // Replaces the running timer (the effect above re-keys on the new index).
      if (pb.next()) writePosition(matchId, pb.index);
      rerender();
    },
    skip: () => {
      pb.skip();
      writePosition(matchId, pb.index);
      rerender();
    },
    setAuto: (on: boolean) => {
      pb.auto = on;
      rerender();
    },
    setSpeed: (speed: Speed) => {
      pb.speed = speed;
      try {
        localStorage.setItem('bm.matchTempo', speed);
      } catch {
        /* per-viewer convenience only */
      }
      rerender();
    },
  };
}
