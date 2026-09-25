import { BALANCE } from '../../balance/config';
import type { GameState } from '../../domain/state';
import { clubPlayers, playerName, shortName, userClub } from '../../domain/state';
import { projectedTicketRevenue } from '../../simulation/economy';
import type { EventTemplate } from '../types';

const T = BALANCE.time.costPerEvent;
const fmt = (n: number) => `$${Math.abs(Math.round(n)).toLocaleString('en-US')}`;

export function lastUserGame(state: GameState) {
  const games = state.schedule
    .filter((g) => g.result && (g.homeId === state.userClubId || g.awayId === state.userClubId))
    .sort((a, b) => a.season - b.season || a.round - b.round);
  const g = games[games.length - 1];
  if (!g) return null;
  const isHome = g.homeId === state.userClubId;
  const us = isHome ? g.result!.homeRuns : g.result!.awayRuns;
  const them = isHome ? g.result!.awayRuns : g.result!.homeRuns;
  return { game: g, won: us > them, us, them, opponentId: isHome ? g.awayId : g.homeId };
}

export const fansTicketPrices: EventTemplate = {
  id: 'fans_ticket_prices',
  version: 1,
  type: 'fanInteraction',
  slot: 'management',
  cooldownRounds: 5,
  weight: (s) => {
    const c = userClub(s);
    return c.ticketPriceLevel >= 2 && c.fanSupport < 88 ? 3 : 0;
  },
  build: ({ state }) => {
    const c = userClub(state);
    const now = projectedTicketRevenue(c);
    const lower = projectedTicketRevenue(c, c.ticketPriceLevel - 1, Math.min(100, c.fanSupport + 6));
    const price = BALANCE.economy.ticketPrices[c.ticketPriceLevel - 1];
    const lowerPrice = BALANCE.economy.ticketPrices[c.ticketPriceLevel - 2];
    return {
      kicker: 'Fan Interaction',
      title: 'Fans Push Back on Prices',
      context: `The supporters' club says $${price} tickets are keeping families away. A petition is circulating before the next home stand.`,
      prompt: 'How do we respond?',
      subjects: { playerIds: [], clubIds: [c.id] },
      data: { revenueNow: now, revenueLower: lower, price, lowerPrice },
      options: [
        {
          id: 'lower',
          label: `Lower prices to $${lowerPrice}`,
          summary: 'A visible gesture to the stands.',
          certain: [
            { text: 'Fan support +6', tone: 'positive' },
            { text: `Home gate ≈ ${fmt(now)} → ${fmt(lower)}`, tone: lower < now ? 'negative' : 'positive' },
          ],
          uncertain: [],
          cost: { time: T, cash: 0, influence: 0 },
        },
        {
          id: 'forum',
          label: 'Host a fan forum',
          summary: 'Listen, explain, keep prices.',
          certain: [
            { text: 'Fan support +3', tone: 'positive' },
            { text: 'Local roots +2', tone: 'positive' },
          ],
          uncertain: [],
          cost: { time: T, cash: 4_000, influence: 0 },
          primary: true,
        },
        {
          id: 'hold',
          label: 'Hold the line',
          summary: 'Revenue matters. Prices stay.',
          certain: [
            { text: 'Fan support −3', tone: 'negative' },
            { text: 'Owner confidence +2', tone: 'positive' },
          ],
          uncertain: [],
          cost: { time: T, cash: 0, influence: 0 },
        },
      ],
      boosts: [],
    };
  },
  resolve: ({ state, sink, option }) => {
    const c = userClub(state);
    if (option.id === 'lower') {
      const before = c.ticketPriceLevel;
      c.ticketPriceLevel = Math.max(1, before - 1);
      sink.record({ targetKind: 'club', targetId: c.id, targetLabel: 'Tickets', stat: 'ticketPrice', statLabel: 'Ticket price ($)', before: BALANCE.economy.ticketPrices[before - 1], after: BALANCE.economy.ticketPrices[c.ticketPriceLevel - 1] });
      sink.clubMood(c.id, 'fanSupport', 6, 'Lowered ticket prices');
      return { headline: 'Cheaper seats, warmer stands.', narrative: ['The petition is withdrawn. Expect a slightly smaller gate per fan but a friendlier crowd.'] };
    }
    if (option.id === 'forum') {
      sink.clubMood(c.id, 'fanSupport', 3, 'Held an open fan forum');
      sink.brand(c.id, 'local', 2);
      return { headline: 'The forum clears the air.', narrative: ['Fans appreciated being heard, even if prices stay.'] };
    }
    sink.clubMood(c.id, 'fanSupport', -3, 'Refused to cut ticket prices');
    sink.clubMood(c.id, 'ownerConfidence', 2, 'Protected ticket revenue');
    return { headline: 'Prices stay. The stands grumble.', narrative: ['The owners like the discipline. The supporters’ club does not.'] };
  },
};

