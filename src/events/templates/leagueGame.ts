import { BALANCE } from '../../balance/config';
import { autoLineup, isLineupValid } from '../../domain/lineup';
import type { GameState } from '../../domain/state';
import { clubName, userClub } from '../../domain/state';
import type { Lineup } from '../../domain/types';
import { projectedTicketRevenue } from '../../simulation/economy';
import { teamStrength, winProbability } from '../../simulation/match';
import { lineupFor, playRound } from '../../simulation/round';
import type { EventTemplate } from '../types';

export type LeagueGameChoice = 'current' | 'strongest' | 'rest';

export function lineupForChoice(state: GameState, choice: LeagueGameChoice): Lineup {
  const club = userClub(state);
  if (choice === 'current' && isLineupValid(state, club.id, club.lineup)) return club.lineup;
  if (choice === 'rest') return autoLineup(state, club.id, { restThreshold: BALANCE.fatigue.restThreshold });
  return autoLineup(state, club.id);
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
        ? `Home game at Harbor Park. Expected gate ≈ $${gate.toLocaleString('en-US')}.`
        : `Road game in ${opp.city}. No gate income this round.`,
      prompt: 'Who takes the field?',
      subjects: { playerIds: [], clubIds: [opp.id] },
      data: { gameId: g.id, isHome, opponentId: opp.id },
      options: [
        {
          id: 'current',
          label: 'Your lineup',
          summary: 'Exactly as set on the Team page.',
          certain: [{ text: `Starters fatigue +${BALANCE.fatigue.lineupPerGame}`, tone: 'negative' }],
          uncertain: [],
          cost: { time: BALANCE.time.costPerEvent, cash: 0, influence: 0 },
          primary: true,
        },
        {
          id: 'strongest',
          label: 'Strongest available',
          summary: 'Best nine and best-rested ace, fatigue be damned.',
          certain: [{ text: 'Replaces your saved lineup', tone: 'neutral' }],
          uncertain: [],
          cost: { time: BALANCE.time.costPerEvent, cash: 0, influence: 0 },
        },
        {
          id: 'rest',
          label: 'Rest tired players',
          summary: `Bench anyone at fatigue ${BALANCE.fatigue.restThreshold}+ where a replacement exists.`,
          certain: [{ text: `Benched players recover ${BALANCE.fatigue.benchRecoveryPerGame}`, tone: 'positive' }],
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
    const out = playRound(state, lineup, rng, sink);
    const m = out.userMatch;
    const isHome = m.homeId === state.userClubId;
    const us = isHome ? m.runs.home : m.runs.away;
    const them = isHome ? m.runs.away : m.runs.home;
    const opp = state.clubs[String(event.data.opponentId)];
    const won = us > them;
    const extra = m.decidedBy === 'suddenDeath' ? ' (sudden-death)' : m.decidedBy === 'extraInnings' ? ` in ${m.innings}` : '';
    const headline = won ? `${userClub(state).name} beat the ${opp.name} ${us}–${them}${extra}` : `${userClub(state).name} fall to the ${opp.name} ${us}–${them}${extra}`;
    narrative.push(`Pre-game forecast gave you a ${Math.round(out.expectedWin * 100)}% win chance.`);
    if (out.settlement.attendance) narrative.push(`${out.settlement.attendance.toLocaleString('en-US')} fans at Harbor Park.`);
    return { headline, narrative, reactions: out.reactions, matchId: m.id };
  },
};
