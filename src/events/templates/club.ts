import { BALANCE } from '../../balance/config';
import { clubPlayers, playerName, shortName, userClub } from '../../domain/state';
import type { FacilityId } from '../../domain/types';
import { absoluteRound } from '../../domain/state';
import { FACILITY_LABELS, seasonForecast, upkeepPerRound } from '../../simulation/economy';
import type { EventOption } from '../../domain/state';
import type { EventTemplate } from '../types';
import { cost, fmt, neg, neutral, passOption, pos } from './helpers';

// ---------- Board meetings ----------

export const boardCheckin: EventTemplate = {
  id: 'board_checkin',
  version: 1,
  type: 'boardMeeting',
  slot: 'management',
  cooldownRounds: 7,
  weight: (s) => (userClub(s).cash >= 0 ? 2 : 0),
  build: ({ state }) => {
    const c = userClub(state);
    const f = seasonForecast(state, c.id);
    const b = BALANCE.board;
    return {
      kicker: 'Board Meeting',
      title: 'Owners’ Check-in',
      context: `Owner confidence is ${c.ownerConfidence}. Projected cash at season end: ${fmt(f.projectedCash)}${f.projectedCash < 0 ? ' (negative)' : ''}.`,
      prompt: 'What do you bring to the table?',
      subjects: { playerIds: [], clubIds: [] },
      data: {},
      options: [
        {
          id: 'funds',
          label: 'Ask for investment funds',
          summary: `Requires confidence ${b.investmentMinConfidence}+.`,
          certain: [pos(`Club Cash +${fmt(b.investmentFunds)}`), neg('Owner confidence −6')],
          uncertain: [],
          cost: cost(),
        },
        {
          id: 'cuts',
          label: 'Present a cost-cutting plan',
          summary: 'Fewer perks around the ballpark.',
          certain: [pos('Owner confidence +4'), neg('Fan support −2')],
          uncertain: [],
          cost: cost(),
          primary: true,
        },
        { id: 'brief', label: 'Keep it brief', summary: 'Nothing new to report.', certain: [neg('Owner confidence −1')], uncertain: [], cost: cost() },
      ],
      boosts: [],
    };
  },
  optionBlocker: (s, _ev, id) =>
    id === 'funds' && userClub(s).ownerConfidence < BALANCE.board.investmentMinConfidence
      ? `The owners need confidence ${BALANCE.board.investmentMinConfidence}+ to invest (now ${userClub(s).ownerConfidence}).`
      : null,
  resolve: ({ state, sink, option }) => {
    const c = userClub(state);
    if (option.id === 'funds') {
      sink.cash(c.id, BALANCE.board.investmentFunds, 'event', 'Owner investment');
      sink.clubMood(c.id, 'ownerConfidence', -6, 'Asked the owners for more money');
      return { headline: 'The owners open their wallets.', narrative: ['They expect to see the money put to work.'] };
    }
    if (option.id === 'cuts') {
      sink.clubMood(c.id, 'ownerConfidence', 4, 'Presented a cost-cutting plan');
      sink.clubMood(c.id, 'fanSupport', -2, 'Cuts to matchday perks');
      return { headline: 'The board likes the discipline.', narrative: ['Fans notice the free programmes are gone.'] };
    }
    sink.clubMood(c.id, 'ownerConfidence', -1, 'A thin board update');
    return { headline: 'A short meeting.', narrative: ['The owners expected more.'] };
  },
};

