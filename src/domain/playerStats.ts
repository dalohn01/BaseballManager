import { roleAmbition } from './personality';
import { BALANCE } from '../balance/config';
import type { GameState } from './state';
import { absoluteRound } from './state';
import type { MatchResult, Player, PlayerId } from './types';

/**
 * Period statistics built from recorded box scores (never from commentary).
 * Ratios are computed from summed counting stats. `null` means "no sample",
 * which the UI shows as a dash — never as a misleading zero.
 *
 * Definitions (documented for the prototype):
 * - OBP = (H + BB) / PA. The engine has no hit-by-pitch, and sacrifice flies are
 *   plate appearances without an at-bat, so PA equals AB + BB + SF.
 * - ERA = 9 × runs / innings. The engine models no errors, so every run is earned.
 * - Innings are stored as outs and shown in baseball notation (10.2 = 10⅔).
 */

export type StatsPeriod = 'season' | 'last5';

export interface BattingPeriod {
  g: number;
  pa: number;
  ab: number;
  h: number;
  doubles: number;
  triples: number;
  hr: number;
  rbi: number;
  bb: number;
  so: number;
  avg: number | null;
  obp: number | null;
  slg: number | null;
}

export interface PitchingPeriod {
  g: number;
  w: number;
  l: number;
  sv: number;
  gs: number;
  outs: number;
  h: number;
  r: number;
  bb: number;
  so: number;
  era: number | null;
  whip: number | null;
}

/** The user club's completed games this season, most recent first. */
export function recentClubMatches(state: GameState, clubId = state.userClubId, season = state.calendar.season): MatchResult[] {
  return Object.values(state.matches)
    .filter((m) => m.season === season && (m.homeId === clubId || m.awayId === clubId))
    .sort((a, b) => b.round - a.round);
}

function finishBatting(b: Omit<BattingPeriod, 'avg' | 'obp' | 'slg'>): BattingPeriod {
  const tb = b.h + b.doubles + 2 * b.triples + 3 * b.hr;
  return {
    ...b,
    avg: b.ab > 0 ? b.h / b.ab : null,
    obp: b.pa > 0 ? (b.h + b.bb) / b.pa : null,
    slg: b.ab > 0 ? tb / b.ab : null,
  };
}

function finishPitching(p: Omit<PitchingPeriod, 'era' | 'whip'>): PitchingPeriod {
  const ip = p.outs / 3;
  return { ...p, era: p.outs > 0 ? (p.r * 9) / ip : null, whip: p.outs > 0 ? (p.bb + p.h) / ip : null };
}

export function battingStats(state: GameState, player: Player, period: StatsPeriod): BattingPeriod {
  if (period === 'season') {
    const s = player.stats;
    return finishBatting({ g: s.games, pa: s.pa, ab: s.ab, h: s.h, doubles: s.doubles, triples: s.triples, hr: s.hr, rbi: s.rbi, bb: s.bb, so: s.so });
  }
  const sum = { g: 0, pa: 0, ab: 0, h: 0, doubles: 0, triples: 0, hr: 0, rbi: 0, bb: 0, so: 0 };
  for (const m of recentClubMatches(state).slice(0, 5)) {
    const l = m.batting[player.id];
    if (!l) continue;
    sum.g++;
    sum.pa += l.pa;
    sum.ab += l.ab;
    sum.h += l.h;
    sum.doubles += l.doubles;
    sum.triples += l.triples;
    sum.hr += l.hr;
    sum.rbi += l.rbi;
    sum.bb += l.bb;
    sum.so += l.so;
  }
  return finishBatting(sum);
}

/**
 * A batter's season before the match being watched. The match is saved (and
 * counted in his season line) before it is played back, so its box line is
 * subtracted: the panel never shows today's outcome early.
 */
export function battingBeforeMatch(state: GameState, player: Player, match: MatchResult) {
  const s = player.stats;
  const l = match.batting[player.id];
  // The season line is reset at a new season; the watched match belongs to the current one.
  const sameSeason = match.season === state.calendar.season;
  const minus = (a: number, b: number | undefined) => a - (sameSeason && b ? b : 0);
  const base = finishBatting({
    g: minus(s.games, l ? 1 : 0),
    pa: minus(s.pa, l?.pa),
    ab: minus(s.ab, l?.ab),
    h: minus(s.h, l?.h),
    doubles: minus(s.doubles, l?.doubles),
    triples: minus(s.triples, l?.triples),
    hr: minus(s.hr, l?.hr),
    rbi: minus(s.rbi, l?.rbi),
    bb: minus(s.bb, l?.bb),
    so: minus(s.so, l?.so),
  });
  return { ...base, ops: base.obp !== null && base.slg !== null ? base.obp + base.slg : null };
}

