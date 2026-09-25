import { BALANCE } from '../../balance/config';
import { createPlayer, marketSalary } from '../../content/playerFactory';
import type { Rng } from '../../domain/rng';
import { joinClub, positionNeeds, repairLineup, squadProblem } from '../../domain/roster';
import type { EventInstance, EventOption, GameState } from '../../domain/state';
import { absoluteRound, nextId, playerName, userClub } from '../../domain/state';
import type { LineupPosition, Player } from '../../domain/types';
import { computeStandings } from '../../simulation/standings';
import type { EventTemplate, ResolveContext } from '../types';
import { competitionReaction, cost, describeCandidate, fmt, neg, neutral, passOption } from './helpers';

const R = BALANCE.recruitment;

function candidateOption(p: Player, fee: number, extra: Partial<EventOption> = {}): EventOption {
  return {
    id: `sign:${p.id}`,
    candidateId: p.id,
    label: `Sign ${playerName(p)}`,
    summary: describeCandidate(p),
    certain: [neg(`Salary ${fmt(p.contract.salary)}/season × ${p.contract.seasonsLeft}`), neutral('Paid from next round')],
    uncertain: [neutral(`Potential ${p.potentialEstimate.low}–${p.potentialEstimate.high} (scouted)`)],
    cost: cost(fee),
    ...extra,
  };
}

function rosterBlocker(state: GameState, event: EventInstance, optionId: string): string | null {
  const option = event.options.find((o) => o.id === optionId);
  if (!option?.candidateId) return null;
  const club = userClub(state);
  const p = event.candidates.find((c) => c.id === option.candidateId)!;
  const tmp = { ...state, players: { ...state.players, [p.id]: p } };
  return squadProblem(tmp, [...club.roster, p.id]);
}

function signCandidate({ state, sink, event, option }: ResolveContext, fee: number) {
  const p = structuredClone(event.candidates.find((c) => c.id === option.candidateId)!);
  const club = userClub(state);
  const sizeBefore = club.roster.length;
  joinClub(state, p, club.id);
  sink.record({ targetKind: 'club', targetId: club.id, targetLabel: 'Roster', stat: 'roster', statLabel: 'Players', before: sizeBefore, after: club.roster.length });
  competitionReaction(state, sink, p);
  const repaired = repairLineup(state, club.id);
  return {
    p,
    narrative: [
      `${playerName(p)} (${describeCandidate(p)}) joins on ${fmt(p.contract.salary)} per season${fee ? ` after a ${fmt(fee)} signing fee` : ''}.`,
      ...(repaired ? ['The lineup was rebuilt to stay valid.'] : []),
    ],
  };
}

// ---------- Free agents ----------

function freeAgentCandidates(state: GameState, rng: Rng): Player[] {
  const needs = positionNeeds(state, state.userClubId);
  const scouting = userClub(state).facilities.scouting;
  const { season, round } = state.calendar;
  const base = { clubId: '', startRound: absoluteRound(season, round) + 1, joinedSeason: season, scoutingLevel: scouting };
  const mk = (primary: LineupPosition | 'P', age: number, level: number, upside: number, role: Player['role'], seasons: number) =>
    createPlayer({ ...base, id: nextId(state, 'p'), primary, age, level, upside, role, salary: marketSalary(level, age), seasonsLeft: seasons }, rng);
  return [
    mk(needs[0], rng.int(29, 33), rng.int(66, 72), rng.int(0, 3), 'starter', rng.int(1, 2)),
    mk(needs[1] ?? needs[0], rng.int(26, 31), rng.int(56, 62), rng.int(1, 5), 'reserve', 1),
    mk(rng.pick(needs.slice(0, 3)), rng.int(21, 24), rng.int(54, 60), rng.int(12, 20), 'prospect', rng.int(2, 3)),
  ];
}

function freeAgentOptions(cands: Player[]): EventOption[] {
  const labels = ['Proven quality', 'Affordable depth', 'Young upside'];
  return [
    ...cands.map((p, i) => candidateOption(p, Math.round(p.contract.salary * R.freeAgentFeeShare), { summary: `${labels[i]} · ${describeCandidate(p)}`, primary: i === 0 })),
    passOption('Pass', 'Save the money.'),
  ];
}