/** Urgent recovery event when mandatory costs have pushed cash below zero. Always has feasible choices. */
export const boardEmergency: EventTemplate = {
  id: 'board_emergency',
  version: 1,
  type: 'boardMeeting',
  slot: 'management',
  cooldownRounds: 2,
  weight: () => 0,
  urgent: (s) => userClub(s).cash < 0,
  build: ({ state }) => {
    const c = userClub(state);
    const b = BALANCE.board;
    return {
      kicker: 'Board Meeting',
      title: 'Cash Crisis',
      context: `Club Cash is ${fmt(c.cash)} below zero. New voluntary spending is blocked until it is positive again.`,
      prompt: 'How do we fix the books?',
      subjects: { playerIds: [], clubIds: [] },
      data: {},
      options: [
        { id: 'injection', label: 'Owner cash injection', summary: 'They will remember this.', certain: [pos(`Club Cash +${fmt(b.emergencyInjection)}`), neg('Owner confidence −10')], uncertain: [], cost: cost(), primary: true },
        {
          id: 'ads',
          label: 'Sell stadium advertising',
          summary: 'Quick money, louder billboards.',
          certain: [pos(`Club Cash +${fmt(b.emergencyAdDeal)}`), neg('Fan support −3'), pos('Commercial reach +3'), neg('Local roots −2')],
          uncertain: [],
          cost: cost(),
        },
      ],
      boosts: [],
    };
  },
  resolve: ({ state, sink, option }) => {
    const c = userClub(state);
    const b = BALANCE.board;
    if (option.id === 'injection') {
      sink.cash(c.id, b.emergencyInjection, 'event', 'Emergency owner injection');
      sink.clubMood(c.id, 'ownerConfidence', -10, 'Needed an emergency cash injection');
      return { headline: 'The owners bail you out.', narrative: [c.cash < 0 ? 'Cash is still negative; expect another meeting.' : 'The books are back in the black.'] };
    }
    sink.cash(c.id, b.emergencyAdDeal, 'event', 'Stadium advertising deal');
    sink.clubMood(c.id, 'fanSupport', -3, 'Ballpark covered in adverts');
    sink.brand(c.id, 'commercial', 3);
    sink.brand(c.id, 'local', -2);
    return { headline: 'Billboards go up.', narrative: [c.cash < 0 ? 'Cash is still negative; expect another meeting.' : 'The books are back in the black.'] };
  },
};

// ---------- Facilities ----------

const FACILITIES: FacilityId[] = ['training', 'scouting', 'stadium'];
const FACILITY_GAIN: Record<FacilityId, string> = {
  training: 'Training progress +20%',
  scouting: 'Narrower potential estimates',
  stadium: 'Capacity and gate income up',
};

export const facilityExpansion: EventTemplate = {
  id: 'facility_expansion',
  version: 1,
  type: 'facility',
  slot: 'management',
  cooldownRounds: 6,
  weight: (s) => {
    const c = userClub(s);
    return !c.project && FACILITIES.some((f) => c.facilities[f] < 3) && s.calendar.round <= BALANCE.season.rounds - 3 ? 1.5 : 0;
  },
  build: ({ state }) => {
    const c = userClub(state);
    const cfg = BALANCE.facilities;
    const f = seasonForecast(state, c.id);
    const options: EventOption[] = FACILITIES.filter((id) => c.facilities[id] < 3).map((id) => {
      const lvl = c.facilities[id];
      const price = cfg.cost[id][lvl - 1];
      const done = state.calendar.round + cfg.buildRounds[id];
      const upkeepAfter = upkeepPerRound({ ...c, facilities: { ...c.facilities, [id]: lvl + 1 } }) - upkeepPerRound(c);
      return {
        id: `build:${id}`,
        label: `${FACILITY_LABELS[id]} → level ${lvl + 1}`,
        summary: FACILITY_GAIN[id],
        certain: [neutral(`Ready after round ${done}`), neg(`Running cost +${fmt(upkeepAfter)}/round`)],
        uncertain: [],
        cost: cost(price),
      };
    });
    return {
      kicker: 'Facility Expansion',
      title: 'Facility Proposal',
      context: `The architects are ready. One project at a time; owners must back it (confidence ${cfg.minOwnerConfidence}+). Projected cash at season end: ${fmt(f.projectedCash)}.`,
      prompt: 'Where do we invest?',
      subjects: { playerIds: [], clubIds: [] },
      data: {},
      options: [...options, passOption('Not now', 'Keep the cash.')],
      boosts: [],
    };
  },
  optionBlocker: (s, _ev, id) => {
    if (!id.startsWith('build:')) return null;
    const c = userClub(s);
    if (c.project) return 'Another project is already under way.';
    if (c.ownerConfidence < BALANCE.facilities.minOwnerConfidence) return `The owners will not approve a project (confidence ${c.ownerConfidence}).`;
    return null;
  },
  resolve: ({ state, option }) => {
    if (option.id === 'pass') return { headline: 'Plans go back in the drawer.', narrative: [] };
    const c = userClub(state);
    const id = option.id.split(':')[1] as FacilityId;
    const rounds = BALANCE.facilities.buildRounds[id];
    const { season, round } = state.calendar;
    c.project = { facility: id, toLevel: c.facilities[id] + 1, startedRound: absoluteRound(season, round), completesRound: absoluteRound(season, round + rounds), cost: option.cost.cash };
    return {
      headline: `Construction starts on the ${FACILITY_LABELS[id]}.`,
      narrative: [`It will be ready after the round ${round + rounds} game. Running costs rise once it opens.`],
    };
  },
};