export const fansCommunityDay: EventTemplate = {
  id: 'fans_community_day',
  version: 1,
  type: 'fanInteraction',
  slot: 'management',
  cooldownRounds: 6,
  weight: () => 2,
  build: ({ state }) => {
    const players = clubPlayers(state, state.userClubId);
    const star = [...players].sort((a, b) => b.popularity - a.popularity || a.id.localeCompare(b.id))[0];
    const prospect =
      [...players].filter((p) => p.role === 'prospect' && p.id !== star.id).sort((a, b) => a.age - b.age || a.id.localeCompare(b.id))[0] ??
      [...players].filter((p) => p.id !== star.id).sort((a, b) => a.age - b.age)[0];
    return {
      kicker: 'Fan Interaction',
      title: 'Community Day Request',
      context: `Harbor schools want a player to visit on the off-day. Everyone asks for ${playerName(star)}; ${playerName(prospect)} has quietly volunteered.`,
      prompt: 'Who represents the club?',
      subjects: { playerIds: [star.id, prospect.id], clubIds: [] },
      data: { starId: star.id, prospectId: prospect.id },
      options: [
        {
          id: 'star',
          label: `Send ${star.lastName}`,
          summary: 'The face of the club draws a crowd.',
          certain: [
            { text: 'Fan support +4', tone: 'positive' },
            { text: 'Local roots +3', tone: 'positive' },
            { text: `${star.lastName} fatigue +6`, tone: 'negative' },
          ],
          uncertain: [{ text: `${star.lastName}'s mood depends on his priorities`, tone: 'neutral' }],
          cost: { time: T, cash: 6_000, influence: 0 },
        },
        {
          id: 'prospect',
          label: `Send ${prospect.lastName}`,
          summary: 'A chance for a young player to be seen.',
          certain: [
            { text: 'Fan support +2', tone: 'positive' },
            { text: `${prospect.lastName} popularity +6, satisfaction +3`, tone: 'positive' },
          ],
          uncertain: [],
          cost: { time: T, cash: 3_000, influence: 0 },
          primary: true,
        },
        {
          id: 'decline',
          label: 'Politely decline',
          summary: 'Focus on baseball.',
          certain: [{ text: 'Fan support −2', tone: 'negative' }],
          uncertain: [],
          cost: { time: T, cash: 0, influence: 0 },
        },
      ],
      boosts: [],
    };
  },
  resolve: ({ state, sink, option, event }) => {
    const c = userClub(state);
    const star = state.players[String(event.data.starId)];
    const prospect = state.players[String(event.data.prospectId)];
    if (option.id === 'star' && star) {
      sink.clubMood(c.id, 'fanSupport', 4, `${star.lastName} visited local schools`);
      sink.brand(c.id, 'local', 3);
      sink.playerMood(star.id, 'fatigue', 6, 'Community day');
      const likes = star.priority === 'loyalty';
      sink.playerMood(star.id, 'satisfaction', likes ? 4 : -2, likes ? 'Proud to represent the community' : 'Asked to give up an off-day');
      return {
        headline: `${star.lastName} draws a crowd.`,
        narrative: [likes ? `${star.lastName} loved it — this town means a lot to him.` : `${star.lastName} did it, but would have preferred the rest.`],
        reactions: [{ playerId: star.id, text: likes ? 'This is why I play here.' : 'Happy to help. Next time, maybe one of the kids?' }],
      };
    }
    if (option.id === 'prospect' && prospect) {
      sink.clubMood(c.id, 'fanSupport', 2, `${prospect.lastName} visited local schools`);
      sink.playerMood(prospect.id, 'popularity', 6, 'Community day');
      sink.playerMood(prospect.id, 'satisfaction', 3, 'Trusted to represent the club');
      return {
        headline: `${shortName(prospect)} wins new fans.`,
        narrative: ['Smaller crowd than a star would draw, but the kids have a new favourite.'],
        reactions: [{ playerId: prospect.id, text: 'Thanks for trusting me with that.' }],
      };
    }
    sink.clubMood(c.id, 'fanSupport', -2, 'Declined a community day');
    return { headline: 'The schools are disappointed.', narrative: ['A small dent in goodwill, but the squad keeps its rest day.'] };
  },
};

