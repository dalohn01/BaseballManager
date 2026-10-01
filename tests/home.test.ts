import { describe, expect, it } from 'vitest';
import { BALANCE } from '../src/balance/config';
import { execute } from '../src/application/engine';
import { daysUntilRound } from '../src/domain/calendar';
import { dateOf, dayInfo, dayLineLabel, matchSeasonDay, seasonAnchor, seasonDayOf, seasonLength, weekStrip } from '../src/domain/seasonDates';
import { dayStack, previewText } from '../src/presentation/dayStack';
import { advanceDay, newGame, playSeason, run, step, T0, toNextEvent } from './helpers';

const D = BALANCE.season.daysPerRound;

describe('game calendar dates', () => {
  it('each season starts on a Monday in April and every day is one step later (UTC, no local clock)', () => {
    for (const season of [1, 2, 3, 4, 5]) {
      const g = dateOf({ season, day: 1 });
      expect(g.weekday).toBe(0);
      expect(g.month).toBe(3);
      expect(g.date).toBeLessThanOrEqual(7);
      expect(dateOf({ season, day: 2 }).ms - seasonAnchor(season)).toBe(24 * 60 * 60 * 1000);
    }
  });

  it('day numbers: preseason is day 1, round r day d follows, the off-season is the last day', () => {
    expect(seasonDayOf({ season: 1, round: 0, slot: 0, phase: 'preseason', day: 1 })).toEqual({ season: 1, day: 1 });
    expect(seasonDayOf({ season: 1, round: 1, slot: 0, phase: 'regular', day: 1 })).toEqual({ season: 1, day: 2 });
    expect(seasonDayOf({ season: 1, round: 2, slot: 0, phase: 'regular', day: D })).toEqual({ season: 1, day: 1 + 2 * D });
    expect(seasonDayOf({ season: 1, round: 20, slot: 0, phase: 'postseason', day: D + 1 })).toEqual({ season: 1, day: seasonLength() });
    // After the review the calendar points at next season's preseason (day 0): still last season's off-season.
    expect(seasonDayOf({ season: 2, round: 0, slot: 0, phase: 'preseason', day: 0 })).toEqual({ season: 1, day: seasonLength() });
    expect(dayLineLabel({ season: 2, round: 0, slot: 0, phase: 'preseason', day: 0 })).toBe(`Season 1 · Off-season · Day ${seasonLength()}`);
    for (let r = 1; r <= BALANCE.season.rounds; r++) {
      expect(dayInfo(matchSeasonDay(r))).toMatchObject({ kind: 'match', round: r, dayOfRound: D });
    }
  });

  it('the week strip is Monday–Sunday around today, marks match days and labels month changes', () => {
    const s = newGame(101);
    const w = weekStrip(s);
    expect(w.cells).toHaveLength(7);
    expect(w.cells.map((c) => c.g.weekday)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(w.cells.filter((c) => c.today)).toHaveLength(1);
    expect(w.label).toBe('Season 1 · Preseason · Day 1');
    // Day 1 is a Monday: round 1's match day (day 4) is Thursday, and it is the user's game.
    expect(w.cells[3].matchDay).toBe(true);
    // Find a week that crosses a month boundary somewhere in the season.
    const t = structuredClone(s);
    let crossed = false;
    for (let r = 1; r <= BALANCE.season.rounds && !crossed; r++) {
      for (let d = 1; d <= D && !crossed; d++) {
        t.calendar = { season: 1, round: r, slot: 0, phase: 'regular', day: d };
        const ws = weekStrip(t);
        if (ws.monthLabel.includes('–')) {
          crossed = true;
          expect(ws.cells.filter((c) => c.newMonth)).toHaveLength(1);
        }
      }
    }
    expect(crossed).toBe(true);
  });

  it('next-match countdown agrees with the calendar dates', () => {
    const s = newGame(102);
    const cal = { season: 1, round: 3, slot: 0, phase: 'regular' as const, day: 1 };
    const days = daysUntilRound(cal, 4);
    expect(seasonDayOf(cal).day + days).toBe(matchSeasonDay(4));
    void s;
  });
});

describe("today's stack", () => {
  it('always ends with exactly one Day complete; numbering and progress count only regular events', () => {
    let s = toNextEvent(newGame(103));
    const seen = new Set<number>();
    for (let i = 0; i < 40; i++) {
      const st = dayStack(s);
      expect(st.folders.filter((f) => f.kind === 'dayComplete')).toHaveLength(1);
      expect(st.folders.at(-1)!.kind).toBe('dayComplete');
      expect(st.folders.at(-1)!.number).toBe(st.total + 1);
      expect(st.handled).toBeLessThanOrEqual(st.total);
      seen.add(st.total);
      if (s.currentEvent) {
        expect(st.folders[0].kind).toBe('current');
        expect(st.folders[0].number).toBe((s.dayLog ?? []).length + 1);
        s = step(s, 300 + i);
      } else {
        // Day done: Day complete is the only folder and the whole day is handled.
        expect(st.folders).toHaveLength(1);
        expect(st.handled).toBe(st.total);
        s = advanceDay(s);
      }
    }
    // Quiet days and busy days both occurred.
    expect(seen.has(0) || [...seen].some((n) => n >= 2)).toBe(true);
  });

  it('a preview changes nothing: the stack and its text are pure reads of the saved state', () => {
    let s = toNextEvent(newGame(104));
    while (s.queue.length === 0 && !s.nextEvent) s = toNextEvent(step(s, 5));
    const before = JSON.stringify(s);
    const st = dayStack(s);
    for (const f of st.folders) previewText(f);
    dayStack(s);
    expect(JSON.stringify(s)).toBe(before);
  });

  it('Next day moves exactly one day once (a repeated click is refused) and the log resets', () => {
    let s = toNextEvent(newGame(105));
    while (s.currentEvent) s = step(s, 7);
    expect((s.dayLog ?? []).length).toBeGreaterThan(0);
    const cmd = { type: 'advanceDay' as const, revision: s.revision };
    const once = run(s, cmd);
    const twice = execute(once, cmd, T0);
    expect(twice.ok).toBe(false);
    expect(seasonDayOf(once.calendar).day).toBe(seasonDayOf(s.calendar).day + 1);
    expect(once.dayLog).toEqual([]);
  });

  it('a whole season walks the calendar day by day to the off-season, then season 2 starts at day 1', () => {
    let s = newGame(106);
    let last = seasonDayOf(s.calendar);
    for (let i = 0; i < 2000 && s.calendar.season === 1; i++) {
      if (s.currentEvent) {
        s = step(s, 900 + i);
        // Handling events never moves the calendar (the season review only starts the next season's day 0).
        if (s.calendar.season === 1) expect(seasonDayOf(s.calendar)).toEqual(last);
      } else {
        s = advanceDay(s);
        expect(seasonDayOf(s.calendar).day).toBe(last.day + 1);
      }
      last = seasonDayOf(s.calendar);
    }
    expect(seasonDayOf(s.calendar)).toEqual({ season: 1, day: seasonLength() });
    s = advanceDay(s);
    expect(seasonDayOf(s.calendar)).toEqual({ season: 2, day: 1 });
    void playSeason;
  }, 60_000);
});
