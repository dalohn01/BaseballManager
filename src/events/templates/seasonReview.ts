import { userClub } from '../../domain/state';
import { computeStandings } from '../../simulation/standings';
import type { EventTemplate } from '../types';

/** Season end summary. Contracts, ageing and season two arrive in Step 3. */
export const seasonReview: EventTemplate = {
  id: 'season_review',
  version: 1,
  type: 'seasonReview',
  slot: 'seasonEnd',
  cooldownRounds: 0,
  weight: () => 1,
  build: ({ state }) => {
    const table = computeStandings(state);
    const pos = table.findIndex((r) => r.clubId === state.userClubId) + 1;
    const row = table[pos - 1];
    const champ = state.clubs[table[0].clubId];
    const bonus = userClub(state).sponsor?.bonus;
    const bonusText = bonus && !bonus.paid ? (pos <= 3 ? ` Your sponsor pays a $${bonus.amount.toLocaleString('en-US')} top-3 bonus.` : ' No sponsor bonus: you missed the top 3.') : '';
    return {
      kicker: 'Season Review',
      title: `Season ${state.calendar.season} Complete`,
      context: `${champ.city} ${champ.name} are champions. You finished ${pos} of ${table.length} at ${row.wins}–${row.losses} (run differential ${row.diff >= 0 ? '+' : ''}${row.diff}).${bonusText}`,
      prompt: 'Close the book on this season.',
      subjects: { playerIds: [], clubIds: [champ.id] },
      data: { position: pos, wins: row.wins, losses: row.losses },
      options: [{ id: 'close', label: 'Close the season', summary: 'Review done.', certain: [], uncertain: [], cost: { time: 0, cash: 0, influence: 0 }, primary: true }],
      boosts: [],
    };
  },
  resolve: ({ state, sink, event }) => {
    const club = userClub(state);
    const bonus = club.sponsor?.bonus;
    const narrative: string[] = [];
    if (bonus && !bonus.paid && Number(event.data.position) <= 3) {
      bonus.paid = true;
      sink.cash(club.id, bonus.amount, 'sponsor', `${club.sponsor!.name} top-3 bonus`);
      narrative.push('Sponsor bonus paid.');
    }
    state.calendar.phase = 'seasonComplete';
    narrative.push('Contracts, ageing and season two arrive in the next build step.');
    return { headline: `${club.name}: ${event.data.wins}–${event.data.losses}, finished #${event.data.position}.`, narrative };
  },
};