export const fansAfterLoss: EventTemplate = {
  id: 'fans_after_loss',
  version: 1,
  type: 'fanInteraction',
  slot: 'management',
  cooldownRounds: 3,
  weight: (s) => {
    const last = lastUserGame(s);
    return last && !last.won && last.game.season === s.calendar.season ? 4 : 0;
  },
  build: ({ state }) => {
    const last = lastUserGame(state)!;
    const opp = state.clubs[last.opponentId];
    return {
      kicker: 'Fan Interaction',
      title: 'Frustration After the Loss',
      context: `The ${last.us}–${last.them} defeat to ${opp.name} has fans venting outside the ballpark.`,
      prompt: 'What does the club do?',
      subjects: { playerIds: [], clubIds: [opp.id] },
      data: { gameId: last.game.id },
      options: [
        {
          id: 'autographs',
          label: 'Players stay to sign',
          summary: 'Show the fans the team cares.',
          certain: [
            { text: 'Fan support +3', tone: 'positive' },
            { text: 'Starters fatigue +3', tone: 'negative' },
          ],
          uncertain: [],
          cost: { time: T, cash: 0, influence: 0 },
          primary: true,
        },
        {
          id: 'statement',
          label: 'Own it publicly',
          summary: 'The manager takes responsibility.',
          certain: [
            { text: 'Fan support +2', tone: 'positive' },
            { text: 'Owner confidence −1', tone: 'negative' },
          ],
          uncertain: [],
          cost: { time: T, cash: 0, influence: 0 },
        },
        {
          id: 'quiet',
          label: 'Say nothing',
          summary: 'Let the results do the talking.',
          certain: [{ text: 'Fan support −2', tone: 'negative' }],
          uncertain: [],
          cost: { time: T, cash: 0, influence: 0 },
        },
      ],
      boosts: [],
    };
  },
  resolve: ({ state, sink, option }) => {
    const c = userClub(state);
    if (option.id === 'autographs') {
      sink.clubMood(c.id, 'fanSupport', 3, 'Players signed autographs after a loss');
      for (const slot of c.lineup.battingOrder) sink.playerMood(slot.playerId, 'fatigue', 3, 'Autograph session', { record: false });
      return { headline: 'A long line, a better mood.', narrative: ['The starters stayed an hour. Fans noticed.'] };
    }
    if (option.id === 'statement') {
      sink.clubMood(c.id, 'fanSupport', 2, 'Manager took responsibility');
      sink.clubMood(c.id, 'ownerConfidence', -1, 'Public admission of a poor performance');
      return { headline: '"That one is on me."', narrative: ['Fans respect the honesty. The owners would rather you had not said it on camera.'] };
    }
    sink.clubMood(c.id, 'fanSupport', -2, 'Silence after a loss');
    return { headline: 'No comment.', narrative: ['The mood outside the ballpark stays sour.'] };
  },
};
