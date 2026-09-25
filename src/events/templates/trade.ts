import { effectiveRating, offenseScore } from '../../domain/lineup';
import { repairLineup, squadProblem, transferPlayer } from '../../domain/roster';
import type { EventInstance, GameState } from '../../domain/state';
import { clubName, clubPlayers, playerName, userClub } from '../../domain/state';
import type { ClubId, Player, PlayerId } from '../../domain/types';
import { payrollPerSeason } from '../../simulation/economy';
import type { EventDraft, EventTemplate, ResolveContext } from '../types';
import { cost, describeCandidate, fmt, neg, neutral, pos } from './helpers';

interface TradeDeal {
  outId: PlayerId;
  inId: PlayerId;
  partnerId: ClubId;
}

/** Squad problem for either club after swapping the two players, or null. */
export function tradeProblem(state: GameState, deal: TradeDeal): string | null {
  const out = state.players[deal.outId];
  const inc = state.players[deal.inId];
  if (!out || out.clubId !== state.userClubId) return `${out?.lastName ?? 'The player'} is no longer on your roster.`;
  if (!inc || inc.clubId !== deal.partnerId) return `${inc?.lastName ?? 'Their player'} is no longer available.`;
  const mine = [...userClub(state).roster.filter((id) => id !== deal.outId), deal.inId];
  const theirs = [...state.clubs[deal.partnerId].roster.filter((id) => id !== deal.inId), deal.outId];
  const a = squadProblem(state, mine);
  if (a) return `Your squad: ${a}`;
  const b = squadProblem(state, theirs);
  if (b) return `${state.clubs[deal.partnerId].name}: ${b}`;
  return null;
}

const dealOf = (ev: EventInstance): TradeDeal => ({ outId: String(ev.data.outId), inId: String(ev.data.inId), partnerId: String(ev.data.partnerId) });

function findDeal(state: GameState, pickOut: (p: Player) => boolean, pickIn: (p: Player) => boolean, rank: (p: Player) => number): TradeDeal | null {
  const outs = clubPlayers(state, state.userClubId).filter(pickOut).sort((a, b) => b.popularity - a.popularity || a.id.localeCompare(b.id));
  for (const out of outs) {
    for (const partnerId of state.clubOrder.filter((id) => id !== state.userClubId)) {
      const ins = clubPlayers(state, partnerId).filter(pickIn).sort((a, b) => rank(b) - rank(a) || a.id.localeCompare(b.id));
      for (const inc of ins) {
        const deal = { outId: out.id, inId: inc.id, partnerId };
        if (!tradeProblem(state, deal)) return deal;
      }
    }
  }
  return null;
}

const veteranDeal = (s: GameState) =>
  findDeal(
    s,
    (p) => !p.isPitcher && p.age >= 30 && p.popularity >= 55,
    (p) => !p.isPitcher && p.age <= 24,
    (p) => p.potential,
  );

const pitchingDeal = (s: GameState) =>
  findDeal(
    s,
    (p) => p.isPitcher && p.id !== bestPitcher(s),
    (p) => !p.isPitcher && p.role !== 'prospect',
    (p) => offenseScore(p),
  );

function bestPitcher(s: GameState) {
  return clubPlayers(s, s.userClubId)
    .filter((p) => p.isPitcher)
    .sort((a, b) => b.ratings.pitching - a.ratings.pitching)[0]?.id;
}

function tradeDraft(state: GameState, deal: TradeDeal, title: string, context: string): EventDraft {
  const out = state.players[deal.outId];
  const inc = state.players[deal.inId];
  const partner = state.clubs[deal.partnerId];
  const salaryDiff = out.contract.salary - inc.contract.salary;
  const fanHit = Math.round(out.popularity / 12);
  return {
    kicker: 'Trade Offer',
    title,
    context: `${clubName(partner)} offer ${playerName(inc)} (${describeCandidate(inc)}, potential ${inc.potentialEstimate.low}–${inc.potentialEstimate.high}) for ${playerName(out)}. ${context}`,
    prompt: 'Do you make the deal?',
    subjects: { playerIds: [out.id, inc.id], clubIds: [partner.id] },
    data: { ...deal, fanHit, salaryDiff },
    options: [
      {
        id: 'accept',
        label: 'Accept the trade',
        summary: `${out.lastName} leaves, ${inc.lastName} arrives.`,
        certain: [
          salaryDiff >= 0 ? pos(`Payroll −${fmt(salaryDiff)}/season`) : neg(`Payroll +${fmt(-salaryDiff)}/season`),
          ...(fanHit > 0 ? [neg(`Fan support −${fanHit} (${out.lastName} is popular)`)] : []),
        ],
        uncertain: [neutral(`${inc.lastName}'s development is not guaranteed`)],
        cost: cost(),
      },
      {
        id: 'counter',
        label: 'Ask for $20,000 on top',
        summary: 'Push for a sweetener.',
        certain: [],
        uncertain: [neutral('About a 50% chance they walk away')],
        cost: cost(),
      },
      {
        id: 'decline',
        label: 'Decline',
        summary: `${out.lastName} stays.`,
        certain: [pos(`${out.lastName} satisfaction +3`)],
        uncertain: [],
        cost: cost(),
        primary: true,
      },
    ],
    boosts: [],
  };
}

