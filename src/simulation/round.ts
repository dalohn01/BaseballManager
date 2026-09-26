import { BALANCE } from '../balance/config';
import type { EffectSink } from '../domain/effects';
import { autoLineup, bestRestedPitcher, isLineupValid } from '../domain/lineup';
import type { Rng } from '../domain/rng';
import type { GameState } from '../domain/state';
import { clubPlayers } from '../domain/state';
import type { ClubId, Lineup, MatchResult, PlayerId, ScheduledGame } from '../domain/types';
import { settleRound, type RoundSettlement } from './economy';
import { evaluatePromises } from './promises';
import { buildSimTeam, simulateMatch, winProbability } from './match';
import { avg } from './training';

export interface RoundOutcome {
  userMatch: MatchResult;
  settlement: RoundSettlement;
  expectedWin: number;
  reactions: { playerId: PlayerId; text: string }[];
  notes: string[];
}

export function lineupFor(state: GameState, clubId: ClubId): Lineup {
  const club = state.clubs[clubId];
  if (club.isUser && isLineupValid(state, clubId, club.lineup)) return club.lineup;
  return autoLineup(state, clubId, { restBelow: BALANCE.fitness.aiRestBelow });
}

/**
 * Plays every game of the current round exactly once (the user's plus the AI
 * games), then applies stats, fitness, moods and the user's finances.
 */
export function playRound(state: GameState, userLineup: Lineup, rng: Rng, sink: EffectSink): RoundOutcome {
  const { season, round } = state.calendar;
  const games = state.schedule.filter((g) => g.season === season && g.round === round);
  if (games.some((g) => g.result)) throw new Error(`Round ${round} already played`);
  const userGame = games.find((g) => g.homeId === state.userClubId || g.awayId === state.userClubId);
  if (!userGame) throw new Error('User has no game this round');

  state.clubs[state.userClubId].lineup = structuredClone(userLineup);
  const fitnessBefore = Math.round(avg(clubPlayers(state, state.userClubId).map((p) => p.fitness)));
  let userMatch: MatchResult | null = null;
  let expectedWin = 0.5;

  for (const g of games) {
    const homeLineup = lineupFor(state, g.homeId);
    const awayLineup = lineupFor(state, g.awayId);
    const home = buildSimTeam(state, g.homeId, homeLineup);
    const away = buildSimTeam(state, g.awayId, awayLineup);
    const result = simulateMatch({ id: g.id, season, round, home, away, rng });
    g.result = { homeRuns: result.runs.home, awayRuns: result.runs.away, innings: result.innings, decidedBy: result.decidedBy };
    applyStats(state, result);
    applyFitness(state, g.homeId, result, 'home');
    applyFitness(state, g.awayId, result, 'away');
    if (g === userGame) {
      userMatch = result;
      const pHome = winProbability(home.strength, away.strength);
      expectedWin = g.homeId === state.userClubId ? pHome : 1 - pHome;
      // Only the latest game is replayed visually; older games keep their box score but drop
      // the step-by-step sequence so the save (and every state copy) stays small.
      for (const old of Object.values(state.matches)) delete old.sequence;
      state.matches[g.id] = result;
    }
  }

  const match = userMatch!;
  // Rotation: the next start goes to the best-rested arm unless the manager changes it.
  const userClubState = state.clubs[state.userClubId];
  userClubState.lineup = { ...userClubState.lineup, pitcherId: bestRestedPitcher(state, state.userClubId) };
  // Reliever and rest applied to this game only; the hook setting is a standing preference.
  userClubState.pitchingPlan = { relieverId: null, rest: [], hook: userClubState.pitchingPlan.hook };
  sink.record({
    targetKind: 'team',
    targetId: state.userClubId,
    targetLabel: 'Squad average',
    stat: 'fitness',
    statLabel: 'Fitness',
    before: fitnessBefore,
    after: Math.round(avg(clubPlayers(state, state.userClubId).map((p) => p.fitness))),
  });
  const notes: string[] = [];
  const reactions = applyUserMoods(state, userGame, match, expectedWin, sink, notes);
  notes.push(...evaluatePromises(state, sink));
  const settlement = settleRound(state, state.userClubId, userGame.homeId === state.userClubId, sink);
  return { userMatch: match, settlement, expectedWin, reactions, notes };
}

/**
 * How strongly fans react to a loss, from the public message and the agreed
 * season plan of this season. Returns the multiplier and a readable reason.
 */
export function lossExpectation(state: GameState): { multiplier: number; reason: string | null } {
  const club = state.clubs[state.userClubId];
  const season = state.calendar.season;
  const stance = club.publicStance?.season === season ? club.publicStance.stance : null;
  const plan = club.seasonPlan?.direction ?? null;
  const cfg = BALANCE.stance;
  if (stance === 'contend' || (plan === 'winNow' && stance !== 'patience')) {
    return { multiplier: stance === 'contend' ? cfg.contendLossMultiplier : BALANCE.seasonPlan.winNow.lossFanMultiplier, reason: stance === 'contend' ? 'fans expect a title push' : 'a win-now season' };
  }
  if (stance === 'patience' || plan === 'rebuild') {
    return { multiplier: stance === 'patience' ? cfg.patienceLossMultiplier : BALANCE.seasonPlan.rebuild.lossFanMultiplier, reason: stance === 'patience' ? 'fans accept the rebuild message' : 'a declared rebuild' };
  }
  return { multiplier: 1, reason: null };
}

