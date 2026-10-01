import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { GameState } from '../../domain/state';
import { userClub } from '../../domain/state';
import { money } from '../format';
import { useReducedMotion } from '../hooks';
import { Icon } from './icons';

/*
 * The top bar's Club Cash is where money changes are shown: the number counts
 * to its new value and the change floats in beside it. A league game's money is
 * already saved when the lineup is confirmed, so the bar holds it back while the
 * game is shown and releases it when the Club report opens.
 */

const revealed = new Set<string>();
const listeners = new Set<() => void>();
let version = 0;

/** Called by the Club report: the game's money may now reach the top bar. */
export function revealMatchCash(eventId: string) {
  if (revealed.has(eventId)) return;
  revealed.add(eventId);
  version++;
  listeners.forEach((l) => l());
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

/** Money from the league game on screen that is not shown in the top bar yet. */
function heldCash(s: GameState): number {
  const ev = s.currentEvent;
  if (!ev || ev.type !== 'leagueGame' || ev.status !== 'resolved' || revealed.has(ev.id)) return 0;
  return s.ledger.filter((l) => l.eventId === ev.id).reduce((a, l) => a + l.amount, 0);
}

const COUNT_MS = 900;
const DELTA_MS = 2600;

export function CashPill({ state }: { state: GameState }) {
  useSyncExternalStore(subscribe, () => version);
  const reduced = useReducedMotion();
  const target = userClub(state).cash - heldCash(state);
  const [shown, setShown] = useState(target);
  const [delta, setDelta] = useState<{ amount: number; key: number } | null>(null);
  // The value on screen and the last target: the count always runs from what is shown,
  // so an interrupted or re-run effect (StrictMode) simply continues.
  const shownRef = useRef(target);
  const lastTarget = useRef(target);
  const raf = useRef(0);

  useEffect(() => {
    if (lastTarget.current !== target) {
      setDelta({ amount: target - lastTarget.current, key: Date.now() });
      lastTarget.current = target;
    }
    const start = shownRef.current;
    if (start === target) return;
    if (reduced) {
      shownRef.current = target;
      setShown(target);
      return;
    }
    const t0 = performance.now();
    const tick = (now: number) => {
      const k = Math.min(1, (now - t0) / COUNT_MS);
      const eased = 1 - Math.pow(1 - k, 3);
      shownRef.current = Math.round(start + (target - start) * eased);
      setShown(shownRef.current);
      if (k < 1) raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
  }, [target, reduced]);

  useEffect(() => {
    if (!delta) return;
    const id = window.setTimeout(() => setDelta(null), DELTA_MS);
    return () => window.clearTimeout(id);
  }, [delta]);

  return (
    <span className={`pill cash-pill ${target < 0 ? 'pill-bad' : ''}`} title="Club Cash">
      <Icon name="cash" className="ico-cash" />
      <span className="sr-only">Club Cash</span>
      {money(shown)}
      {delta && (
        <span key={delta.key} className={`cash-delta ${delta.amount >= 0 ? 'pos' : 'neg'} ${reduced ? 'still' : ''}`} role="status">
          {delta.amount >= 0 ? '+' : '−'}
          {money(Math.abs(delta.amount))}
        </span>
      )}
    </span>
  );
}
