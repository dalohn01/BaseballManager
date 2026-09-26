import { BALANCE } from '../../balance/config';
import { trainingModifier } from '../../simulation/economy';
import { offenseScore } from '../../domain/lineup';
import { repairLineup, squadProblem, transferPlayer } from '../../domain/roster';
import type { GameState } from '../../domain/state';
import { clubPlayers, playerName, userClub } from '../../domain/state';
import type { Player } from '../../domain/types';
import { projectedTicketRevenue } from '../../simulation/economy';
import { prospectStarts } from '../../simulation/goals';
import { canPromiseStarts, makeStartsPromise } from '../../simulation/promises';
import { applyProgress, recordProgress } from '../../simulation/training';
import type { EventTemplate } from '../types';
import { cost, fmt, isInLineup, neg, neutral, pos, substitute, weakestStarterFor } from './helpers';

const promiseOf = (s: GameState, id: unknown) => s.promises.find((p) => p.id === String(id));

// ---------- Chain 1: promise of starts → follow-up ----------

export const promiseFollowUp: EventTemplate = {
  id: 'promise_followup',
  version: 1,
  type: 'individualTraining',
  slot: 'followUp',
  cooldownRounds: 0,
  weight: () => 0,
  followUpValid: (s, fu) => {
    const pr = promiseOf(s, fu.data.promiseId);
    return !!pr && (pr.status === 'kept' || pr.status === 'broken') && s.players[pr.playerId]?.clubId === s.userClubId;
  },
  build: ({ state, followUp }) => {
    const pr = promiseOf(state, followUp!.data.promiseId)!;
    const p = state.players[pr.playerId];
    const kept = pr.status === 'kept';
    const rival = pr.rivalId ? state.players[pr.rivalId] : null;
    const canRenew = canPromiseStarts(state) && !isInLineup(state, state.userClubId, p.id);
    return {
      kicker: 'Follow-up',
      title: kept ? `${p.lastName}: Promise Kept` : `${p.lastName}: Promise Broken`,
      context: `In round ${pr.madeAt.round} ("${pr.originTitle}") you promised ${playerName(p)} ${pr.threshold} starts in ${BALANCE.promises.windowGames} games. He started ${pr.progress}. Satisfaction now ${p.satisfaction}.`,
      prompt: kept ? 'What is his role now?' : 'How do you handle it?',
      subjects: { playerIds: [p.id, ...(rival && rival.clubId === state.userClubId ? [rival.id] : [])], clubIds: [] },
      data: { promiseId: pr.id, kept },
      options: kept
        ? [
            {
              id: 'keepStarting',
              label: 'Keep him in the lineup',
              summary: 'He has earned it.',
              certain: [pos(`${p.lastName} satisfaction +3`), ...(rival && rival.clubId === state.userClubId ? [neg(`${rival.lastName} satisfaction −2`)] : [])],
              uncertain: [],
              cost: cost(),
              primary: true,
            },
            { id: 'rotate', label: 'Back to a rotation role', summary: 'He will get starts, not every game.', certain: [neg(`${p.lastName} satisfaction −2`)], uncertain: [], cost: cost() },
          ]
        : [
            {
              id: 'renew',
              label: 'Apologise and promise again',
              summary: 'Two starts in the next three games — for real this time.',
              certain: [pos(`${p.lastName} satisfaction +4`)],
              uncertain: [neutral('Breaking it twice would hurt more')],
              cost: cost(),
              primary: canRenew,
            },
            {
              id: 'program',
              label: 'Offer a development program',
              summary: 'Show you invest in him.',
              certain: [pos(`${p.lastName} satisfaction +2`)],
              uncertain: [pos('Development progress')],
              cost: cost(4_000),
            },
            { id: 'firm', label: 'Stand firm', summary: '"Earn it on the field."', certain: [neg(`${p.lastName} satisfaction −3`)], uncertain: [], cost: cost() },
          ],
      boosts: [],
    };
  },
  optionBlocker: (s, ev, id) => {
    if (id !== 'renew') return null;
    const pr = promiseOf(s, ev.data.promiseId)!;
    if (!canPromiseStarts(s)) return 'Too few games left this season for a new promise.';
    if (isInLineup(s, s.userClubId, pr.playerId)) return null;
    return weakestStarterFor(s, s.players[pr.playerId]) ? null : 'There is no spot he could start in.';
  },
  resolve: ({ state, rng, sink, option, event }) => {
    const pr = promiseOf(state, event.data.promiseId)!;
    const p = state.players[pr.playerId];
    const rival = pr.rivalId ? state.players[pr.rivalId] : null;
    switch (option.id) {
      case 'keepStarting': {
        if (!isInLineup(state, state.userClubId, p.id)) {
          const out = weakestStarterFor(state, p);
          if (out) substitute(state, state.userClubId, out, p.id);
        }
        sink.playerMood(p.id, 'satisfaction', 3, 'Kept in the lineup after the promise');
        if (rival && rival.clubId === state.userClubId) sink.playerMood(rival.id, 'satisfaction', -2, `${p.lastName} keeps his spot`);
        return { headline: `${p.lastName} is a regular now.`, narrative: ['He stays in the saved lineup.'], reactions: [{ playerId: p.id, text: 'You kept your word. I won’t forget it.' }] };
      }
      case 'rotate':
        sink.playerMood(p.id, 'satisfaction', -2, 'Moved back to a rotation role');
        return { headline: `${p.lastName} rotates.`, narrative: ['He accepts it, for now.'] };
      case 'renew': {
        let rivalId: string | null = null;
        if (!isInLineup(state, state.userClubId, p.id)) {
          rivalId = weakestStarterFor(state, p);
          if (rivalId) substitute(state, state.userClubId, rivalId, p.id);
        }
        const npr = makeStartsPromise(state, event, p.id, rivalId);
        sink.playerMood(p.id, 'satisfaction', 4, 'Received a second promise of starts');
        return { headline: 'A second promise.', narrative: [`${npr.threshold} starts in the next ${BALANCE.promises.windowGames} games, checked against the actual lineups.`, 'He is in the saved lineup for the next game.'] };
      }
      case 'program':
        for (const k of p.isPitcher ? (['pitching'] as const) : (['contact', 'fielding'] as const)) recordProgress(sink, p, k, applyProgress(p, k, 40, userClub(state).facilities.training, rng, trainingModifier(userClub(state))));
        sink.playerMood(p.id, 'satisfaction', 2, 'Offered a development program after a broken promise');
        return { headline: 'Extra sessions instead of minutes.', narrative: [] };
      default:
        sink.playerMood(p.id, 'satisfaction', -3, 'Told to earn his starts after a broken promise');
        return { headline: '"Earn it."', narrative: [], reactions: [{ playerId: p.id, text: 'Fine. I’ll remember this.' }] };
    }
  },
};

