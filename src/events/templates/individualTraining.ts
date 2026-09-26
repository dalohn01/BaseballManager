import { BALANCE } from '../../balance/config';
import { trainingModifier } from '../../simulation/economy';
import type { GameState } from '../../domain/state';
import { clubPlayers, playerName, userClub } from '../../domain/state';
import type { Player, RatingKey } from '../../domain/types';
import { canPromiseStarts, makeStartsPromise } from '../../simulation/promises';
import { applyProgress, recordProgress, runTeamTraining } from '../../simulation/training';
import type { EventTemplate } from '../types';
import { cost, fmt, isInLineup, neg, neutral, pos, substitute, weakestStarterFor } from './helpers';

const boost = {
  id: 'extra_coaching',
  label: 'Extra coaching',
  description: `+${Math.round((BALANCE.influence.trainingBoostMultiplier - 1) * 100)}% development progress`,
  cost: { time: 0, cash: 0, influence: BALANCE.influence.trainingBoostCost },
  appliesTo: ['program', 'extra'],
};

/** A prospect who wants playing time and is currently not starting. */
function benchedProspect(s: GameState): Player | undefined {
  return clubPlayers(s, s.userClubId)
    .filter((p) => !p.isPitcher && (p.role === 'prospect' || p.age <= 23) && p.priority === 'playingTime' && !isInLineup(s, s.userClubId, p.id) && weakestStarterFor(s, p))
    .sort((a, b) => a.satisfaction - b.satisfaction || a.id.localeCompare(b.id))[0];
}

const growthKeys = (p: Player): RatingKey[] =>
  p.isPitcher ? ['pitching'] : (['contact', 'power', 'fielding'] as RatingKey[]).sort((a, b) => p.ratings[a] - p.ratings[b]).slice(0, 2);

/** The brief's concrete example: a prospect wants a bigger role; a starter competes for the same spot. */
export const individualProspect: EventTemplate = {
  id: 'individual_training_prospect',
  version: 1,
  type: 'individualTraining',
  slot: 'management',
  cooldownRounds: 5,
  weight: (s) => (benchedProspect(s) ? 3 : 0),
  build: ({ state }) => {
    const p = benchedProspect(state)!;
    const rival = state.players[weakestStarterFor(state, p)!];
    const keys = growthKeys(p);
    return {
      kicker: 'Individual Training',
      title: `${p.lastName} Wants a Bigger Role`,
      context: `${playerName(p)} (${p.age}) asks for more playing time. The spot he wants belongs to ${playerName(rival)}${rival.popularity >= 70 ? ', a fan favourite' : ''}.`,
      prompt: 'How do you handle it?',
      subjects: { playerIds: [p.id, rival.id], clubIds: [] },
      data: { playerId: p.id, rivalId: rival.id },
      options: [
        {
          id: 'promise',
          label: `Promise ${BALANCE.promises.startsThreshold} starts in ${BALANCE.promises.windowGames} games`,
          summary: `${p.lastName} replaces ${rival.lastName} in the saved lineup now.`,
          certain: [pos(`${p.lastName} satisfaction +${BALANCE.promises.madeProspect}`), neg(`${rival.lastName} satisfaction ${BALANCE.promises.madeRival}`)],
          uncertain: [neutral(`Kept: +${BALANCE.promises.kept}. Broken: ${BALANCE.promises.broken} (checked against actual lineups)`)],
          cost: cost(),
        },
        {
          id: 'program',
          label: 'Individual program',
          summary: `Extra sessions on ${keys.join(' & ')}. No playing-time guarantee.`,
          certain: [pos(`${p.lastName} satisfaction +2`), neg(`${p.lastName} fitness −2%`)],
          uncertain: [pos(`${keys.join(' & ')} progress`)],
          cost: cost(5_000),
          primary: true,
        },
        { id: 'keep', label: 'Keep his current role', summary: 'The lineup stays as it is.', certain: [neg(`${p.lastName} satisfaction −5`)], uncertain: [], cost: cost() },
      ],
      boosts: [boost],
    };
  },
  optionBlocker: (s, ev, id) => {
    const p = s.players[String(ev.data.playerId)];
    if (!p || p.clubId !== s.userClubId) return 'He is no longer with the club.';
    if (id === 'promise') {
      if (!canPromiseStarts(s)) return 'Too few games left this season for this promise.';
      if (!isInLineup(s, s.userClubId, String(ev.data.rivalId)) && !isInLineup(s, s.userClubId, p.id)) return 'His rival is not in the lineup any more.';
    }
    return null;
  },
  resolve: ({ state, rng, sink, option, event, boost: b }) => {
    const p = state.players[String(event.data.playerId)];
    const rival = state.players[String(event.data.rivalId)];
    if (option.id === 'promise') {
      if (!isInLineup(state, state.userClubId, p.id)) substitute(state, state.userClubId, rival.id, p.id);
      const pr = makeStartsPromise(state, event, p.id, rival.id);
      sink.playerMood(p.id, 'satisfaction', BALANCE.promises.madeProspect, 'Promised regular starts');
      sink.playerMood(rival.id, 'satisfaction', BALANCE.promises.madeRival, `Lost his spot to ${p.lastName}`);
      return {
        headline: `${p.lastName} gets his promise.`,
        narrative: [
          `${pr.threshold} starts in the next ${pr.toRound - pr.fromRound + 1} games, starting with this round's game. It is checked against the actual lineups.`,
          `${playerName(p)} is in the saved lineup; ${rival.lastName} goes to the bench. If you change the lineup, the promise may break.`,
        ],
        reactions: [
          { playerId: p.id, text: 'Thanks for giving me a chance.' },
          { playerId: rival.id, text: 'I’ll be ready when you need me.' },
        ],
      };
    }
    if (option.id === 'program') {
      const mult = b ? BALANCE.influence.trainingBoostMultiplier : 1;
      for (const k of growthKeys(p)) recordProgress(sink, p, k, applyProgress(p, k, 45, userClub(state).facilities.training, rng, mult * trainingModifier(userClub(state))));
      sink.playerMood(p.id, 'satisfaction', 2, 'Given an individual program');
      sink.playerMood(p.id, 'fitness', -2, 'Extra sessions');
      return { headline: `${p.lastName} hits the extra sessions.`, narrative: ['Development, not a promise of minutes.'] };
    }
    sink.playerMood(p.id, 'satisfaction', -5, 'Asked for a bigger role and was told no');
    return { headline: `${p.lastName} is told to be patient.`, narrative: ['He is not happy about it.'], reactions: [{ playerId: p.id, text: 'I thought I’d earned more than this.' }] };
  },
};

