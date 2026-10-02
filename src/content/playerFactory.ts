import { withPitchingRatings } from '../domain/pitching';
import { hashSeed } from '../domain/rng';
import { generatePersonality, personalitySeed, PRIORITY_HINT } from '../domain/personality';
import { BALANCE } from '../balance/config';
import { clamp, type Rng } from '../domain/rng';
import type { LineupPosition, PersonalPriority, Player, SeasonStats, SquadRole } from '../domain/types';
import { FIRST_NAMES, LAST_NAMES } from './names';

export const emptyStats = (): SeasonStats => ({
  games: 0, starts: 0, pa: 0, ab: 0, h: 0, doubles: 0, triples: 0, hr: 0, rbi: 0, r: 0, bb: 0, so: 0, sb: 0,
  pitchingApps: 0, pitchingStarts: 0, outsPitched: 0, hitsAllowed: 0, runsAllowed: 0, walksAllowed: 0, strikeouts: 0,
});

/** What the club's scouts believe about a potential; accuracy depends on the Scouting Department level. */
export function scoutEstimate(potential: number, currentBest: number, scoutingLevel: number, rng: Rng) {
  const lvl = clamp(scoutingLevel, 1, 3) - 1;
  const err = BALANCE.recruitment.scoutError[lvl];
  const half = BALANCE.recruitment.scoutRangeHalfWidth[lvl];
  const centre = potential + rng.int(-err, err);
  const low = clamp(Math.max(currentBest, centre - half), 1, 99);
  return { low, high: clamp(Math.max(low + 2, centre + half), 1, 99) };
}

export const PRIORITIES: PersonalPriority[] = ['playingTime', 'titles', 'money', 'loyalty'];

/** Secondary positions that make sense for a primary position. */
const SECONDARY: Record<string, LineupPosition[]> = {
  C: ['C', '1B'],
  '1B': ['1B', '3B'],
  '2B': ['2B', 'SS'],
  '3B': ['3B', '1B'],
  SS: ['SS', '2B', '3B'],
  LF: ['LF', 'RF'],
  CF: ['CF', 'LF', 'RF'],
  RF: ['RF', 'LF'],
  DH: ['DH', '1B'],
};

export interface PlayerSpec {
  id: string;
  clubId: string;
  primary: LineupPosition | 'P';
  age: number;
  /** Rough level of the main ratings. */
  level: number;
  /** Extra potential above the best current rating. */
  upside: number;
  role: SquadRole;
  salary: number;
  seasonsLeft: number;
  startRound: number;
  joinedSeason: number;
  scoutingLevel: number;
  usedNames?: Set<string>;
  bio?: string;
}

export function createPlayer(spec: PlayerSpec, rng: Rng): Player {
  let first = '';
  let last = '';
  for (let i = 0; i < 50; i++) {
    first = rng.pick(FIRST_NAMES);
    last = rng.pick(LAST_NAMES);
    if (!spec.usedNames?.has(`${first} ${last}`)) break;
  }
  spec.usedNames?.add(`${first} ${last}`);
  const pitcher = spec.primary === 'P';
  const r = (base: number, spread = 8) => clamp(Math.round(base + rng.int(-spread, spread)), 15, 92);
  const pos = pitcher ? null : spec.primary;
  const contact = pitcher ? 10 : r(spec.level);
  const power = pitcher ? 10 : r(spec.level + (pos === 'DH' || pos === '1B' ? 6 : pos === 'SS' || pos === 'CF' ? -6 : 0));
  const speed = r(pos === 'CF' || pos === 'SS' ? spec.level + 8 : pitcher ? 40 : spec.level - 6);
  const fielding = r(pos === 'DH' ? spec.level - 14 : spec.level + 2);
  const pitching = pitcher ? r(spec.level, 5) : 10;
  // Starters last long; a drafted or signed pitcher without a starter role is a starter one time in three.
  const ratings = withPitchingRatings(spec.id, pitcher, { contact, power, speed, fielding, pitching }, spec.role === 'starter' || hashSeed(`sp:${spec.id}`) % 3 === 0);
  const best = pitcher ? pitching : Math.max(contact, fielding);
  const potential = clamp(best + spec.upside, best, 97);
  return {
    id: spec.id,
    firstName: first,
    lastName: last,
    number: rng.int(1, 79),
    age: spec.age,
    bats: rng.pick(['R', 'R', 'L', 'S'] as const),
    throws: rng.pick(['R', 'R', 'R', 'L'] as const),
    clubId: spec.clubId,
    isPitcher: pitcher,
    positions: pitcher ? [] : SECONDARY[spec.primary],
    ratings,
    progress: { contact: 0, power: 0, speed: 0, fielding: 0, pitching: 0, velocity: 0, control: 0, stamina: 0 },
    potential,
    potentialEstimate: scoutEstimate(potential, best, spec.scoutingLevel, rng),
    fitness: rng.int(92, 98),
    satisfaction: rng.int(58, 72),
    popularity: clamp(Math.round(15 + (spec.age - 18) * 1.5 + rng.int(-5, 10)), 5, 80),
    // The old priority draw is kept (same random sequence) as the personality's starting direction.
    personality: generatePersonality(personalitySeed(spec.id, `${first} ${last}`), PRIORITY_HINT[rng.pick(PRIORITIES)]),
    role: spec.role,
    contract: { salary: spec.salary, seasonsLeft: spec.seasonsLeft, startRound: spec.startRound },
    joinedSeason: spec.joinedSeason,
    bio: spec.bio ?? '',
    stats: emptyStats(),
    pastSeasons: [],
    moodLog: [],
    lastReaction: null,
    reactions: [],
  };
}

/** Rough market salary for a player of a given level and role. */
export function marketSalary(level: number, age: number): number {
  const base = Math.max(8, level - 30) * 1400;
  const ageFactor = age <= 22 ? 0.6 : age >= 33 ? 0.85 : 1;
  return Math.round((base * ageFactor) / 1000) * 1000;
}