export const freeAgent: EventTemplate = {
  id: 'free_agent',
  version: 1,
  type: 'freeAgent',
  slot: 'management',
  cooldownRounds: 5,
  weight: (s) => (userClub(s).roster.length < BALANCE.roster.max ? 2 : 0),
  build: ({ state, rng }) => {
    const candidates = freeAgentCandidates(state, rng);
    return {
      kicker: 'Free Agent Signing',
      title: 'Free Agents Available',
      context: `Three players are looking for a club. Your thinnest spots: ${positionNeeds(state, state.userClubId).slice(0, 3).join(', ')}.`,
      prompt: 'Make an offer?',
      subjects: { playerIds: [], clubIds: [] },
      data: {},
      options: freeAgentOptions(candidates),
      boosts: [],
      candidates,
      rerollCost: BALANCE.influence.rerollCost,
    };
  },
  reroll: ({ state, rng }) => {
    const candidates = freeAgentCandidates(state, rng);
    return { candidates, options: freeAgentOptions(candidates), context: 'Your scouts dug up a different set of free agents.' };
  },
  optionBlocker: rosterBlocker,
  resolve: (ctx) => {
    if (ctx.option.id === 'pass') return { headline: 'No signing this time.', narrative: ['The free agents sign elsewhere.'] };
    const { p, narrative } = signCandidate(ctx, ctx.option.cost.cash);
    return { headline: `${playerName(p)} signs with the club.`, narrative, reactions: [{ playerId: p.id, text: 'Ready to earn my spot.' }] };
  },
};

// ---------- Tryouts ----------

function tryoutCandidates(state: GameState, rng: Rng): Player[] {
  const needs = positionNeeds(state, state.userClubId);
  const scouting = userClub(state).facilities.scouting;
  const { season, round } = state.calendar;
  return [0, 1, 2].map((i) =>
    createPlayer(
      {
        id: nextId(state, 'p'),
        clubId: '',
        primary: i === 2 ? 'P' : rng.pick(needs.slice(0, 4)),
        age: rng.int(18, 21),
        level: rng.int(40, 52),
        upside: rng.int(12, 32),
        role: 'prospect',
        salary: rng.int(8, 12) * 1000,
        seasonsLeft: 3,
        startRound: absoluteRound(season, round) + 1,
        joinedSeason: season,
        scoutingLevel: scouting,
      },
      rng,
    ),
  );
}

const tryoutOptions = (cands: Player[]) => [
  ...cands.map((p) => candidateOption(p, R.tryoutFee, { summary: `Raw talent · ${describeCandidate(p)}` })),
  passOption('Thank them and pass', 'Nobody convinced you.'),
];

export const tryouts: EventTemplate = {
  id: 'tryouts',
  version: 1,
  type: 'tryouts',
  slot: 'management',
  cooldownRounds: 6,
  weight: (s) => (userClub(s).roster.length < BALANCE.roster.max ? 2 : 0),
  build: ({ state, rng }) => {
    const candidates = tryoutCandidates(state, rng);
    return {
      kicker: 'Tryouts',
      title: 'Open Tryout Day',
      context: `Local hopefuls showed up at Harbor Park. Scouting level ${userClub(state).facilities.scouting}: potential ranges are estimates.`,
      prompt: 'Offer someone a contract?',
      subjects: { playerIds: [], clubIds: [] },
      data: {},
      options: tryoutOptions(candidates),
      boosts: [],
      candidates,
      rerollCost: BALANCE.influence.rerollCost,
    };
  },
  reroll: ({ state, rng }) => {
    const candidates = tryoutCandidates(state, rng);
    return { candidates, options: tryoutOptions(candidates), context: 'A second group went through the drills.' };
  },
  optionBlocker: rosterBlocker,
  resolve: (ctx) => {
    if (ctx.option.id === 'pass') return { headline: 'No contracts offered.', narrative: ['Maybe next time.'] };
    const { p, narrative } = signCandidate(ctx, ctx.option.cost.cash);
    return { headline: `${playerName(p)} earns a contract.`, narrative, reactions: [{ playerId: p.id, text: 'I will not let you down.' }] };
  },
};