// ---------- Chain 2: public message → fan reactions → evaluation ----------

export const mediaStanceReview: EventTemplate = {
  id: 'media_stance_review',
  version: 1,
  type: 'media',
  slot: 'followUp',
  cooldownRounds: 0,
  weight: () => 0,
  followUpValid: (s, fu) => userClub(s).publicStance?.eventId === fu.originEventId && s.calendar.phase === 'regular',
  build: ({ state }) => {
    const c = userClub(state);
    const st = c.publicStance!;
    const since = sinceRecord(state, st.round);
    const young = prospectStarts(state, st.season, st.round);
    const pct = since.played ? since.wins / since.played : 0;
    const onTrack = st.stance === 'contend' ? pct >= 0.55 : young >= since.played * 2;
    const quote = st.stance === 'contend' ? 'We’re going for the title' : 'We’re building something';
    return {
      kicker: 'Media Coverage',
      title: 'The Herald Revisits Your Words',
      context: `Round ${st.round}: "${quote}." Since then: ${since.wins}–${since.losses}${st.stance === 'patience' ? `, ${young} starts by players ≤${BALANCE.seasonPlan.rebuild.prospectMaxAge}` : ''}. The paper calls it ${onTrack ? 'on track' : 'off track'}.`,
      prompt: 'Your response?',
      subjects: { playerIds: [], clubIds: [] },
      data: { stance: st.stance, onTrack },
      options:
        st.stance === 'contend'
          ? onTrack
            ? [
                { id: 'credit', label: 'Take the credit', summary: '"Told you."', certain: [pos('Fan support +3'), pos('Owner confidence +2')], uncertain: [], cost: cost(), primary: true },
                { id: 'humble', label: 'Stay humble', summary: '"Long way to go."', certain: [pos('Local roots +2')], uncertain: [], cost: cost() },
              ]
            : [
                { id: 'standBy', label: 'Stand by it', summary: 'Keep the title talk.', certain: [neg('Fan support −3'), neg('Owner confidence −2')], uncertain: [], cost: cost(), primary: true },
                { id: 'backtrack', label: 'Admit it was too bold', summary: 'Switch to patience. The old quote stays on record.', certain: [neg('Fan support −5'), pos('Losses hurt less from now')], uncertain: [], cost: cost() },
              ]
          : onTrack
            ? [
                { id: 'showProgress', label: 'Show the progress', summary: 'Point to the young players.', certain: [pos('Fan support +3'), pos('Local roots +2')], uncertain: [], cost: cost(), primary: true },
                { id: 'raise', label: 'Raise the ambition', summary: '"Now we go for it."', certain: [pos('Fan support +2'), neg('Losses hurt more from now')], uncertain: [], cost: cost() },
              ]
            : [
                { id: 'excuse', label: 'Ask for more time', summary: '"Development takes time."', certain: [neg('Fan support −2'), neg('Owner confidence −1')], uncertain: [], cost: cost(), primary: true },
                { id: 'raise', label: 'Pivot to winning', summary: 'Drop the rebuild message.', certain: [pos('Fan support +1'), neg('Losses hurt more from now')], uncertain: [], cost: cost() },
              ],
      boosts: [],
    };
  },
  resolve: ({ state, sink, option, event }) => {
    const c = userClub(state);
    const stamp = { season: state.calendar.season, round: state.calendar.round, eventId: event.id };
    switch (option.id) {
      case 'credit':
        sink.clubMood(c.id, 'fanSupport', 3, 'Title talk backed up by results');
        sink.clubMood(c.id, 'ownerConfidence', 2, 'Delivering on public ambitions');
        return { headline: '"Told you so."', narrative: [] };
      case 'humble':
        sink.brand(c.id, 'local', 2);
        return { headline: '"Long way to go."', narrative: [] };
      case 'standBy':
        sink.clubMood(c.id, 'fanSupport', -3, 'Title talk not matched by results');
        sink.clubMood(c.id, 'ownerConfidence', -2, 'Public ambitions not met');
        return { headline: '"We still believe."', narrative: ['The Herald is sceptical.'] };
      case 'backtrack':
        sink.clubMood(c.id, 'fanSupport', -5, 'Backtracked on the title talk');
        c.publicStance = { stance: 'patience', ...stamp };
        return { headline: '"Maybe we got ahead of ourselves."', narrative: ['From now on fans take losses more calmly. The original quote stays in the History.'] };
      case 'showProgress':
        sink.clubMood(c.id, 'fanSupport', 3, 'The rebuild is visibly working');
        sink.brand(c.id, 'local', 2);
        return { headline: 'The kids are alright.', narrative: [] };
      case 'raise':
        sink.clubMood(c.id, 'fanSupport', event.data.onTrack ? 2 : 1, 'Raised public ambitions');
        c.publicStance = { stance: 'contend', ...stamp };
        return { headline: '"Now we go for it."', narrative: ['Losses will sting more from here.'] };
      default:
        sink.clubMood(c.id, 'fanSupport', -2, 'Asked for more time');
        sink.clubMood(c.id, 'ownerConfidence', -1, 'Rebuild behind schedule');
        return { headline: '"Development takes time."', narrative: [] };
    }
  },
};

