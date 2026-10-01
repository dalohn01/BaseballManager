import { BALANCE } from '../balance/config';
import { dayKind, userGame } from './calendar';
import type { Calendar, GameState } from './state';

/*
 * Dates on the game calendar. Each season has a stable anchor: day 1 (the
 * preseason day) falls on the first Monday of April, in the year 2025 + season.
 * Every later date is derived from the season day number, in UTC, so nothing
 * depends on the computer's clock, time zone or midnight.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
export const WEEKDAYS_LONG = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

/** Last day number of a season: preseason, every regular day, then the off-season day. */
export const seasonLength = () => 1 + BALANCE.season.rounds * BALANCE.season.daysPerRound + 1;

/** UTC ms of a season's day 1. */
export function seasonAnchor(season: number): number {
  const year = 2025 + season;
  const april1 = Date.UTC(year, 3, 1);
  const weekday = (new Date(april1).getUTCDay() + 6) % 7; // 0 = Monday
  return april1 + ((7 - weekday) % 7) * DAY_MS;
}

/** A position on the calendar as shown: season and day number (1 = preseason). */
export interface SeasonDay {
  season: number;
  day: number;
}

/**
 * Today's season day. Regular round r, day d is 1 + (r−1)·D + d; the
 * off-season is the last day. Right after the season review the calendar
 * already points at next season's preseason (day 0): that is still the
 * previous season's off-season day until the manager advances.
 */
export function seasonDayOf(cal: Calendar): SeasonDay {
  const D = BALANCE.season.daysPerRound;
  if (cal.phase === 'preseason') return cal.day < 1 && cal.season > 1 ? { season: cal.season - 1, day: seasonLength() } : { season: cal.season, day: 1 };
  if (cal.phase === 'postseason') return { season: cal.season, day: seasonLength() };
  return { season: cal.season, day: 1 + (cal.round - 1) * D + cal.day };
}

/** What a season day number is: preseason, a regular round's day, or the off-season. */
export function dayInfo(day: number): { kind: 'preseason' | 'club' | 'match' | 'offseason' | 'outside'; round: number; dayOfRound: number } {
  const D = BALANCE.season.daysPerRound;
  if (day === 1) return { kind: 'preseason', round: 0, dayOfRound: 1 };
  if (day === seasonLength()) return { kind: 'offseason', round: BALANCE.season.rounds, dayOfRound: D + 1 };
  if (day < 1 || day > seasonLength()) return { kind: 'outside', round: 0, dayOfRound: 0 };
  const n = day - 2;
  const dayOfRound = (n % D) + 1;
  return { kind: dayOfRound === D ? 'match' : 'club', round: Math.floor(n / D) + 1, dayOfRound };
}

export interface GameDate {
  ms: number;
  weekday: number; // 0 = Monday
  date: number;
  month: number;
  year: number;
}

export function dateOf(sd: SeasonDay): GameDate {
  const ms = seasonAnchor(sd.season) + (sd.day - 1) * DAY_MS;
  const d = new Date(ms);
  return { ms, weekday: (d.getUTCDay() + 6) % 7, date: d.getUTCDate(), month: d.getUTCMonth(), year: d.getUTCFullYear() };
}

export const shortDate = (g: GameDate) => `${WEEKDAYS[g.weekday]} ${g.date} ${MONTHS[g.month]}`;
export const longDate = (g: GameDate) => `${WEEKDAYS_LONG[g.weekday]} ${g.date} ${MONTHS_LONG[g.month]}`;

export interface WeekCell {
  sd: SeasonDay;
  g: GameDate;
  today: boolean;
  past: boolean;
  /** Outside this season's days (shown blank and muted). */
  outside: boolean;
  matchDay: boolean;
  /** First day of a new month inside the strip (gets a small month label). */
  newMonth: boolean;
}

/** The Monday–Sunday week around today, with match days marked from the schedule. */
export function weekStrip(state: GameState): { cells: WeekCell[]; monthLabel: string; label: string } {
  const today = seasonDayOf(state.calendar);
  const g = dateOf(today);
  const cells: WeekCell[] = [];
  for (let i = 0; i < 7; i++) {
    const day = today.day - g.weekday + i;
    const sd = { season: today.season, day };
    const info = dayInfo(day);
    const cg = dateOf(sd);
    const prev = i > 0 ? cells[i - 1].g : null;
    cells.push({
      sd,
      g: cg,
      today: day === today.day,
      past: day < today.day,
      outside: info.kind === 'outside',
      matchDay: info.kind === 'match' && !!userGame(state, today.season, info.round),
      newMonth: !!prev && prev.month !== cg.month,
    });
  }
  const months = [...new Set(cells.map((c) => c.g.month))];
  const monthLabel = months.map((m) => MONTHS[m].toUpperCase()).join('–');
  return { cells, monthLabel, label: dayLineLabel(state.calendar) };
}

/** "Season 1 · Preseason · Day 1", "Season 1 · Round 3 · Day 8", "Season 1 · Off-season · Day 62". */
export function dayLineLabel(cal: Calendar): string {
  const sd = seasonDayOf(cal);
  const kind = cal.phase === 'preseason' && cal.day < 1 && cal.season > 1 ? 'offseason' : dayKind(cal);
  const phase = kind === 'preseason' ? 'Preseason' : kind === 'offseason' ? 'Off-season' : `Round ${cal.round}`;
  return `Season ${sd.season} · ${phase} · Day ${sd.day}`;
}

/** Season day of a scheduled round's match day. */
export const matchSeasonDay = (round: number) => 1 + round * BALANCE.season.daysPerRound;
