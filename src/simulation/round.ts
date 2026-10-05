import { absDay } from '../domain/staff';
import { battingGameValue, pitchingGameValue, restAfterGame, updateForm } from '../domain/effective';
import { bestPitching, emptyBullpen } from '../domain/todayPitching';
import { BALANCE } from '../balance/config';
import { settleFundraiser } from './actions';
import type { EffectSink } from '../domain/effects';
import { autoLineup, isLineupValid } from '../domain/lineup';
import { clearMatchTactics, pruneInstructions } from '../domain/tactics';
import type { Rng } from '../domain/rng';
import type { GameState } from '../domain/state';
import { clubPlayers } from '../domain/state';
import type { ClubId, Lineup, MatchResult, PlayerId, ScheduledGame } from '../domain/types';
import { settleRound, type RoundSettlement } from './economy';
import { evaluatePromises } from './promises';
import { buildSimTeam, simulateMatch, winProbability } from './match';
import { avg } from './training';
import { applyReaction } from './reactions';
import { expression, type Reaction } from '../domain/personality';
import { recentClubMatches, startedIn } from '../domain/playerStats';
import { absoluteRound } from '../domain/state';
import { pitcherDecisions } from '../presentation/decisions';

/** Items before the first one that matches. */
const countUntil = <T>(list: T[], stop: (x: T) => boolean) => {
  const i = list.findIndex(stop);
  return i < 0 ? list.length : i;
};

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
  const fitnessBefore = Math.round(avg(clubPlayers(state, state.userClubId).filter((p) => !p.isPitcher).map((p) => p.fitness)));
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
    applyForm(state, g.homeId, result);
    applyForm(state, g.awayId, result);
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
  // Pitching is set per game: the next one starts from the strongest setup again.
  const userClubState = state.clubs[state.userClubId];
  userClubState.lineup = { ...userClubState.lineup, pitcherId: bestPitching(state, state.userClubId).starterId };
  // The relief slots applied to this game only; the hook setting is a standing preference.
  userClubState.pitchingPlan = { relieverId: null, rest: [], bullpen: emptyBullpen(), hook: userClubState.pitchingPlan.hook };
  // One more completed league game for durations and cooldowns; a pep talk lasts one game.
  state.cycle.matchesPlayed += 1;
  state.actions.motivated = [];
  state.actions.boosts = {};
  delete state.actions.teamBoost;
  const raised = settleFundraiser(state);
  // Match-only tactics end with the match; the saved style and instructions stay.
  clearMatchTactics(userClubState);
  pruneInstructions(userClubState);
  sink.record({
    targetKind: 'team',
    targetId: state.userClubId,
    targetLabel: 'Hitters average',
    stat: 'fitness',
    statLabel: 'Fitness',
    before: fitnessBefore,
    after: Math.round(avg(clubPlayers(state, state.userClubId).filter((p) => !p.isPitcher).map((p) => p.fitness))),
  });
  const notes: string[] = [];
  if (raised > 0) notes.push(`Fundraiser complete: $${raised.toLocaleString('en-US')} set aside for facility upgrades.`);
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
  // Pitchers of record, read from the sequence while it is still on the result.
  const d = pitcherDecisions(m);
  m.decisions = { win: d.win, loss: d.loss, save: d.save };
  if (d.win) state.players[d.win].stats.wins += 1;
  if (d.loss) state.players[d.loss].stats.losses += 1;
  if (d.save) state.players[d.save].stats.saves += 1;
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

/**
 * Match load and recovery for one game. Pitchers' rest is counted in games: a
 * start leaves him Exhausted, relief costs one stage, a game off gains one.
 * Hitters lose fitness by playing and recover on the bench (and daily).
 */
