import { BALANCE } from '../balance/config';
import { AI_CLUBS, GENERATED_ROSTER_SHAPE, USER_CLUB, USER_ROSTER, type ClubSeed, type PlayerSeed } from '../content/clubs';
import { FIRST_NAMES, LAST_NAMES } from '../content/names';
import { emptyStats, PRIORITIES, scoutEstimate } from '../content/playerFactory';
import { autoLineup } from '../domain/lineup';
import { clamp, createRng, type Rng } from '../domain/rng';
import type { GameState } from '../domain/state';
import { SCHEMA_VERSION } from '../domain/state';
import type { Club, Player } from '../domain/types';
import { buildEvent, planRound } from '../events/planner';
import { generateSchedule } from '../simulation/schedule';

export interface NewGameOptions {
  seed: number;
  now: number;
  clubName?: string;
  clubCity?: string;
  primaryColor?: string;
  secondaryColor?: string;
  timeMode?: 'economy' | 'unlimited';
}

function playerFromSeed(seed: PlayerSeed, id: string, clubId: string, rng: Rng): Player {
  const ratings = { contact: seed.contact, power: seed.power, speed: seed.speed, fielding: seed.fielding, pitching: seed.pitching };
  const main = seed.pitcher ? seed.pitching : Math.max(seed.contact, seed.fielding);
  return {
    id,
    firstName: seed.firstName,
    lastName: seed.lastName,
    number: seed.number,
    age: seed.age,
    bats: seed.bats,
    throws: seed.throws,
    clubId,
    isPitcher: !!seed.pitcher,
    positions: seed.positions,
    ratings,
    progress: { contact: 0, power: 0, speed: 0, fielding: 0, pitching: 0 },
    potential: seed.potential,
    potentialEstimate: scoutEstimate(seed.potential, main, 1, rng),
    fatigue: seed.fatigue,
    satisfaction: seed.satisfaction,
    popularity: seed.popularity,
    priority: seed.priority,
    role: seed.role,
    contract: { salary: seed.salary, seasonsLeft: seed.seasonsLeft, startRound: 0 },
    joinedSeason: 1,
    bio: seed.bio,
    stats: emptyStats(),
    moodLog: [],
    lastReaction: null,
  };
}

function generatePlayer(shape: (typeof GENERATED_ROSTER_SHAPE)[number], club: ClubSeed, index: number, rng: Rng, usedNames: Set<string>): PlayerSeed {
  let first = '';
  let last = '';
  do {
    first = rng.pick(FIRST_NAMES);
    last = rng.pick(LAST_NAMES);
  } while (usedNames.has(`${first} ${last}`));
  usedNames.add(`${first} ${last}`);
  const age = rng.int(20, 34);
  const q = club.quality + (shape.role === 'starter' ? 0 : -8);
  const r = (base: number, spread = 10) => clamp(Math.round(base + q + rng.int(-spread, spread)), 20, 90);
  const pitcher = !!shape.pitcher;
  const contact = pitcher ? 10 : r(62);
  const power = pitcher ? 10 : r(shape.positions[0] === 'DH' || shape.positions[0] === '1B' ? 66 : 56);
  const speed = r(shape.positions[0] === 'CF' || shape.positions[0] === 'SS' ? 66 : 52);
  const fielding = r(shape.positions[0] === 'DH' ? 48 : 64);
  const pitching = pitcher ? r(index === 11 ? 70 : 63, 6) : 10;
  const best = pitcher ? pitching : Math.max(contact, fielding);
  const youth = age <= 23 ? rng.int(8, 20) : age <= 28 ? rng.int(2, 10) : rng.int(0, 3);
  return {
    firstName: first,
    lastName: last,
    number: index + 2 + rng.int(0, 5) * 10,
    age,
    bats: rng.pick(['R', 'R', 'L', 'S'] as const),
    throws: rng.pick(['R', 'R', 'R', 'L'] as const),
    positions: shape.positions,
    pitcher,
    contact,
    power,
    speed,
    fielding,
    pitching,
    potential: clamp(best + youth, best, 95),
    satisfaction: rng.int(55, 75),
    popularity: rng.int(20, 70),
    fatigue: rng.int(5, 30),
    priority: rng.pick(PRIORITIES),
    role: shape.role,
    salary: Math.round((pitcher ? pitching : (contact + power) / 2) * (shape.role === 'starter' ? 900 : 450) / 1000) * 1000,
    seasonsLeft: rng.int(1, 3),
    bio: '',
  };
}

function makeClub(seed: ClubSeed, isUser: boolean): Club {
  return {
    id: seed.id,
    city: seed.city,
    name: seed.name,
    abbreviation: seed.abbreviation,
    colors: { ...seed.colors },
    isUser,
    roster: [],
    lineup: { battingOrder: [], pitcherId: '' },
    cash: BALANCE.economy.startingCash,
    ownerConfidence: 74,
    fanSupport: 82,
    fanBase: seed.fanBase,
    brand: { local: 55, commercial: 40 },
    ticketPriceLevel: 3,
    sponsor: { ...seed.sponsor, kind: 'standard', bonus: null },
    facilities: { training: 1, scouting: 1, stadium: 1 },
    project: null,
    publicStance: null,
    reasons: { fanSupport: [], ownerConfidence: [] },
  };
}

export function createNewGame(opts: NewGameOptions): GameState {
  const rng = createRng(opts.seed);
  const userSeed: ClubSeed = {
    ...USER_CLUB,
    name: opts.clubName?.trim() || USER_CLUB.name,
    city: opts.clubCity?.trim() || USER_CLUB.city,
    colors: { primary: opts.primaryColor ?? USER_CLUB.colors.primary, secondary: opts.secondaryColor ?? USER_CLUB.colors.secondary },
  };
  const seeds = [userSeed, ...AI_CLUBS];

  const state: GameState = {
    schemaVersion: SCHEMA_VERSION,
    revision: 0,
    seed: opts.seed,
    rngState: 0,
    nextId: 1,
    userClubId: userSeed.id,
    clubs: {},
    clubOrder: seeds.map((s) => s.id),
    players: {},
    calendar: { season: 1, round: 1, slot: 0, phase: 'regular' },
    schedule: [],
    matches: {},
    time: { current: BALANCE.time.cap, lastRegenAt: opts.now, mode: opts.timeMode ?? 'economy' },
    influence: BALANCE.influence.start,
    currentEvent: null,
    nextEvent: null,
    queue: [],
    templateLastUsed: {},
    history: [],
    ledger: [],
  };

  const usedNames = new Set(USER_ROSTER.map((p) => `${p.firstName} ${p.lastName}`));
  let pid = 1;
  for (const seed of seeds) {
    const isUser = seed.id === userSeed.id;
    const club = makeClub(seed, isUser);
    state.clubs[club.id] = club;
    const roster = isUser ? USER_ROSTER : GENERATED_ROSTER_SHAPE.map((shape, i) => generatePlayer(shape, seed, i, rng, usedNames));
    for (const ps of roster) {
      const id = `p${pid++}`;
      state.players[id] = playerFromSeed(ps, id, club.id, rng);
      club.roster.push(id);
    }
    club.lineup = autoLineup(state, club.id);
  }
  state.schedule = generateSchedule(state.clubOrder, 1, rng);
  state.queue = planRound(state, rng, 1, 1);
  const first = state.queue.shift()!;
  state.currentEvent = buildEvent(state, first, rng, 1, 1, 0);
  state.rngState = rng.getState();
  return state;
}
