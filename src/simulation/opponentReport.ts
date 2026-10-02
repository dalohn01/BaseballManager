import { BALANCE } from '../balance/config';
import { restLabel, restStage, teamStatus } from '../domain/effective';
import { fieldingAt } from '../domain/lineup';
import { bullpenToday } from '../domain/todayPitching';
import type { GameState } from '../domain/state';
import type { ClubId, GameId, TacticArea } from '../domain/types';
import { lineupFor } from './round';

/*
 * Opponent report: at most three short observations from real game data.
 * Each one says what kind of fact it is: a trait (ratings), the current
 * status (fitness) or recent form (results), and recent form is only used
 * with at least three games and says when the sample is small.
 */

export type ObservationKind = 'Trait' | 'Status' | 'Recent form';

export interface Observation {
  kind: ObservationKind;
  text: string;
  /** Optional nudge toward a tactic; never applied automatically. */
  hint?: { area: TacticArea; value: string; text: string };
  /** Higher = more notable; used to pick the top three. */
  weight: number;
}

export function opponentReport(state: GameState, gameId: GameId): { opponentId: ClubId; observations: Observation[] } {
  const game = state.schedule.find((g) => g.id === gameId)!;
  const oppId = game.homeId === state.userClubId ? game.awayId : game.homeId;
  const opp = state.clubs[oppId];
  const lineup = lineupFor(state, oppId);
  const obs: Observation[] = [];

  // Trait: the catcher's arm against steals.
  const cSlot = lineup.battingOrder.find((s) => s.position === 'C');
  if (cSlot) {
    const c = state.players[cSlot.playerId];
    const arm = fieldingAt(c, 'C');
    if (arm <= 45) obs.push({ kind: 'Trait', text: `Their catcher ${c.lastName} is weak at stopping steals (fielding ${Math.round(arm)}).`, hint: { area: 'baserunning', value: 'aggressive', text: 'Aggressive running may pay off.' }, weight: 60 - arm });
    else if (arm >= 68) obs.push({ kind: 'Trait', text: `Their catcher ${c.lastName} controls the running game well (fielding ${Math.round(arm)}).`, hint: { area: 'baserunning', value: 'cautious', text: 'Steals are risky today.' }, weight: arm - 55 });
  }

  // Trait and status: the probable starter (how the AI picks today's pitcher).
  const sp = state.players[lineup.pitcherId];
  if (sp) {
    const pit = sp.ratings.pitching;
    if (pit >= 64) obs.push({ kind: 'Trait', text: `Probable starter ${sp.lastName} gets a lot of strikeouts (pitching ${Math.round(pit)}).`, hint: { area: 'batting', value: 'contact', text: 'A contact approach cuts strikeouts.' }, weight: pit - 50 });
    else if (pit <= 46) obs.push({ kind: 'Trait', text: `Probable starter ${sp.lastName} is hittable (pitching ${Math.round(pit)}).`, hint: { area: 'batting', value: 'power', text: 'Strong hitters could swing for power.' }, weight: 55 - pit });
    const stage = restStage(sp);
    if (stage < 2) obs.push({ kind: 'Status', text: `${sp.lastName} starts on short rest (${restLabel(stage)}, ${BALANCE.modifiers.restStages[stage].modifier} today).`, hint: { area: 'batting', value: 'power', text: 'A tired arm leaves pitches up.' }, weight: 40 - stage * 10 });
  }

  // Status: today's relief slots, by rest stage.
  const pen = Object.values(bullpenToday(state, oppId, lineup.pitcherId, opp.pitchingPlan.bullpen)).filter((p) => !!p);
  const tired = pen.filter((p) => restStage(p!) < 2);
  if (tired.length >= 2) obs.push({ kind: 'Status', text: `Their bullpen is worn: ${tired.map((p) => p!.lastName).join(' and ')} pitched recently.`, hint: { area: 'pitching', value: 'attack', text: 'Their relievers may be vulnerable late.' }, weight: 15 + tired.length * 6 });

  // Status: the squad's Team state (morale, hot and cold players, fans).
  const team = teamStatus(state, oppId);
  if (team.level >= 1) obs.push({ kind: 'Status', text: `Their squad is in good spirits (Team +${team.level}): ${team.hot} player${team.hot === 1 ? '' : 's'} on a hot streak.`, weight: 14 + team.level * 4 });
  else if (team.level <= -1) obs.push({ kind: 'Status', text: `Their squad is low (Team ${team.level}): ${team.cold} player${team.cold === 1 ? '' : 's'} in a cold spell.`, weight: 14 - team.level * 4 });

  // Recent form: runs per game over their last games (at least three, small samples labelled).
  const played = state.schedule
    .filter((g) => g.result && (g.homeId === oppId || g.awayId === oppId))
    .sort((a, b) => b.season - a.season || b.round - a.round)
    .slice(0, 5);
  if (played.length >= 3) {
    const scored = played.reduce((a, g) => a + (g.homeId === oppId ? g.result!.homeRuns : g.result!.awayRuns), 0) / played.length;
    const allowed = played.reduce((a, g) => a + (g.homeId === oppId ? g.result!.awayRuns : g.result!.homeRuns), 0) / played.length;
    const sample = played.length < 5 ? ' (small sample)' : '';
    if (scored <= 3) obs.push({ kind: 'Recent form', text: `They have scored only ${scored.toFixed(1)} runs per game in their last ${played.length}${sample}.`, weight: 12 + (3 - scored) * 4 });
    else if (scored >= 6) obs.push({ kind: 'Recent form', text: `Their offense is hot: ${scored.toFixed(1)} runs per game in their last ${played.length}${sample}.`, hint: { area: 'pitching', value: 'careful', text: 'Careful pitching limits big innings.' }, weight: 12 + (scored - 6) * 4 });
    else if (allowed >= 6) obs.push({ kind: 'Recent form', text: `They have allowed ${allowed.toFixed(1)} runs per game in their last ${played.length}${sample}.`, weight: 10 + (allowed - 6) * 4 });
  }

  obs.sort((a, b) => b.weight - a.weight);
  return { opponentId: oppId, observations: obs.slice(0, 3) };
}