function sinceRecord(state: GameState, fromRound: number) {
  let wins = 0;
  let losses = 0;
  for (const g of state.schedule) {
    if (g.season !== state.calendar.season || g.round < fromRound || !g.result) continue;
    if (g.homeId !== state.userClubId && g.awayId !== state.userClubId) continue;
    const home = g.homeId === state.userClubId;
    const won = home ? g.result.homeRuns > g.result.awayRuns : g.result.awayRuns > g.result.homeRuns;
    if (won) wins++;
    else losses++;
  }
  return { wins, losses, played: wins + losses };
}

// ---------- Low player satisfaction ----------

function unhappiest(s: GameState): Player | undefined {
  return clubPlayers(s, s.userClubId)
    .filter((p) => p.satisfaction < BALANCE.lowMood.tradeRequestBelow)
    .sort((a, b) => a.satisfaction - b.satisfaction || a.id.localeCompare(b.id))[0];
}

/** Partner player of similar kind the AI would give for him, if any trade keeps both squads valid. */
function requestDeal(s: GameState, p: Player) {
  for (const partnerId of s.clubOrder.filter((id) => id !== s.userClubId)) {
    const options = clubPlayers(s, partnerId)
      .filter((x) => x.isPitcher === p.isPitcher)
      .sort((a, b) => Math.abs(offenseScore(a) - offenseScore(p)) - Math.abs(offenseScore(b) - offenseScore(p)) || a.id.localeCompare(b.id));
    for (const x of options) {
      const mine = [...userClub(s).roster.filter((id) => id !== p.id), x.id];
      const theirs = [...s.clubs[partnerId].roster.filter((id) => id !== x.id), p.id];
      if (!squadProblem(s, mine) && !squadProblem(s, theirs)) return { partnerId, inId: x.id };
    }
  }
  return null;
}

