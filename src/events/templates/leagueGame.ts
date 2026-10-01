import { ROLE_LABEL, staffRole } from '../../domain/staff';
import { BALANCE } from '../../balance/config';
import { ballparkName } from '../../content/ballparks';
import { autoLineup, isLineupValid } from '../../domain/lineup';
import type { EffectPreview, GameState } from '../../domain/state';
import { absoluteRound, clubName, userClub } from '../../domain/state';
import { gamesWithoutStart } from '../../domain/playerStats';
import type { Lineup, MatchResult, PitchingPlan } from '../../domain/types';
import { FACILITY_LABELS, projectedTicketRevenue, capacityModifier } from '../../simulation/economy';
import { teamStrength, winProbability } from '../../simulation/match';
import { lineupFor, playRound } from '../../simulation/round';
import type { EventTemplate } from '../types';

export type LeagueGameChoice = 'current' | 'strongest' | 'rest';

export function lineupForChoice(state: GameState, choice: LeagueGameChoice): Lineup {
  const club = userClub(state);
  if (choice === 'current' && isLineupValid(state, club.id, club.lineup)) return club.lineup;
  if (choice === 'rest') return autoLineup(state, club.id, { restBelow: BALANCE.fitness.restBelow });
  return autoLineup(state, club.id);
}

/** Win chance for any candidate lineup (e.g. the pre-match draft), same model as the simulation. */
export function forecastForLineup(state: GameState, gameId: string, lineup: Lineup): number {
  const g = state.schedule.find((x) => x.id === gameId)!;
  const isHome = g.homeId === state.userClubId;
  const ours = teamStrength(state, lineup);
  const theirs = teamStrength(state, lineupFor(state, isHome ? g.awayId : g.homeId));
  const pHome = isHome ? winProbability(ours, theirs) : winProbability(theirs, ours);
  return isHome ? pHome : 1 - pHome;
}

/** Live forecast for the pre-match view; uses the same strength model as the simulation. */
export function leagueGameForecast(state: GameState, gameId: string, choice: LeagueGameChoice) {
  const g = state.schedule.find((x) => x.id === gameId)!;
  const isHome = g.homeId === state.userClubId;
  const oppId = isHome ? g.awayId : g.homeId;
  const ours = teamStrength(state, lineupForChoice(state, choice));
  const theirs = teamStrength(state, lineupFor(state, oppId));
  const pHome = isHome ? winProbability(ours, theirs) : winProbability(theirs, ours);
  return { winChance: isHome ? pHome : 1 - pHome, ours, theirs, isHome, oppId };
}

const inLineup = (l: Lineup, id: string) => l.pitcherId === id || l.battingOrder.some((s) => s.playerId === id);

/** Concrete differences from the saved lineup: who sits, who comes in, who moves, pitcher. */
export function describeLineupChange(state: GameState, from: Lineup, to: Lineup): string[] {
  const name = (id: string) => state.players[id]?.lastName ?? '?';
  const posIn = (l: Lineup, id: string) => l.battingOrder.find((s) => s.playerId === id)?.position;
  const out: string[] = [];
  for (const s of from.battingOrder) if (!inLineup(to, s.playerId)) out.push(`${name(s.playerId)} → bench`);
  for (const s of to.battingOrder) if (!inLineup(from, s.playerId)) out.push(`${name(s.playerId)} in (${s.position})`);
  for (const s of to.battingOrder) {
    const before = posIn(from, s.playerId);
    if (before && before !== s.position) out.push(`${name(s.playerId)} ${before}→${s.position}`);
  }
  if (from.pitcherId !== to.pitcherId) out.push(`SP ${name(to.pitcherId)} instead of ${name(from.pitcherId)}`);
  return out;
}

/**
 * Live notes for each pre-match choice: what it changes compared with the saved
 * lineup and which active promises it would cost a start (or break outright).
 */