function applyFitness(state: GameState, clubId: ClubId, m: MatchResult, side: 'home' | 'away') {
  const f = BALANCE.fitness;
  const lineup = m.lineups[side];
  const batters = new Set(lineup.battingOrder.map((s) => s.playerId));
  const used = m.pitchersUsed[side];
  const today = absDay(state.calendar);
  for (const p of clubPlayers(state, clubId)) {
    if (p.isPitcher) {
      restAfterGame(p, p.id === lineup.pitcherId ? 'start' : used.includes(p.id) ? 'relief' : 'none');
      if (used.includes(p.id)) p.pitchedOn = today;
    } else {
      const delta = batters.has(p.id) ? f.lineupPerGame : f.benchRecoveryPerGame;
      p.fitness = Math.max(0, Math.min(100, p.fitness + delta));
    }
  }
}

/** Form after a game: those who played move toward this game's value, the rest drift toward neutral. */
function applyForm(state: GameState, clubId: ClubId, m: MatchResult) {
  for (const p of clubPlayers(state, clubId)) {
    const line = p.isPitcher ? m.pitching[p.id] : m.batting[p.id];
    if (!line) updateForm(p, null);
    else updateForm(p, p.isPitcher ? pitchingGameValue(m.pitching[p.id]) : battingGameValue(m.batting[p.id]));
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

  // Playing time: context first (role, starts in the last three games, rest,
  // how long a reserve has waited), then the personality sizes the reaction.
  const recent = recentClubMatches(state).filter((x) => x.id === m.id || x.round < m.round || x.season < m.season);
  const window = recent.slice(0, 3);
  let loudest: { playerId: PlayerId; delta: number; tone: 'calm' | 'harsh' } | null = null;
  for (const p of clubPlayers(state, clubId)) {
    if (p.isPitcher) continue; // Rotation turns are expected; no mood swing per start.
    const didStart = started.has(p.id);
    const eligible = (x: MatchResult) => absoluteRound(x.season, x.round) >= p.contract.startRound;
    const idleBefore = countUntil(recent.slice(1).filter(eligible), (x) => startedIn(x, p.id));
    const sid = `${m.id}:pt:${p.id}`;
    let r: Reaction | null = null;
    if (didStart) {
      // A start after waiting is welcome; a regular's start is simply normal.
      if (p.role !== 'starter' && idleBefore > 0) {
        const base = Math.min(mood.startAfterWaitMax, idleBefore * mood.startAfterWaitPerGame);
        r = applyReaction(state, sink, p.id, 'got_start', base, `Got the start after ${idleBefore} game${idleBefore === 1 ? '' : 's'} out`, sid);
      }
    } else if (p.role === 'starter') {
      const missed = window.filter(eligible).filter((x) => !startedIn(x, p.id)).length;
      const resting = p.fitness < BALANCE.fitness.needsRestBelow + BALANCE.fitness.benchRecoveryPerGame;
      if (resting) r = applyReaction(state, sink, p.id, 'planned_rest', mood.rotation, 'Rested on the bench', sid);
      else if (missed <= 1) r = applyReaction(state, sink, p.id, 'rotation', mood.rotation, 'Benched for one game despite a starting role', sid);
      else r = applyReaction(state, sink, p.id, 'playing_time', mood.rotation + mood.playingTimePerMiss * (missed - 1), `Benched in ${missed} of the last ${window.length} games`, sid);
    } else {
      const idle = idleBefore + 1;
      if (idle >= mood.reserveIdleFrom) r = applyReaction(state, sink, p.id, 'playing_time', mood.reserveBenched, `${idle} games in a row without a start`, sid);
    }
    // Whether it is said out loud is a separate matter from how much it hurts.
    if (r && r.delta < 0) {
      const tone = expression(p.personality, r.delta);
      if (tone !== 'silent' && (!loudest || r.delta < loudest.delta)) loudest = { playerId: p.id, delta: r.delta, tone };
    }
    if (didStart && p.stats.starts === 1 && (p.role === 'prospect' || p.role === 'reserve')) {
      reactions.push({ playerId: p.id, text: 'Thanks for giving me a chance.' });
    }
  }
  if (loudest && loudest.delta <= -1.5) {
    reactions.push({ playerId: loudest.playerId, text: loudest.tone === 'harsh' ? 'Sitting again? I deserve better than this.' : "I want to be out there. I'll keep working for it." });
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