export const tradeRequest: EventTemplate = {
  id: 'trade_request',
  version: 1,
  type: 'trade',
  slot: 'management',
  cooldownRounds: 4,
  weight: (s) => (unhappiest(s) ? 6 : 0),
  build: ({ state }) => {
    const p = unhappiest(state)!;
    const deal = requestDeal(state, p);
    const inc = deal ? state.players[deal.inId] : null;
    return {
      kicker: 'Trade Offer',
      title: `${p.lastName} Requests a Trade`,
      context: `${playerName(p)} (satisfaction ${p.satisfaction}) wants out. His reasons: ${p.moodLog.slice(0, 2).map((r) => r.text.toLowerCase()).join('; ') || 'not enough playing time'}.${inc ? ` ${state.clubs[deal!.partnerId].name} would send ${playerName(inc)}.` : ''}`,
      prompt: 'What do you do?',
      subjects: { playerIds: [p.id, ...(inc ? [inc.id] : [])], clubIds: [] },
      data: { playerId: p.id, partnerId: deal?.partnerId ?? '', inId: deal?.inId ?? '' },
      options: [
        { id: 'talk', label: 'Sit down and talk', summary: 'Hear him out.', certain: [pos(`${p.lastName} satisfaction +6`)], uncertain: [], cost: cost(), primary: true },
        {
          id: 'promise',
          label: 'Promise him starts',
          summary: `${BALANCE.promises.startsThreshold} starts in the next ${BALANCE.promises.windowGames} games.`,
          certain: [pos(`${p.lastName} satisfaction +${BALANCE.promises.madeProspect}`)],
          uncertain: [neutral('Checked against actual lineups')],
          cost: cost(),
        },
        {
          id: 'grant',
          label: 'Grant the request',
          summary: inc ? `Trade him for ${playerName(inc)}.` : 'No club has a fitting offer.',
          certain: p.popularity >= 60 ? [neg(`Fan support −${Math.round(p.popularity / 15)}`)] : [],
          uncertain: [],
          cost: cost(),
        },
        { id: 'refuse', label: 'Refuse', summary: '"You are under contract."', certain: [neg(`${p.lastName} satisfaction −4`)], uncertain: [], cost: cost() },
      ],
      boosts: [],
    };
  },
  optionBlocker: (s, ev, id) => {
    const p = s.players[String(ev.data.playerId)];
    if (!p || p.clubId !== s.userClubId) return 'He is no longer with the club.';
    if (id === 'grant') {
      if (!ev.data.inId) return 'No club has a fitting offer.';
      const inc = s.players[String(ev.data.inId)];
      if (inc.clubId !== ev.data.partnerId) return 'The offer is gone.';
    }
    if (id === 'promise') {
      if (!canPromiseStarts(s)) return 'Too few games left this season.';
      if (!isInLineup(s, s.userClubId, p.id) && !p.isPitcher && !weakestStarterFor(s, p)) return 'There is no spot he could start in.';
      if (p.isPitcher) return 'Pitchers rotate; a start promise does not apply.';
    }
    return null;
  },
  resolve: ({ state, sink, option, event }) => {
    const p = state.players[String(event.data.playerId)];
    const c = userClub(state);
    if (option.id === 'talk') {
      sink.playerMood(p.id, 'satisfaction', 6, 'The manager listened to him');
      return { headline: 'Clear-the-air talk.', narrative: ['He feels heard, for now.'] };
    }
    if (option.id === 'promise') {
      let rivalId: string | null = null;
      if (!isInLineup(state, c.id, p.id)) {
        rivalId = weakestStarterFor(state, p);
        if (rivalId) substitute(state, c.id, rivalId, p.id);
      }
      makeStartsPromise(state, event, p.id, rivalId);
      sink.playerMood(p.id, 'satisfaction', BALANCE.promises.madeProspect, 'Promised regular starts');
      if (rivalId) sink.playerMood(rivalId, 'satisfaction', BALANCE.promises.madeRival, `Lost his spot to ${p.lastName}`);
      return { headline: 'He withdraws the request.', narrative: ['The promise will be checked against the next games.'] };
    }
    if (option.id === 'grant') {
      const inc = state.players[String(event.data.inId)];
      const partner = String(event.data.partnerId);
      transferPlayer(state, p.id, partner);
      transferPlayer(state, inc.id, c.id);
      if (p.popularity >= 60) sink.clubMood(c.id, 'fanSupport', -Math.round(p.popularity / 15), `${p.lastName} forced a trade`);
      repairLineup(state, c.id);
      repairLineup(state, partner);
      return { headline: `${p.lastName} gets his wish.`, narrative: [`${playerName(inc)} arrives from ${state.clubs[partner].name}.`], reactions: [{ playerId: inc.id, text: 'Happy to be here.' }] };
    }
    sink.playerMood(p.id, 'satisfaction', -4, 'Trade request refused');
    return { headline: 'Request denied.', narrative: ['Expect him to stay unhappy.'] };
  },
};