/** A struggling or tired veteran starter. */
function strugglingVeteran(s: GameState): Player | undefined {
  return clubPlayers(s, s.userClubId)
    .filter((p) => !p.isPitcher && p.age >= 29 && isInLineup(s, s.userClubId, p.id) && ((p.stats.ab >= 20 && p.stats.h / p.stats.ab < 0.24) || p.fitness < BALANCE.fitness.needsRestBelow + 2))
    .sort((a, b) => b.popularity - a.popularity || a.id.localeCompare(b.id))[0];
}

export const individualVeteran: EventTemplate = {
  id: 'individual_training_veteran',
  version: 1,
  type: 'individualTraining',
  slot: 'management',
  cooldownRounds: 5,
  weight: (s) => (strugglingVeteran(s) ? 2 : 0),
  build: ({ state }) => {
    const p = strugglingVeteran(state)!;
    const spot = userClub(state).lineup.battingOrder.find((s) => s.playerId === p.id)!.position;
    const sub = clubPlayers(state, state.userClubId).find(
      (x) => !x.isPitcher && !isInLineup(state, state.userClubId, x.id) && (spot === 'DH' || x.positions.includes(spot)),
    );
    const avg = p.stats.ab ? (p.stats.h / p.stats.ab).toFixed(3).replace(/^0/, '') : '.000';
    return {
      kicker: 'Individual Training',
      title: `${p.lastName} Is Struggling`,
      context: `${playerName(p)} is hitting ${avg} with fitness ${p.fitness}%.`,
      prompt: 'What does he need?',
      subjects: { playerIds: [p.id], clubIds: [] },
      data: { playerId: p.id, subId: sub?.id ?? '' },
      options: [
        {
          id: 'extra',
          label: 'Extra cage work',
          summary: 'Grind it out.',
          certain: [neg(`${p.lastName} fitness −2%`)],
          uncertain: [pos('Contact progress (small at his age)')],
          cost: cost(3_000),
        },
        {
          id: 'rest',
          label: 'Sit him next game',
          summary: sub ? `${sub.lastName} starts instead.` : 'No natural replacement on the bench.',
          certain: [pos('He recovers on the bench'), neutral(p.priority === 'loyalty' ? 'He accepts it (+2)' : 'He is annoyed (−3)')],
          uncertain: [],
          cost: cost(),
          primary: true,
        },
        { id: 'trust', label: 'Back him publicly', summary: '"He’ll come good."', certain: [pos(`${p.lastName} satisfaction +3`)], uncertain: [], cost: cost() },
      ],
      boosts: [boost],
    };
  },
  optionBlocker: (_s, ev, id) => (id === 'rest' && !ev.data.subId ? 'No bench player can cover his position.' : null),
  resolve: ({ state, rng, sink, option, event, boost: b }) => {
    const p = state.players[String(event.data.playerId)];
    if (option.id === 'extra') {
      const r = applyProgress(p, 'contact', 35, userClub(state).facilities.training, rng, (b ? BALANCE.influence.trainingBoostMultiplier : 1) * trainingModifier(userClub(state)));
      recordProgress(sink, p, 'contact', r);
      sink.playerMood(p.id, 'fitness', -2, 'Extra cage work');
      return { headline: `${p.lastName} stays late in the cage.`, narrative: [`Cost ${fmt(3_000)} for the extra coach.`] };
    }
    if (option.id === 'rest') {
      const subId = String(event.data.subId);
      if (isInLineup(state, state.userClubId, p.id)) substitute(state, state.userClubId, p.id, subId);
      const ok = p.priority === 'loyalty';
      sink.playerMood(p.id, 'satisfaction', ok ? 2 : -3, ok ? 'Accepted a rest day' : 'Benched to rest');
      return { headline: `${p.lastName} gets a breather.`, narrative: [`${state.players[subId].lastName} takes his spot in the saved lineup.`] };
    }
    sink.playerMood(p.id, 'satisfaction', 3, 'Manager backed him publicly');
    return { headline: '"He’ll come good."', narrative: ['Nothing changes on the field — yet.'], reactions: [{ playerId: p.id, text: 'Appreciate the trust, skip.' }] };
  },
};