export function pitchingStats(state: GameState, player: Player, period: StatsPeriod): PitchingPeriod {
  if (period === 'season') {
    const s = player.stats;
    return finishPitching({ g: s.pitchingApps, w: s.wins ?? 0, l: s.losses ?? 0, sv: s.saves ?? 0, gs: s.pitchingStarts, outs: s.outsPitched, h: s.hitsAllowed, r: s.runsAllowed, bb: s.walksAllowed, so: s.strikeouts });
  }
  const sum = { g: 0, w: 0, l: 0, sv: 0, gs: 0, outs: 0, h: 0, r: 0, bb: 0, so: 0 };
  for (const m of recentClubMatches(state).slice(0, 5)) {
    const l = m.pitching[player.id];
    if (!l) continue;
    sum.g++;
    if (m.decisions?.win === player.id) sum.w++;
    if (m.decisions?.loss === player.id) sum.l++;
    if (m.decisions?.save === player.id) sum.sv++;
    if (m.lineups.home.pitcherId === player.id || m.lineups.away.pitcherId === player.id) sum.gs++;
    sum.outs += l.outs;
    sum.h += l.h;
    sum.r += l.r;
    sum.bb += l.bb;
    sum.so += l.so;
  }
  return finishPitching(sum);
}

export const fmtRate = (v: number | null) => (v === null ? '—' : v.toFixed(3).replace(/^0/, ''));
export const fmtEra = (v: number | null) => (v === null ? '—' : v.toFixed(2));
export const fmtIp = (outs: number) => `${Math.floor(outs / 3)}.${outs % 3}`;

// ---------- Playing time and workload ----------

export const startedIn = (m: MatchResult, id: PlayerId) =>
  (['home', 'away'] as const).some((side) => m.lineups[side].pitcherId === id || m.lineups[side].battingOrder.some((s) => s.playerId === id));

/** Consecutive recent club games (since he could play for the club) without a start. */
export function gamesWithoutStart(state: GameState, player: Player): number {
  let n = 0;
  for (const m of recentClubMatches(state)) {
    if (absoluteRound(m.season, m.round) < player.contract.startRound) break;
    if (startedIn(m, player.id)) break;
    n++;
  }
  return n;
}

export interface Outing {
  gamesAgo: number;
  battersFaced: number;
  outs: number;
  started: boolean;
}

/** Most recent appearance and how many of the latest club games in a row he pitched in. */
export function pitcherWorkload(state: GameState, player: Player): { last: Outing | null; straight: number } {
  const games = recentClubMatches(state);
  let last: Outing | null = null;
  let straight = 0;
  let streakOpen = true;
  games.forEach((m, i) => {
    const l = m.pitching[player.id];
    if (l) {
      if (!last) last = { gamesAgo: i + 1, battersFaced: l.battersFaced, outs: l.outs, started: m.lineups.home.pitcherId === player.id || m.lineups.away.pitcherId === player.id };
      if (streakOpen) straight++;
    } else {
      streakOpen = false;
    }
  });
  return { last, straight };
}

// ---------- Status notes ----------

export interface StatusNote {
  text: string;
  tone: 'warn' | 'good' | 'info';
}

/** Factual notes for a player, based on current state and history only. */
export function playerNotes(state: GameState, player: Player, opts: { starting: boolean }): StatusNote[] {
  const notes: StatusNote[] = [];
  const f = BALANCE.fitness;
  const promise = state.promises.find((p) => p.status === 'active' && p.playerId === player.id);
  if (promise) notes.push({ text: `Promised starts (${promise.progress}/${promise.threshold})`, tone: 'info' });
  if (player.fitness < f.needsRestBelow) notes.push({ text: 'Needs rest', tone: 'warn' });
  else if (player.fitness < f.warnBelow) notes.push({ text: 'Tiring', tone: 'warn' });
  if (!player.isPitcher) {
    const idle = gamesWithoutStart(state, player);
    if (!opts.starting && idle >= 3) notes.push({ text: `No starts in ${idle} games`, tone: 'info' });
    if (!opts.starting && roleAmbition(player.personality) > 0.1 && player.satisfaction < 65) notes.push({ text: 'Wants playing time', tone: 'warn' });
  } else {
    const w = pitcherWorkload(state, player);
    if (w.straight >= 2) notes.push({ text: `Pitched in ${w.straight} straight games`, tone: 'warn' });
    else if (w.last && w.last.gamesAgo >= 3 && player.fitness >= f.warnBelow) notes.push({ text: 'Recovered and ready', tone: 'good' });
  }
  return notes;
}
