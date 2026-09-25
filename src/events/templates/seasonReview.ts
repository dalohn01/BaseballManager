import { userClub } from '../../domain/state';
import { computeStandings } from '../../simulation/standings';
import type { EventTemplate } from '../types';

/** Minimal season end for Step 1. Full off-season (contracts, draft, ageing) comes in Step 3. */
export const seasonReview: EventTemplate = {
  id: 'season_review',
  version: 1,
  type: 'seasonReview',
  slot: 'seasonReview',
  cooldownRounds: 0,
  weight: () => 1,
  build: ({ state }) => {
    const table = computeStandings(state);
    const pos = table.findIndex((r) => r.clubId === state.userClubId) + 1;
    const row = table[pos - 1];
    const champ = state.clubs[table[0].clubId];
    return {
      kicker: 'Season Review',
      title: `Season ${state.calendar.season} Complete`,
      context: `${champ.city} ${champ.name} are champions. You finished ${pos} of ${table.length} at ${row.wins}–${row.losses} (run differential ${row.diff >= 0 ? '+' : ''}${row.diff}).`,
      prompt: 'Close the book on this season.',
      subjects: { playerIds: [], clubIds: [champ.id] },
      data: { position: pos, wins: row.wins, losses: row.losses },
      options: [
        {
          id: 'close',
          label: 'Close the season',
          summary: 'Review done.',
          certain: [],
          uncertain: [],
          cost: { time: 0, cash: 0, influence: 0 },
          primary: true,
        },
      ],
      boosts: [],
    };
  },
  resolve: ({ state, event }) => {
    state.calendar.phase = 'seasonComplete';
    return {
      headline: `${userClub(state).name}: ${event.data.wins}–${event.data.losses}, finished #${event.data.position}.`,
      narrative: ['The off-season (contracts, draft, ageing) arrives in a later build step.'],
    };
  },
};