function applyStats(state: GameState, m: MatchResult) {
  const starters = new Set([...m.lineups.home.battingOrder, ...m.lineups.away.battingOrder].map((s) => s.playerId));
  for (const [id, line] of Object.entries(m.batting)) {
    const s = state.players[id].stats;
    s.games += 1;
    if (starters.has(id)) s.starts += 1;
    s.pa += line.pa;
    s.ab += line.ab;
    s.h += line.h;
    s.doubles += line.doubles;
    s.triples += line.triples;
    s.hr += line.hr;
    s.rbi += line.rbi;
    s.r += line.r;
    s.bb += line.bb;
    s.so += line.so;
    s.sb += line.sb;
  }
  for (const [id, line] of Object.entries(m.pitching)) {
    const s = state.players[id].stats;
    s.pitchingApps += 1;
    if (id === m.lineups.home.pitcherId || id === m.lineups.away.pitcherId) s.pitchingStarts += 1;
    s.outsPitched += line.outs;
    s.hitsAllowed += line.h;
    s.runsAllowed += line.r;
    s.walksAllowed += line.bb;
    s.strikeouts += line.so;
  }
}

/** Match load and recovery for one round. Config values are fitness changes (negative = load). */
function applyFitness(state: GameState, clubId: ClubId, m: MatchResult, side: 'home' | 'away') {
  const f = BALANCE.fitness;
  const lineup = m.lineups[side];
  const batters = new Set(lineup.battingOrder.map((s) => s.playerId));
  const used = m.pitchersUsed[side];
  for (const p of clubPlayers(state, clubId)) {
    let delta = f.naturalRecoveryPerRound;
    if (p.isPitcher) {
      if (p.id === lineup.pitcherId) delta += f.startingPitcherPerGame;
      else if (used.includes(p.id)) delta += f.reliefPitcherPerGame;
      else delta += f.restingPitcherRecoveryPerGame;
    } else {
      delta += batters.has(p.id) ? f.lineupPerGame : f.benchRecoveryPerGame;
    }
    p.fitness = Math.max(0, Math.min(100, p.fitness + delta));
  }
}

function applyUserMoods(
  state: GameState,
  game: ScheduledGame,
  m: MatchResult,
  expectedWin: number,
  sink: EffectSink,
  notes: string[],
): { playerId: PlayerId; text: string }[] {
  const mood = BALANCE.mood;
  const clubId = state.userClubId;
  const isHome = game.homeId === clubId;
  const us = isHome ? m.runs.home : m.runs.away;
  const them = isHome ? m.runs.away : m.runs.home;
  const won = us > them;
  const opp = state.clubs[isHome ? game.awayId : game.homeId];
  const lineup = m.lineups[isHome ? 'home' : 'away'];
  const started = new Set([...lineup.battingOrder.map((s) => s.playerId), lineup.pitcherId]);
  const reactions: { playerId: PlayerId; text: string }[] = [];

  // Fans react to the result relative to expectation; owners only to the result.
  // A loss hurts more or less depending on what the club has said and agreed this season.
  const raw = ((won ? 1 : 0) - expectedWin) * mood.fanExpectationScale;
  const exp = won ? { multiplier: 1, reason: null } : lossExpectation(state);
  const fanDelta = Math.round(raw * exp.multiplier);
  if (!won && exp.reason && Math.round(raw) !== fanDelta) {
    notes.push(`Fan reaction ${fanDelta} instead of ${Math.round(raw)}: ${exp.reason}.`);
  }
  if (fanDelta !== 0) sink.clubMood(clubId, 'fanSupport', fanDelta, `${won ? 'Beat' : 'Lost to'} ${opp.name} ${us}–${them}${won && expectedWin < 0.4 ? ' as underdogs' : !won && expectedWin > 0.6 ? ' as favourites' : ''}${exp.reason ? ` (${exp.reason})` : ''}`);
  sink.clubMood(clubId, 'ownerConfidence', won ? mood.ownerWin : mood.ownerLoss, `${won ? 'Win' : 'Loss'} vs ${opp.name}`);

  for (const p of clubPlayers(state, clubId)) {
    const didStart = started.has(p.id);
    let delta = 0;
    let reason = '';
    if (p.isPitcher) continue; // Rotation turns are expected; no mood swing per start.
    if (p.priority === 'playingTime') {
      delta = didStart ? mood.startedPlayingTimePriority : mood.benchedPlayingTimePriority;
      reason = didStart ? 'Got the start' : 'Left out of the lineup';
    } else if (p.role === 'starter' && !didStart) {
      delta = mood.benchedStarterRole;
      reason = 'Benched despite a starting role';
    }
    if (delta !== 0) sink.playerMood(p.id, 'satisfaction', delta, reason);
    if (didStart && p.stats.starts === 1 && (p.role === 'prospect' || p.role === 'reserve')) {
      reactions.push({ playerId: p.id, text: 'Thanks for giving me a chance.' });
    }
  }

  // Standout performer reaction, based only on what happened.
  const ours = lineup.battingOrder.map((s) => ({ id: s.playerId, line: m.batting[s.playerId] }));
  const star = ours.sort((a, b) => b.line.hr * 3 + b.line.h + b.line.rbi - (a.line.hr * 3 + a.line.h + a.line.rbi))[0];
  if (star && star.line.h >= 2) {
    const p = state.players[star.id];
    const text = won ? 'Felt locked in today. Great team win.' : 'Good day for me, but I wanted the win.';
    reactions.push({ playerId: p.id, text });
    sink.playerMood(p.id, 'popularity', star.line.hr > 0 ? 2 : 1, 'Standout game', { record: false });
  }
  for (const r of reactions) {
    const p = state.players[r.playerId];
    p.lastReaction = { text: r.text, context: `After ${won ? 'the win' : 'the loss'} vs ${opp.name}`, season: m.season, round: m.round };
  }

  return reactions;
}
