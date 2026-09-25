import { createContext, useContext, useEffect, useState, useSyncExternalStore } from 'react';
import type { GameController } from '../application/controller';
import type { GameState } from '../domain/state';

export const ControllerContext = createContext<GameController | null>(null);

export function useController(): GameController {
  const c = useContext(ControllerContext);
  if (!c) throw new Error('No GameController');
  return c;
}

export function useSnapshot() {
  const c = useController();
  return useSyncExternalStore(c.subscribe, c.getSnapshot);
}

/** The game state; only call inside screens rendered when a game is loaded. */
export function useGame(): GameState {
  const s = useSnapshot().state;
  if (!s) throw new Error('No game loaded');
  return s;
}

/** Re-renders every `ms` with the injected clock's time (for Time countdowns). */
export function useNow(ms = 1000): number {
  const c = useController();
  const [now, setNow] = useState(() => c.clock.now());
  useEffect(() => {
    const id = setInterval(() => setNow(c.clock.now()), ms);
    return () => clearInterval(id);
  }, [c, ms]);
  return now;
}

export type Route =
  | { name: 'home' }
  | { name: 'team' }
  | { name: 'player'; id: string }
  | { name: 'club' }
  | { name: 'league' }
  | { name: 'history' }
  | { name: 'settings' };

function parseHash(hash: string): Route {
  const parts = hash.replace(/^#\/?/, '').split('/');
  switch (parts[0]) {
    case 'team':
      return parts[1] ? { name: 'player', id: parts[1] } : { name: 'team' };
    case 'club':
    case 'league':
    case 'history':
    case 'settings':
      return { name: parts[0] };
    default:
      return { name: 'home' };
  }
}

export function useRoute(): Route {
  const [route, setRoute] = useState(() => parseHash(location.hash));
  useEffect(() => {
    const on = () => {
      setRoute(parseHash(location.hash));
      window.scrollTo(0, 0);
    };
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return route;
}

export const href = (r: string) => `#/${r}`;

export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() => readPref('reducedMotion') ?? matchMedia('(prefers-reduced-motion: reduce)').matches);
  useEffect(() => {
    const on = () => setReduced(readPref('reducedMotion') ?? matchMedia('(prefers-reduced-motion: reduce)').matches);
    window.addEventListener('bm-prefs', on);
    return () => window.removeEventListener('bm-prefs', on);
  }, []);
  return reduced;
}

/** UI-only preferences (not game state), kept in localStorage. */
export function readPref(key: string): boolean | null {
  try {
    const v = localStorage.getItem(`bm.${key}`);
    return v === null ? null : v === '1';
  } catch {
    return null;
  }
}
export function writePref(key: string, value: boolean) {
  try {
    localStorage.setItem(`bm.${key}`, value ? '1' : '0');
  } catch {
    /* ignore */
  }
  window.dispatchEvent(new Event('bm-prefs'));
}
