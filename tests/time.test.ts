import { describe, expect, it } from 'vitest';
import { BALANCE } from '../src/balance/config';
import { execute } from '../src/application/engine';
import { regenerate, spendTime, viewTime } from '../src/domain/time';
import { newGame, T0, run } from './helpers';

const I = BALANCE.time.regenIntervalMs;

describe('Time regeneration', () => {
  it('regenerates while away and keeps partial progress', () => {
    const t = { current: 5, lastRegenAt: T0, mode: 'economy' as const };
    const r = regenerate(t, T0 + 2 * I + I / 2);
    expect(r.current).toBe(7);
    expect(r.lastRegenAt).toBe(T0 + 2 * I);
    expect(viewTime(t, T0 + 2 * I + I / 2).msToNext).toBe(I / 2);
  });

  it('clamps at cap without building a hidden reserve', () => {
    const t = { current: 10, lastRegenAt: T0, mode: 'economy' as const };
    const r = regenerate(t, T0 + 50 * I);
    expect(r.current).toBe(BALANCE.time.cap);
    const spent = spendTime(r, T0 + 50 * I, 1);
    expect(spent.current).toBe(BALANCE.time.cap - 1);
    // One interval after spending from full, exactly one point returns.
    expect(regenerate(spent, T0 + 51 * I - 1).current).toBe(BALANCE.time.cap - 1);
    expect(regenerate(spent, T0 + 51 * I).current).toBe(BALANCE.time.cap);
  });

  it('grants nothing when the clock moves backwards', () => {
    const t = { current: 3, lastRegenAt: T0, mode: 'economy' as const };
    const r = regenerate(t, T0 - 5 * I);
    expect(r.current).toBe(3);
    // The reference resets to the earlier clock; real elapsed time from there counts normally.
    expect(regenerate(r, T0).current).toBe(3 + 5);
  });

  it("zero Time never blocks today's events, only the next day; test mode never waits", () => {
    let s = newGame(1, 'economy');
    s = { ...s, time: { ...s.time, current: 0, lastRegenAt: T0 } };
    // Handle the whole preseason day with no Time at all.
    for (let i = 0; i < 6 && s.currentEvent; i++) {
      const ev = s.currentEvent;
      if (ev.status === 'pending') s = run(s, { type: 'resolveEvent', eventId: ev.id, revision: s.revision, optionId: ev.options[0].id, boostId: null });
      else s = run(s, { type: 'acknowledgeEvent', eventId: ev.id });
    }
    expect(s.currentEvent).toBeNull();
    const cmd = { type: 'advanceDay' as const, revision: s.revision };
    const r = execute(s, cmd, T0);
    expect(!r.ok && r.code).toBe('unaffordable');
    const later = execute(s, cmd, T0 + I);
    expect(later.ok).toBe(true);
    if (later.ok) expect(later.state.time.current).toBe(0);

    const test = execute(s, { type: 'setTimeMode', mode: 'unlimited' }, T0);
    expect(test.ok).toBe(true);
    if (test.ok) expect(execute(test.state, { ...cmd, revision: test.state.revision }, T0).ok).toBe(true);
  });

  it('does not advance the season while the player is away', () => {
    const s = newGame(1, 'economy');
    const r = execute(s, { type: 'setTimeMode', mode: 'economy' }, T0 + 1000 * I);
    expect(r.ok && r.state.calendar).toEqual(s.calendar);
    expect(r.ok && r.state.currentEvent!.id).toBe(s.currentEvent!.id);
  });
});