// ---------- Low fan support ----------

export const fansProtest: EventTemplate = {
  id: 'fans_protest',
  version: 1,
  type: 'fanInteraction',
  slot: 'management',
  cooldownRounds: 5,
  weight: (s) => (userClub(s).fanSupport < BALANCE.lowMood.protestBelow ? 6 : 0),
  build: ({ state }) => {
    const c = userClub(state);
    const now = projectedTicketRevenue(c);
    const lvl = Math.max(1, c.ticketPriceLevel - 2);
    return {
      kicker: 'Fan Interaction',
      title: 'Protest Outside the Ballpark',
      context: `Fan support has fallen to ${c.fanSupport}; gates are down to about ${fmt(now)} per home game. Latest grievance: ${c.reasons.fanSupport[0]?.text ?? 'results'}.`,
      prompt: 'How do you respond?',
      subjects: { playerIds: [], clubIds: [] },
      data: { level: lvl },
      options: [
        { id: 'meet', label: 'Meet the protest leaders', summary: 'Listen in public.', certain: [pos('Fan support +5'), neg('Owner confidence −1')], uncertain: [], cost: cost(), primary: true },
        {
          id: 'cut',
          label: 'Cut ticket prices sharply',
          summary: `Prices to $${BALANCE.economy.ticketPrices[lvl - 1]}.`,
          certain: [pos('Fan support +8'), neg(`Home gate ≈ ${fmt(now)} → ${fmt(projectedTicketRevenue(c, lvl, Math.min(100, c.fanSupport + 8)))}`)],
          uncertain: [],
          cost: cost(),
        },
        { id: 'ignore', label: 'Ignore it', summary: 'It will blow over.', certain: [neg('Fan support −3')], uncertain: [], cost: cost() },
      ],
      boosts: [],
    };
  },
  resolve: ({ state, sink, option, event }) => {
    const c = userClub(state);
    if (option.id === 'meet') {
      sink.clubMood(c.id, 'fanSupport', 5, 'Met the protest leaders');
      sink.clubMood(c.id, 'ownerConfidence', -1, 'Gave the protest a platform');
      return { headline: 'Tempers cool.', narrative: [] };
    }
    if (option.id === 'cut') {
      c.ticketPriceLevel = Number(event.data.level);
      sink.clubMood(c.id, 'fanSupport', 8, 'Cut ticket prices sharply');
      return { headline: 'Cheap seats return.', narrative: ['Revenue per fan drops.'] };
    }
    sink.clubMood(c.id, 'fanSupport', -3, 'Ignored the fan protest');
    return { headline: 'The protest grows.', narrative: [] };
  },
};