// ---------- Sponsors ----------

export const sponsorOffer: EventTemplate = {
  id: 'sponsor_offer',
  version: 1,
  type: 'sponsor',
  slot: 'management',
  cooldownRounds: 20,
  weight: (s) => (s.calendar.round >= 5 && s.calendar.round <= 16 && userClub(s).sponsor?.kind === 'standard' ? 3 : 0),
  build: ({ state }) => {
    const c = userClub(state);
    const commercial = Math.round((300_000 + c.brand.commercial * 1_500) / 10_000) * 10_000;
    const local = Math.round((260_000 + c.brand.local * 800) / 10_000) * 10_000;
    return {
      kicker: 'Sponsor Deal Offering',
      title: 'New Sponsor on the Line',
      context: `Your current deal with ${c.sponsor?.name ?? 'nobody'} pays ${fmt(c.sponsor?.perSeason ?? 0)} per season. Two companies want the shirt.`,
      prompt: 'Which deal do you take?',
      subjects: { playerIds: [], clubIds: [] },
      data: { commercial, local },
      options: [
        {
          id: 'commercial',
          label: `LuckyLine Betting · ${fmt(commercial)}/season`,
          summary: 'Big money, 2 seasons. Not everyone will like it.',
          certain: [pos('Commercial reach +5'), neg('Fan support −3'), neg('Local roots −3')],
          uncertain: [],
          cost: cost(),
        },
        {
          id: 'local',
          label: `Harbor Brewing Co. · ${fmt(local)}/season`,
          summary: 'Hometown partner, 2 seasons, +$30,000 if you finish top 3.',
          certain: [pos('Local roots +4'), pos('Fan support +2')],
          uncertain: [neutral('Bonus $30,000 for a top-3 finish (paid once)')],
          cost: cost(),
          primary: true,
        },
        passOption('Keep the current sponsor', 'Loyalty to an existing partner.'),
      ],
      boosts: [],
    };
  },
  resolve: ({ state, sink, option, event }) => {
    const c = userClub(state);
    if (option.id === 'pass') return { headline: 'The current deal stays.', narrative: [] };
    const before = c.sponsor?.perSeason ?? 0;
    if (option.id === 'commercial') {
      c.sponsor = { name: 'LuckyLine Betting', kind: 'commercial', perSeason: Number(event.data.commercial), seasonsLeft: 2, bonus: null };
      sink.brand(c.id, 'commercial', 5);
      sink.brand(c.id, 'local', -3);
      sink.clubMood(c.id, 'fanSupport', -3, 'Signed a betting sponsor');
    } else {
      c.sponsor = { name: 'Harbor Brewing Co.', kind: 'local', perSeason: Number(event.data.local), seasonsLeft: 2, bonus: { condition: 'top3', amount: 30_000, paid: false } };
      sink.brand(c.id, 'local', 4);
      sink.clubMood(c.id, 'fanSupport', 2, 'Signed a hometown sponsor');
    }
    sink.record({ targetKind: 'club', targetId: c.id, targetLabel: c.sponsor.name, stat: 'sponsor', statLabel: 'Sponsor $/season', before, after: c.sponsor.perSeason, format: 'cash' });
    return { headline: `${c.sponsor.name} is the new shirt sponsor.`, narrative: ['Payments at the new rate start with the next league game.'] };
  },
};

// ---------- Media ----------

