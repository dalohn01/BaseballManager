import { describe, expect, it } from 'vitest';
import { BALANCE } from '../src/balance/config';
import { dayShare, payrollPerSeason, seasonForecast, upkeepPerRound } from '../src/simulation/economy';
import { advanceDay, newGame, step, toNextEvent } from './helpers';

describe('running costs paid daily', () => {
  it('day shares split a round amount exactly', () => {
    for (const amount of [0, 1, 2, 3, 1000, 4_999, 12_347]) {
      let total = 0;
      for (let d = 1; d <= BALANCE.season.daysPerRound; d++) total += dayShare(amount, d);
      expect(total).toBe(amount);
    }
  });

  it('salaries and upkeep are charged once per regular day, never at the game; the season total is exact', () => {
    let s = newGame(91);
    const payroll = payrollPerSeason(s, s.userClubId);
    const upkeep = upkeepPerRound(s.clubs.hfx) * BALANCE.season.rounds;
    // Before the season starts, the forecast covers every day.
    const f = seasonForecast(s, s.userClubId);
    expect(f.salaries).toBe(payroll);
    expect(f.upkeep).toBe(upkeep);
    // No roster or facility changes: release decisions are possible in events, so compare against the ledger itself.
    for (let i = 0; i < 2000 && s.calendar.season === 1; i++) s = step(s, 7000 + i);
    const season1 = s.ledger.filter((l) => l.season === 1);
    const daily = season1.filter((l) => l.eventId?.startsWith('day:'));
    const days = new Set(daily.map((l) => l.eventId));
    expect(days.size).toBe(BALANCE.season.rounds * BALANCE.season.daysPerRound);
    // Each day has at most one salary line and one upkeep line.
    for (const id of days) {
      const lines = daily.filter((l) => l.eventId === id);
      expect(lines.filter((l) => l.category === 'salaries').length).toBeLessThanOrEqual(1);
      expect(lines.filter((l) => l.category === 'upkeep').length).toBeLessThanOrEqual(1);
    }
    // Game days only carry income (and event effects), no running costs.
    const atGames = season1.filter((l) => !l.eventId?.startsWith('day:') && (l.category === 'upkeep' || (l.category === 'salaries' && !/buyout/.test(l.note))));
    expect(atGames).toEqual([]);
  }, 120_000);

  it('the day card has today’s costs after advancing, and the forecast drops by exactly that', () => {
    let s = newGame(92);
    s = toNextEvent(s);
    while (s.calendar.round === 0) s = step(s, 1);
    while (s.currentEvent) s = step(s, 2);
    const before = seasonForecast(s, s.userClubId);
    const cash = s.clubs.hfx.cash;
    s = advanceDay(s);
    const paid = s.ledger.filter((l) => l.eventId === `day:${s.calendar.season}:${s.calendar.round}:${s.calendar.day}`);
    const total = -paid.reduce((a, l) => a + l.amount, 0);
    expect(total).toBeGreaterThan(0);
    expect(cash - s.clubs.hfx.cash).toBe(total);
    const after = seasonForecast(s, s.userClubId);
    expect(before.salaries + before.upkeep - (after.salaries + after.upkeep)).toBe(total);
  });
});