function resolveTrade({ state, rng, sink, event, option }: ResolveContext) {
  const deal = dealOf(event);
  const out = state.players[deal.outId];
  const inc = state.players[deal.inId];
  const partner = state.clubs[deal.partnerId];
  if (option.id === 'decline') {
    sink.playerMood(out.id, 'satisfaction', 3, 'The club turned down a trade for him');
    return { headline: `${out.lastName} stays in Harbor.`, narrative: [`${partner.name} move on.`], reactions: [{ playerId: out.id, text: 'Good to know the club believes in me.' }] };
  }
  if (option.id === 'counter' && !rng.chance(0.5)) {
    return { headline: `${partner.name} walk away.`, narrative: ['They would not add cash. The deal is off.'] };
  }
  const club = userClub(state);
  const payrollBefore = payrollPerSeason(state, club.id);
  transferPlayer(state, out.id, partner.id);
  transferPlayer(state, inc.id, club.id);
  sink.record({ targetKind: 'club', targetId: club.id, targetLabel: 'Payroll', stat: 'payroll', statLabel: '$ per season', before: payrollBefore, after: payrollPerSeason(state, club.id), format: 'cash' });
  if (option.id === 'counter') sink.cash(club.id, 20_000, 'event', `Cash from ${partner.name} in trade`);
  const fanHit = Number(event.data.fanHit);
  if (fanHit > 0) sink.clubMood(club.id, 'fanSupport', -fanHit, `Traded fan favourite ${out.lastName}`);
  const salaryDiff = Number(event.data.salaryDiff);
  if (salaryDiff > 20_000) sink.clubMood(club.id, 'ownerConfidence', 2, 'Trimmed payroll in a trade');
  // Teammates who value loyalty notice a veteran being moved.
  for (const p of clubPlayers(state, club.id)) {
    if (p.priority === 'loyalty' && p.id !== inc.id && out.age >= 30) sink.playerMood(p.id, 'satisfaction', -2, `Teammate ${out.lastName} was traded`);
  }
  repairLineup(state, club.id);
  repairLineup(state, partner.id);
  return {
    headline: `Trade done: ${inc.lastName} in, ${out.lastName} out.`,
    narrative: [
      `${playerName(inc)} joins from ${partner.name}. His contract (${fmt(inc.contract.salary)}/season) moves with him; salary already paid stays paid.`,
      option.id === 'counter' ? `${partner.name} added $20,000.` : '',
      'Check the Team page: the lineup was updated if needed.',
    ].filter(Boolean),
    reactions: [{ playerId: inc.id, text: 'New club, fresh start. Let’s go.' }],
  };
}

export const tradeVeteran: EventTemplate = {
  id: 'trade_veteran',
  version: 1,
  type: 'trade',
  slot: 'management',
  cooldownRounds: 7,
  weight: (s) => (veteranDeal(s) ? 2 : 0),
  build: ({ state }) => {
    const deal = veteranDeal(state)!;
    return tradeDraft(state, deal, 'Youth for a Veteran?', 'A bet on the future at the cost of a familiar face.');
  },
  optionBlocker: (state, ev, optionId) => (optionId === 'decline' ? null : tradeProblem(state, dealOf(ev))),
  resolve: resolveTrade,
};

export const tradePitching: EventTemplate = {
  id: 'trade_pitching',
  version: 1,
  type: 'trade',
  slot: 'management',
  cooldownRounds: 7,
  weight: (s) => (pitchingDeal(s) ? 1.5 : 0),
  build: ({ state }) => {
    const deal = pitchingDeal(state)!;
    const out = state.players[deal.outId];
    return tradeDraft(state, deal, 'A Bat for an Arm', `Losing ${out.lastName} (PIT ${Math.round(effectiveRating(out, 'pitching'))}) thins the rotation.`);
  },
  optionBlocker: (state, ev, optionId) => (optionId === 'decline' ? null : tradeProblem(state, dealOf(ev))),
  resolve: resolveTrade,
};
