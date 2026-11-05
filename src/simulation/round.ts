import { absDay } from '../domain/staff';
import { battingGameValue, pitchingGameValue, updateForm } from '../domain/effective';
import { settleTransferList } from '../domain/squad';
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
import { pitcherDecisions } from '../presentation/decisions';

export interface RoundOutcome {
  userMatch: MatchResult;
  settlement: RoundSettlement;
  expectedWin: number;
  reactions: { playerId: PlayerId; text: string }[];
  notes: string[];
}

export function lineupFor(state: GameState, clubId: ClubId): Lineup {
  // Every club plays its fixed squad: the lineup is the nine hitters in their places.
  const club = state.clubs[clubId];
  if (isLineupValid(state, clubId, club.lineup)) return club.lineup;
  return autoLineup(state, clubId);
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
    markPitched(state, result);
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
  // The squad is fixed: lineup and pitching roles stay as they are for the next game.
  const userClubState = state.clubs[state.userClubId];
  // One more completed league game for durations and cooldowns; a pep talk lasts one game.
  state.cycle.matchesPlayed += 1;
  state.actions.motivated = [];
  state.actions.boosts = {};
  delete state.actions.teamBoost;
  const raised = settleFundraiser(state);
  // Match-only tactics end with the match; the saved style and instructions stay.
  clearMatchTactics(userClubState);
  pruneInstructions(userClubState);
  const notes: string[] = [];
  notes.push(...settleTransferList(state, rng, sink));
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

/** Records the day each pitcher last pitched (shown as "last outing"); there is no rest between games. */
function markPitched(state: GameState, m: MatchResult) {
  const today = absDay(state.calendar);
  for (const id of [...m.pitchersUsed.home, ...m.pitchersUsed.away]) if (state.players[id]) state.players[id].pitchedOn = today;
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

  // Everyone in the fixed squad plays every game: no playing-time moods. A newcomer's first game is still noted.
  for (const p of clubPlayers(state, clubId)) {
    if (started.has(p.id) && p.stats.games + p.stats.pitchingApps === 1 && (p.role === 'prospect' || p.role === 'reserve')) {
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
