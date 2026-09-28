import { BALANCE } from '../../balance/config';
import { clubPlayers, playerName, userClub } from '../../domain/state';
import type { EventOption } from '../../domain/state';
import type { EventTemplate } from '../types';
import { squadMean } from '../../simulation/cycle';
import { lastUserGame } from './fanInteraction';
import { cost, neg, pos } from './helpers';

const M = BALANCE.media;

/**
 * Generic post-match media: the fixed media slot's fallback when no special
 * variant fits (follow-up, season opener, a loss reaction, a feature). It can
 * come every match, so it has no cooldown; effects are small, and the
 * Influence option is an extra effort, never needed to move on.
 */
export const mediaPostgame: EventTemplate = {
  id: 'media_postgame',
  version: 1,
  type: 'media',
  slot: 'media',
  cooldownRounds: 0,
  weight: () => 1,
  build: ({ state, rng }) => {
    const last = lastUserGame(state);
    const opp = last ? state.clubs[last.opponentId] : null;
    const won = !!last?.won;
    const score = last ? `${last.us}–${last.them}` : '';
    const match = last ? state.matches[last.game.id] : null;
    // Standout from what actually happened (not invented): most hits + RBI among our starters.
    const ours = match ? match.lineups[match.homeId === state.userClubId ? 'home' : 'away'].battingOrder.map((s) => s.playerId) : [];
    const star = ours
      .map((id) => ({ id, l: match!.batting[id] }))
      .filter((x) => x.l && x.l.h + x.l.rbi >= 3)
      .sort((a, b) => b.l.hr * 3 + b.l.h + b.l.rbi - (a.l.hr * 3 + a.l.h + a.l.rbi))[0];
    const starP = star ? state.players[star.id] : null;
    const openers = won
      ? [`Reporters crowd the clubhouse after the ${score} win over the ${opp?.name}.`, `A ${score} win over the ${opp?.name}. The press wants a word.`]
      : [`Quiet clubhouse after the ${score} loss to the ${opp?.name}. The press is waiting.`, `The ${opp?.name} win ${score.split('–').reverse().join('–')}. Microphones are out.`];
    const options: EventOption[] = won
      ? [
          { id: 'team', label: 'Credit the whole team', summary: 'Everyone gets a share of the praise.', certain: [pos(`Every player +${M.squad}`), pos(`Fan support +${M.fans}`)], uncertain: [], cost: cost(), primary: true },
          ...(starP
            ? [{ id: 'star', label: `Praise ${starP.lastName}`, summary: 'Put the spotlight on the best performer.', certain: [pos(`${playerName(starP)} +${M.star}`), pos('Popularity +2')], uncertain: [], cost: cost() }]
            : []),
          { id: 'grounded', label: 'Stay grounded', summary: '"One game at a time."', certain: [pos(`Owner confidence +${M.owners}`)], uncertain: [], cost: cost() },
        ]
      : [
          { id: 'back', label: 'Back your players', summary: 'Shield the group from criticism.', certain: [pos(`Every player +${M.squad}`), neg(`Owner confidence −${M.owners}`)], uncertain: [], cost: cost(), primary: true },
          { id: 'own', label: 'Take responsibility', summary: 'The manager takes the blame.', certain: [pos(`Fan support +${M.fans}`)], uncertain: [], cost: cost() },
          { id: 'demand', label: 'Demand more effort', summary: 'Public criticism of the performance.', certain: [pos(`Owner confidence +${M.owners * 2}`), neg(`Every player −${M.squad * 2}`)], uncertain: [], cost: cost() },
        ];
    options.push({
      id: 'session',
      label: 'Open press session',
      summary: 'Extra time with local media and supporters.',
      certain: [pos(`Fan support +${M.sessionFans}`), pos('Local roots +1')],
      uncertain: [],
      cost: cost(0, M.sessionInfluence),
    });
    return {
      kicker: 'Post-match Media',
      title: won ? 'After the Win' : 'After the Loss',
      context: rng.pick(openers),
      prompt: 'What do you tell them?',
      subjects: { playerIds: starP && won ? [starP.id] : [], clubIds: [] },
      data: { won, starId: starP?.id ?? null },
      options,
      boosts: [],
    };
  },
  resolve: ({ state, sink, option, event }) => {
    const c = userClub(state);
    const squad = (d: number, reason: string) => {
      const before = squadMean(state);
      for (const p of clubPlayers(state, c.id)) sink.playerMood(p.id, 'satisfaction', d, reason, { record: false });
      sink.record({ targetKind: 'team', targetId: c.id, targetLabel: 'Squad average', stat: 'satisfaction', statLabel: 'Happiness', before: Math.round(before), after: Math.round(squadMean(state)) });
    };
    switch (option.id) {
      case 'team':
        squad(M.squad, 'Credited by the manager after a win');
        sink.clubMood(c.id, 'fanSupport', M.fans, 'Manager credited the whole team');
        return { headline: '"Everyone did their job."', narrative: [] };
      case 'star': {
        const id = String(event.data.starId);
        sink.playerMood(id, 'satisfaction', M.star, 'Praised in the press');
        sink.playerMood(id, 'popularity', 2, 'Praised in the press');
        return { headline: `${state.players[id].lastName} gets the headlines.`, narrative: [] };
      }
      case 'grounded':
        sink.clubMood(c.id, 'ownerConfidence', M.owners, 'Kept expectations grounded');
        return { headline: '"One game at a time."', narrative: [] };
      case 'back':
        squad(M.squad, 'Manager backed the players after a loss');
        sink.clubMood(c.id, 'ownerConfidence', -M.owners, 'Defended a losing performance');
        return { headline: '"I believe in this group."', narrative: [] };
      case 'own':
        sink.clubMood(c.id, 'fanSupport', M.fans, 'Manager took responsibility');
        return { headline: '"That one is on me."', narrative: [] };
      case 'demand':
        sink.clubMood(c.id, 'ownerConfidence', M.owners * 2, 'Demanded more effort');
        squad(-M.squad * 2, 'Criticised in the press');
        return { headline: '"Not good enough."', narrative: [] };
      default:
        sink.clubMood(c.id, 'fanSupport', M.sessionFans, 'Held an open press session');
        sink.brand(c.id, 'local', 1);
        return { headline: 'A long session with the local press.', narrative: ['Supporters appreciated the access.'] };
    }
  },
};
