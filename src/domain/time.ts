import { BALANCE } from '../balance/config';
import type { TimeState } from './state';

export interface TimeView {
  current: number;
  cap: number;
  unlimited: boolean;
  /** ms until the next point, or null at cap / in unlimited mode. */
  msToNext: number | null;
}

/**
 * Pure regeneration based on the stored reference and the injected clock.
 * - partial progress is kept (reference moves forward by whole intervals only)
 * - clamped to cap; at cap the reference follows `now` so no hidden reserve builds up
 * - if the clock moved backwards, no time is granted and the reference resets to `now`
 */
export function regenerate(time: TimeState, now: number): TimeState {
  const { cap, regenIntervalMs } = BALANCE.time;
  if (time.mode === 'unlimited') return { ...time, lastRegenAt: now };
  if (now < time.lastRegenAt) return { ...time, lastRegenAt: now };
  if (time.current >= cap) return { ...time, current: Math.min(time.current, cap), lastRegenAt: now };

  const gained = Math.floor((now - time.lastRegenAt) / regenIntervalMs);
  if (gained <= 0) return time;
  const current = Math.min(cap, time.current + gained);
  const lastRegenAt = current >= cap ? now : time.lastRegenAt + gained * regenIntervalMs;
  return { ...time, current, lastRegenAt };
}

export function viewTime(time: TimeState, now: number): TimeView {
  const r = regenerate(time, now);
  const { cap, regenIntervalMs } = BALANCE.time;
  if (r.mode === 'unlimited') return { current: cap, cap, unlimited: true, msToNext: null };
  const msToNext = r.current >= cap ? null : Math.max(0, r.lastRegenAt + regenIntervalMs - now);
  return { current: r.current, cap, unlimited: false, msToNext };
}

export function canAffordTime(time: TimeState, now: number, cost: number): boolean {
  if (time.mode === 'unlimited') return true;
  return regenerate(time, now).current >= cost;
}

export function spendTime(time: TimeState, now: number, cost: number): TimeState {
  const r = regenerate(time, now);
  if (r.mode === 'unlimited' || cost === 0) return r;
  if (r.current < cost) throw new Error('Not enough Time');
  const wasAtCap = r.current >= BALANCE.time.cap;
  return { ...r, current: r.current - cost, lastRegenAt: wasAtCap ? now : r.lastRegenAt };
}