export function leagueGameOptionNotes(state: GameState, choice: LeagueGameChoice): EffectPreview[] {
  const club = userClub(state);
  const saved = club.lineup;
  const savedValid = isLineupValid(state, club.id, saved);
  const lineup = lineupForChoice(state, choice);
  const notes: EffectPreview[] = [];

  if (choice === 'current') {
    if (!savedValid) notes.push({ text: 'Saved lineup is invalid: the strongest valid lineup will be used', tone: 'negative' });
  } else {
    const changes = savedValid ? describeLineupChange(state, saved, lineup) : ['Replaces your invalid saved lineup'];
    if (changes.length === 0) notes.push({ text: 'Same as your lineup', tone: 'neutral' });
    else {
      const shown = changes.slice(0, 4);
      if (changes.length > shown.length) shown.push(`+${changes.length - shown.length} more`);
      notes.push(...shown.map((text) => ({ text, tone: 'neutral' as const })));
    }
  }

  if (choice === 'rest') {
    const tired = saved.battingOrder
      .map((s) => state.players[s.playerId])
      .filter((p) => p && p.fitness < BALANCE.fitness.restBelow);
    const rested = tired.filter((p) => !inLineup(lineup, p.id));
    if (tired.length === 0) notes.push({ text: `Everyone at ${BALANCE.fitness.restBelow}%+ fitness`, tone: 'neutral' });
    else if (rested.length === 0) notes.push({ text: 'No replacement for the tired players', tone: 'neutral' });
    else notes.push({ text: `${rested.map((p) => p.lastName).join(', ')} rest${rested.length === 1 ? 's' : ''} (+${BALANCE.fitness.benchRecoveryPerGame - BALANCE.fitness.lineupPerGame}% fitness vs playing)`, tone: 'positive' });
  }

  notes.push({ text: `Playing costs starters ${-BALANCE.fitness.lineupPerGame}% fitness`, tone: 'negative' });

  // Promises whose window includes this game.
  const now = absoluteRound(state.calendar.season, state.calendar.round);
  for (const pr of state.promises) {
    if (pr.status !== 'active' || now < pr.fromRound || now > pr.toRound || inLineup(lineup, pr.playerId)) continue;
    const p = state.players[pr.playerId];
    const needed = pr.threshold - pr.progress;
    const gamesLeftAfter = pr.toRound - now;
    notes.push(
      needed > gamesLeftAfter
        ? { text: `Breaks the promise to ${p.lastName} (satisfaction ${BALANCE.promises.broken})`, tone: 'negative' }
        : { text: `${p.lastName} misses a promised start (${needed} still needed in ${gamesLeftAfter} game${gamesLeftAfter === 1 ? '' : 's'})`, tone: 'negative' },
    );
  }
  return notes;
}

/** Post-game feedback from actual participation: first starts, planned rest, the planned reliever. */
function planFollowUp(state: GameState, m: MatchResult, plan: PitchingPlan, idleBefore: Map<string, number>, restFitness: Map<string, number>): string[] {
  const notes: string[] = [];
  const side = m.homeId === state.userClubId ? 'home' : 'away';
  for (const [id, idle] of idleBefore) {
    if (idle >= 3) notes.push(`${state.players[id].lastName} made his first start in ${idle + 1} games.`);
  }
  for (const [id, before] of restFitness) {
    const p = state.players[id];
    if (p && !m.pitchersUsed[side].includes(id)) notes.push(`${p.lastName} rested as planned (fitness ${before}% → ${p.fitness}%).`);
  }
  const used = m.pitchersUsed[side].slice(1);
  const staff = state.clubs[state.userClubId].staff;
  if (used.length === 0) notes.push(`${state.players[m.lineups[side].pitcherId]?.lastName ?? 'The starter'} went the distance.`);
  for (const id of used) {
    const role = staff ? staffRole(staff, id) : 'depth';
    notes.push(`${state.players[id]?.lastName ?? 'A reliever'} came on in relief (${ROLE_LABEL[role].toLowerCase()}).`);
  }
  const starterLine = m.pitching[m.lineups[side].pitcherId];
  if (starterLine && used.length) notes.push(`${state.players[m.lineups[side].pitcherId].lastName} left after facing ${starterLine.battersFaced} batters (${plan.hook === 'long' ? 'let him pitch' : plan.hook} hook).`);
  return notes;
}