/** Second team-training template with a different trade-off shape. */
export const teamScrimmage: EventTemplate = {
  id: 'team_training_scrimmage',
  version: 1,
  type: 'teamTraining',
  slot: 'management',
  cooldownRounds: 3,
  weight: () => 2,
  build: ({ state }) => {
    const bench = clubPlayers(state, state.userClubId).filter((p) => !isInLineup(state, state.userClubId, p.id));
    return {
      kicker: 'Team Training',
      title: 'Midweek Session',
      context: `${bench.length} players have barely played lately. The coaches suggest something different this week.`,
      prompt: 'What kind of session?',
      subjects: { playerIds: [], clubIds: [] },
      data: {},
      options: [
        {
          id: 'scrimmage',
          label: 'Intra-squad scrimmage',
          summary: 'Game reps for the bench.',
          certain: [pos('Bench players satisfaction +2'), neg('Everyone fitness −1%')],
          uncertain: [pos('Progress for bench players')],
          cost: cost(),
          primary: true,
        },
        {
          id: 'video',
          label: 'Video study',
          summary: 'Hire an analyst for the day.',
          certain: [neutral('No fitness cost')],
          uncertain: [pos('Small Contact progress for all hitters')],
          cost: cost(3_000),
        },
        { id: 'off', label: 'Day off', summary: 'Everyone rests.', certain: [pos(`Fitness +${BALANCE.training.recoveryFitness}%`)], uncertain: [], cost: cost() },
      ],
      boosts: [],
    };
  },
  resolve: ({ state, rng, sink, option }) => {
    const club = userClub(state);
    const players = clubPlayers(state, club.id);
    if (option.id === 'off') {
      runTeamTraining(state, club.id, 'recovery', 1, rng, sink);
      return { headline: 'A quiet day at the park.', narrative: [] };
    }
    if (option.id === 'video') {
      for (const p of players.filter((x) => !x.isPitcher)) recordProgress(sink, p, 'contact', applyProgress(p, 'contact', 14, club.facilities.training, rng, trainingModifier(club)));
      return { headline: 'Hours of film.', narrative: ['Small gains, fresh legs.'] };
    }
    for (const p of players) {
      if (!isInLineup(state, club.id, p.id)) {
        for (const k of growthKeys(p)) recordProgress(sink, p, k, applyProgress(p, k, 36, club.facilities.training, rng, trainingModifier(club)));
        sink.playerMood(p.id, 'satisfaction', 2, 'Got game reps in the scrimmage');
      }
      sink.playerMood(p.id, 'fitness', -1, 'Scrimmage', { record: false });
    }
    return { headline: 'The bench gets its reps.', narrative: ['Starters played a few innings too.'] };
  },
};
