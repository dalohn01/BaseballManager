import { BALANCE } from '../balance/config';
import type { Calendar, GameState } from './state';

/** What kind of day the calendar is on. */
export type DayKind = 'preseason' | 'club' | 'match' | 'offseason';

export function dayKind(cal: Calendar): DayKind {
  if (cal.phase === 'preseason') return 'preseason';
  if (cal.phase === 'postseason') return 'offseason';
  return cal.day >= BALANCE.season.daysPerRound ? 'match' : 'club';
}

/**
 * The day after `cal`: preseason → round 1 day 1 → … → match day → next round,
 * and after the last match day the off-season. The season review itself moves
 * the calendar to the next season (preseason, day 0).
 */
export function nextDay(cal: Calendar): Calendar {
  const D = BALANCE.season.daysPerRound;
  const next = { ...cal, slot: 0 };
  if (cal.phase === 'preseason') {
    if (cal.day < 1) return { ...next, day: 1 };
    return { ...next, phase: 'regular', round: 1, day: 1 };
  }
  if (cal.phase === 'postseason') return next;
  if (cal.day < D) return { ...next, day: cal.day + 1 };
  if (cal.round < BALANCE.season.rounds) return { ...next, round: cal.round + 1, day: 1 };
  return { ...next, phase: 'postseason', day: D + 1 };
}

/** Day number within the season: preseason is day 0, round 1 starts on day 1. */
export function seasonDay(round: number, day: number): number {
  return round === 0 ? 0 : (round - 1) * BALANCE.season.daysPerRound + day;
}

/** Days from today until the given round's match day (0 = today). */
export function daysUntilRound(cal: Calendar, round: number): number {
  const today = cal.phase === 'preseason' ? 0 : seasonDay(cal.round, cal.day);
  return Math.max(0, seasonDay(round, BALANCE.season.daysPerRound) - today);
}

/** True when every event of today has been handled and the manager may advance. */
export function dayComplete(state: GameState): boolean {
  return state.currentEvent === null && state.nextEvent === null && state.queue.length === 0;
}

/** Events still waiting today after the one on screen (built or planned). */
export function eventsLeftToday(state: GameState): number {
  return state.queue.length + (state.nextEvent ? 1 : 0);
}

/** The user's league game on a regular round, if any. */
export function userGame(state: GameState, season: number, round: number) {
  return state.schedule.find((g) => g.season === season && g.round === round && (g.homeId === state.userClubId || g.awayId === state.userClubId)) ?? null;
}

/** Short description of a day for previews, e.g. "Match day vs Kings (home)". */
export function describeDay(state: GameState, cal: Calendar): string {
  const kind = dayKind(cal);
  if (kind === 'preseason') return `Preseason ${cal.season}`;
  if (kind === 'offseason') return 'Off-season: draft, contracts and review';
  if (kind === 'club') return `Club day · Round ${cal.round}`;
  const g = userGame(state, cal.season, cal.round);
  if (!g) return `Match day · Round ${cal.round}`;
  const home = g.homeId === state.userClubId;
  const opp = state.clubs[home ? g.awayId : g.homeId];
  return `Match day vs ${opp.name} (${home ? 'home' : 'away'})`;
}

/** "Today", "Tomorrow" or "In N days". */
export const inDays = (n: number) => (n <= 0 ? 'Today' : n === 1 ? 'Tomorrow' : `In ${n} days`);

export function dayLabel(cal: Calendar): string {
  const kind = dayKind(cal);
  if (kind === 'preseason') return 'Preseason';
  if (kind === 'offseason') return 'Off-season';
  return `Round ${cal.round} · ${kind === 'match' ? 'Match day' : `Day ${cal.day} of ${BALANCE.season.daysPerRound}`}`;
}