export const mediaExpectations: EventTemplate = {
  id: 'media_expectations',
  version: 1,
  type: 'media',
  slot: 'management',
  cooldownRounds: 8,
  weight: (s) => (s.calendar.round >= 2 ? 2 : 0),
  build: ({ state }) => {
    const c = userClub(state);
    const prev = c.publicStance;
    return {
      kicker: 'Media Coverage',
      title: 'What’s the Target?',
      context: `The Harbor Herald wants a headline about this season.${prev ? ` Last time you said: "${prev.stance === 'contend' ? 'we are going for it' : 'be patient'}" (round ${prev.round}).` : ''}`,
      prompt: 'What do you tell them?',
      subjects: { playerIds: [], clubIds: [] },
      data: {},
      options: [
        { id: 'contend', label: '"We’re going for the title"', summary: 'Raise the stakes.', certain: [pos('Fan support +4'), pos('Owner confidence +2')], uncertain: [neutral('Results will be judged against this')], cost: cost() },
        { id: 'patience', label: '"We’re building something"', summary: 'Ask for patience.', certain: [neg('Fan support −2'), pos('Local roots +2'), neg('Owner confidence −1')], uncertain: [neutral('Fans may accept losses better')], cost: cost(), primary: true },
        { id: 'deflect', label: 'Deflect', summary: '"One game at a time."', certain: [neg('Fan support −1')], uncertain: [], cost: cost() },
      ],
      boosts: [],
    };
  },
  resolve: ({ state, sink, option, event }) => {
    const c = userClub(state);
    const stamp = { season: state.calendar.season, round: state.calendar.round, eventId: event.id };
    if (option.id === 'contend') {
      sink.clubMood(c.id, 'fanSupport', 4, 'Promised a title push in the press');
      sink.clubMood(c.id, 'ownerConfidence', 2, 'Ambitious public message');
      c.publicStance = { stance: 'contend', ...stamp };
      return { headline: '"Title or bust," says the Herald.', narrative: ['The words are on record.'] };
    }
    if (option.id === 'patience') {
      sink.clubMood(c.id, 'fanSupport', -2, 'Asked for patience in the press');
      sink.brand(c.id, 'local', 2);
      sink.clubMood(c.id, 'ownerConfidence', -1, 'Lowered public expectations');
      c.publicStance = { stance: 'patience', ...stamp };
      return { headline: '"A project, not a quick fix."', narrative: ['The words are on record.'] };
    }
    sink.clubMood(c.id, 'fanSupport', -1, 'Dodged questions from the press');
    return { headline: 'A non-answer.', narrative: ['The Herald runs a small piece.'] };
  },
};

export const mediaSpotlight: EventTemplate = {
  id: 'media_spotlight',
  version: 1,
  type: 'media',
  slot: 'management',
  cooldownRounds: 8,
  weight: () => 1.5,
  build: ({ state }) => {
    const players = clubPlayers(state, state.userClubId);
    const star = [...players].sort((a, b) => b.popularity - a.popularity || a.id.localeCompare(b.id))[0];
    const young = [...players].filter((p) => p.id !== star.id).sort((a, b) => b.potentialEstimate.high - a.potentialEstimate.high || a.id.localeCompare(b.id))[0];
    return {
      kicker: 'Media Coverage',
      title: 'Magazine Feature',
      context: `Coast Sports Monthly wants a cover story. The obvious pick is ${playerName(star)}; the scouts' favourite is ${playerName(young)}.`,
      prompt: 'Who gets the cover?',
      subjects: { playerIds: [star.id, young.id], clubIds: [] },
      data: { starId: star.id, youngId: young.id },
      options: [
        { id: 'star', label: `Feature ${star.lastName}`, summary: 'Proven box-office.', certain: [pos(`${star.lastName} popularity +4`), pos('Commercial reach +3')], uncertain: [], cost: cost() },
        {
          id: 'young',
          label: `Feature ${young.lastName}`,
          summary: 'Build the next face of the club.',
          certain: [pos(`${young.lastName} popularity +6, satisfaction +3`), neg(`${star.lastName} satisfaction −2`)],
          uncertain: [],
          cost: cost(),
          primary: true,
        },
        passOption('Decline the feature', 'Keep the focus inside the clubhouse.'),
      ],
      boosts: [],
    };
  },
  resolve: ({ state, sink, option, event }) => {
    const star = state.players[String(event.data.starId)];
    const young = state.players[String(event.data.youngId)];
    const c = userClub(state);
    if (option.id === 'star') {
      sink.playerMood(star.id, 'popularity', 4, 'Magazine cover');
      sink.brand(c.id, 'commercial', 3);
      return { headline: `${shortName(star)} on the cover.`, narrative: ['It sells well.'] };
    }
    if (option.id === 'young') {
      sink.playerMood(young.id, 'popularity', 6, 'Magazine cover');
      sink.playerMood(young.id, 'satisfaction', 3, 'Chosen for the magazine cover');
      sink.playerMood(star.id, 'satisfaction', -2, `Passed over for the cover in favour of ${young.lastName}`);
      return {
        headline: `${shortName(young)}: "the next big thing".`,
        narrative: [`${star.lastName} shrugs it off in public.`],
        reactions: [{ playerId: young.id, text: 'Still can’t believe it’s me on there.' }],
      };
    }
    return { headline: 'No feature this month.', narrative: [] };
  },
};