// ---------- Draft (season end, one round, reverse standings) ----------

export const draft: EventTemplate = {
  id: 'draft',
  version: 1,
  type: 'draft',
  slot: 'seasonEnd',
  cooldownRounds: 0,
  weight: () => 1,
  build: ({ state, rng }) => {
    const order = computeStandings(state).map((r) => r.clubId).reverse();
    const userPick = order.indexOf(state.userClubId) + 1;
    const scouting = userClub(state).facilities.scouting;
    const next = absoluteRound(state.calendar.season + 1, 1);
    const pool = Array.from({ length: order.length + 3 }, (_, i) =>
      createPlayer(
        {
          id: nextId(state, 'p'),
          clubId: '',
          primary: i % 4 === 3 ? 'P' : rng.pick(['C', 'SS', 'CF', '2B', '3B', 'LF', 'RF', '1B'] as const),
          age: rng.int(18, 22),
          level: rng.int(42, 60),
          upside: rng.int(10, 28),
          role: 'prospect',
          salary: rng.int(10, 15) * 1000,
          seasonsLeft: 3,
          startRound: next,
          joinedSeason: state.calendar.season + 1,
          scoutingLevel: scouting,
        },
        rng,
      ),
    );
    // AI clubs ahead of the user pick the best-looking prospect (by their own read of the pool).
    const value = (p: Player) => p.potential + (p.isPitcher ? p.ratings.pitching : Math.max(p.ratings.contact, p.ratings.fielding)) + rng.int(-6, 6);
    const available = [...pool];
    const aiPicks: string[] = [];
    for (const clubId of order.slice(0, userPick - 1)) {
      available.sort((a, b) => value(b) - value(a));
      const taken = available.shift()!;
      aiPicks.push(`${taken.id}:${clubId}`);
    }
    const choices = available.slice(0, 3);
    const takenNames = aiPicks.map((x) => {
      const [pid, cid] = x.split(':');
      const p = pool.find((c) => c.id === pid)!;
      return `${state.clubs[cid].abbreviation}: ${p.firstName} ${p.lastName}`;
    });
    return {
      kicker: 'Draft',
      title: 'The Draft',
      context: `You pick #${userPick} of ${order.length} (reverse standings).${takenNames.length ? ` Already taken — ${takenNames.join(', ')}.` : ''} Draftees join for next season.`,
      prompt: 'Who is your pick?',
      subjects: { playerIds: [], clubIds: [] },
      data: { aiPicks: aiPicks.join(','), userPick },
      options: [
        ...choices.map((p, i) =>
          candidateOption(p, R.draftBonus, {
            summary: `${i === 0 ? 'Best available' : 'Prospect'} · ${describeCandidate(p)}`,
            certain: [neg(`Salary ${fmt(p.contract.salary)}/season from next season`), neutral('3-season contract')],
            primary: i === 0,
          }),
        ),
        passOption('Pass on the pick', 'Keep the roster spot and the bonus money.'),
      ],
      boosts: [],
      candidates: pool,
      rerollCost: null,
    };
  },
  optionBlocker: rosterBlocker,
  resolve: (ctx) => {
    const { state, event, option } = ctx;
    // AI picks happen regardless of the user's choice; players keep one identity each.
    for (const pair of String(event.data.aiPicks).split(',').filter(Boolean)) {
      const [pid, cid] = pair.split(':');
      const p = structuredClone(event.candidates.find((c) => c.id === pid)!);
      joinClub(state, p, cid);
    }
    if (option.id === 'pass') return { headline: 'You pass on your pick.', narrative: ['The bonus money stays in the bank.'] };
    const { p, narrative } = signCandidate(ctx, option.cost.cash);
    return { headline: `You draft ${playerName(p)}.`, narrative: [...narrative, 'He will report for next season.'], reactions: [{ playerId: p.id, text: 'A dream come true.' }] };
  },
};