export const leagueGame: EventTemplate = {
  id: 'league_game',
  version: 1,
  type: 'leagueGame',
  slot: 'match',
  cooldownRounds: 0,
  weight: () => 1,
  build: ({ state, gameId }) => {
    const g = state.schedule.find((x) => x.id === gameId);
    if (!g) throw new Error(`No scheduled game ${gameId}`);
    const isHome = g.homeId === state.userClubId;
    const opp = state.clubs[isHome ? g.awayId : g.homeId];
    const club = userClub(state);
    const gate = isHome ? projectedTicketRevenue(club) : 0;
    return {
      kicker: 'League Game',
      title: `${isHome ? 'vs' : '@'} ${clubName(opp)}`,
      context: isHome
        ? `Home game at ${ballparkName(club)}. Expected gate ≈ $${gate.toLocaleString('en-US')}.`
        : `Road game in ${opp.city}. No gate income this round.`,
      prompt: 'Who takes the field?',
      subjects: { playerIds: [], clubIds: [opp.id] },
      data: { gameId: g.id, isHome, opponentId: opp.id },
      options: [
        {
          id: 'current',
          label: 'Your lineup',
          summary: 'Exactly as set on the Team page, including your own choices.',
          certain: leagueGameOptionNotes(state, 'current'),
          uncertain: [],
          cost: { time: BALANCE.time.costPerEvent, cash: 0, influence: 0 },
          primary: true,
        },
        {
          id: 'strongest',
          label: 'Strongest available',
          summary: 'Best nine on today’s form and the best-rested pitcher. Becomes your saved lineup.',
          certain: leagueGameOptionNotes(state, 'strongest'),
          uncertain: [],
          cost: { time: BALANCE.time.costPerEvent, cash: 0, influence: 0 },
        },
        {
          id: 'rest',
          label: 'Rest tired players',
          summary: `Like strongest, but anyone below ${BALANCE.fitness.restBelow}% fitness sits if a replacement exists. Becomes your saved lineup.`,
          certain: leagueGameOptionNotes(state, 'rest'),
          uncertain: [],
          cost: { time: BALANCE.time.costPerEvent, cash: 0, influence: 0 },
        },
      ],
      boosts: [],
    };
  },
  resolve: ({ state, rng, sink, option, event }) => {
    const choice = option.id as LeagueGameChoice;
    const lineup = lineupForChoice(state, choice);
    const narrative: string[] = [];
    if (choice === 'current' && lineup !== userClub(state).lineup) narrative.push('Your saved lineup was invalid, so the strongest valid lineup was used.');
    // Snapshot what the plan intended, to report afterwards what actually happened.
    const plan = structuredClone(userClub(state).pitchingPlan);
    const idleBefore = new Map(lineup.battingOrder.map((s) => [s.playerId, gamesWithoutStart(state, state.players[s.playerId])]));
    const restFitness = new Map(plan.rest.map((id) => [id, state.players[id]?.fitness ?? 0]));
    const out = playRound(state, lineup, rng, sink);
    narrative.push(...planFollowUp(state, out.userMatch, plan, idleBefore, restFitness));
    const m = out.userMatch;
    const isHome = m.homeId === state.userClubId;
    const us = isHome ? m.runs.home : m.runs.away;
    const them = isHome ? m.runs.away : m.runs.home;
    const opp = state.clubs[String(event.data.opponentId)];
    const won = us > them;
    const extra = m.decidedBy === 'suddenDeath' ? ' (sudden-death)' : m.decidedBy === 'extraInnings' ? ` in ${m.innings}` : '';
    const headline = won ? `${userClub(state).name} beat the ${opp.name} ${us}–${them}${extra}` : `${userClub(state).name} fall to the ${opp.name} ${us}–${them}${extra}`;
    narrative.push(`Pre-game forecast gave you a ${Math.round(out.expectedWin * 100)}% win chance.`);
    if (out.settlement.attendance && isHome) {
      const club = userClub(state);
      state.matches[m.id].gate = { attendance: out.settlement.attendance, capacity: Math.round(BALANCE.economy.stadiumCapacity[club.facilities.stadium - 1] * capacityModifier(club)) };
    }
    if (out.settlement.attendance) narrative.push(`${out.settlement.attendance.toLocaleString('en-US')} fans at ${ballparkName(userClub(state))}.`);
    if (out.settlement.completed) narrative.push(`Construction finished: the ${FACILITY_LABELS[out.settlement.completed]} is now level ${userClub(state).facilities[out.settlement.completed]}.`);
    for (const x of out.settlement.expired) narrative.push(`Happening ended: ${x.label}.`);
    return { headline, narrative, reactions: out.reactions, matchId: m.id };
  },
};
