import type { LineupPosition, PersonalPriority, SquadRole } from '../domain/types';

export interface ClubSeed {
  id: string;
  city: string;
  name: string;
  abbreviation: string;
  colors: { primary: string; secondary: string };
  /** Rough quality offset for generated rosters. */
  quality: number;
  fanBase: number;
  sponsor: { name: string; perSeason: number; seasonsLeft: number };
}

export const USER_CLUB: ClubSeed = {
  id: 'hfx',
  city: 'Harbor',
  name: 'Foxes',
  abbreviation: 'HFX',
  colors: { primary: '#0f2a5c', secondary: '#f26b1d' },
  quality: 0,
  fanBase: 8000,
  sponsor: { name: 'Portside Credit Union', perSeason: 300_000, seasonsLeft: 2 },
};

export const AI_CLUBS: ClubSeed[] = [
  { id: 'rvb', city: 'Riverdale', name: 'Bears', abbreviation: 'RVB', colors: { primary: '#7a1f2b', secondary: '#c9b27c' }, quality: 3, fanBase: 9000, sponsor: { name: 'Riverdale Lumber', perSeason: 320_000, seasonsLeft: 2 } },
  { id: 'smh', city: 'Summit', name: 'Hawks', abbreviation: 'SMH', colors: { primary: '#1d5c3a', secondary: '#e8c547' }, quality: 1, fanBase: 7500, sponsor: { name: 'Summit Outdoor', perSeason: 280_000, seasonsLeft: 2 } },
  { id: 'ibp', city: 'Iron Bay', name: 'Pilots', abbreviation: 'IBP', colors: { primary: '#23313f', secondary: '#9fb4c7' }, quality: -1, fanBase: 7000, sponsor: { name: 'Iron Bay Shipping', perSeason: 260_000, seasonsLeft: 2 } },
  { id: 'gvc', city: 'Glenview', name: 'Comets', abbreviation: 'GVC', colors: { primary: '#4b2a7a', secondary: '#f0a3c0' }, quality: -2, fanBase: 6500, sponsor: { name: 'Glenview Energy', perSeason: 250_000, seasonsLeft: 2 } },
  { id: 'cpk', city: 'Cedar Point', name: 'Kings', abbreviation: 'CPK', colors: { primary: '#8a5a12', secondary: '#1b1b1b' }, quality: 2, fanBase: 8500, sponsor: { name: 'Cedar Point Motors', perSeason: 300_000, seasonsLeft: 2 } },
];

export interface PlayerSeed {
  firstName: string;
  lastName: string;
  number: number;
  age: number;
  bats: 'R' | 'L' | 'S';
  throws: 'R' | 'L';
  positions: LineupPosition[];
  pitcher?: boolean;
  contact: number;
  power: number;
  speed: number;
  fielding: number;
  pitching: number;
  /** Pitchers: how long he lasts (SP from 55). Generated when absent. */
  stamina?: number;
  potential: number;
  satisfaction: number;
  popularity: number;
  /** Match readiness in percent. */
  fitness: number;
  /** Starting direction for the generated personality (the old single priority). */
  priority: PersonalPriority;
  role: SquadRole;
  salary: number;
  seasonsLeft: number;
  bio: string;
}

/**
 * Hand-authored starting club: a couple of prospects, a popular veteran and a
 * payroll that leaves room for choices without an immediate crisis.
 */
export const USER_ROSTER: PlayerSeed[] = [
  { firstName: 'Jake', lastName: 'Miller', number: 14, age: 21, bats: 'R', throws: 'R', positions: ['CF', 'LF', 'RF'], contact: 72, power: 58, speed: 81, fielding: 76, pitching: 10, potential: 88, satisfaction: 76, popularity: 55, fitness: 89, priority: 'playingTime', role: 'starter', salary: 48_000, seasonsLeft: 2, bio: 'A promising all-round outfielder.' },
  { firstName: 'Leo', lastName: 'Martinez', number: 7, age: 19, bats: 'L', throws: 'R', positions: ['SS', '2B', '3B'], contact: 58, power: 44, speed: 74, fielding: 66, pitching: 10, potential: 86, satisfaction: 58, popularity: 30, fitness: 95, priority: 'playingTime', role: 'prospect', salary: 14_000, seasonsLeft: 3, bio: 'Raw, quick and hungry for a bigger role.' },
  { firstName: 'Sam', lastName: 'Brooks', number: 33, age: 34, bats: 'L', throws: 'L', positions: ['DH', '1B'], contact: 68, power: 78, speed: 34, fielding: 50, pitching: 10, potential: 78, satisfaction: 70, popularity: 88, fitness: 88, priority: 'loyalty', role: 'starter', salary: 92_000, seasonsLeft: 1, bio: 'Fan favourite slugger in the final year of his deal.' },
  { firstName: 'Alex', lastName: 'Ortega', number: 4, age: 27, bats: 'R', throws: 'R', positions: ['2B', 'SS'], contact: 70, power: 52, speed: 66, fielding: 72, pitching: 10, potential: 74, satisfaction: 68, popularity: 60, fitness: 90, priority: 'titles', role: 'starter', salary: 58_000, seasonsLeft: 2, bio: 'Steady middle infielder with a winning mindset.' },
  { firstName: 'Ryan', lastName: 'Walker', number: 22, age: 29, bats: 'L', throws: 'L', positions: ['RF', 'LF'], contact: 64, power: 66, speed: 55, fielding: 62, pitching: 10, potential: 67, satisfaction: 62, popularity: 52, fitness: 86, priority: 'money', role: 'starter', salary: 55_000, seasonsLeft: 1, bio: 'Reliable corner outfielder who knows his worth.' },
  { firstName: 'Marcus', lastName: 'Chen', number: 18, age: 26, bats: 'R', throws: 'R', positions: ['1B', '3B'], contact: 66, power: 62, speed: 42, fielding: 64, pitching: 10, potential: 72, satisfaction: 66, popularity: 48, fitness: 91, priority: 'titles', role: 'starter', salary: 46_000, seasonsLeft: 2, bio: 'Quiet, consistent corner infielder.' },
  { firstName: 'Ben', lastName: 'Hartley', number: 12, age: 31, bats: 'R', throws: 'R', positions: ['3B', '1B'], contact: 60, power: 60, speed: 40, fielding: 70, pitching: 10, potential: 62, satisfaction: 64, popularity: 58, fitness: 88, priority: 'loyalty', role: 'starter', salary: 44_000, seasonsLeft: 1, bio: 'Glove-first third baseman and clubhouse voice.' },
  { firstName: 'Kenji', lastName: 'Sato', number: 6, age: 24, bats: 'S', throws: 'R', positions: ['SS', '2B'], contact: 62, power: 40, speed: 70, fielding: 74, pitching: 10, potential: 75, satisfaction: 65, popularity: 42, fitness: 90, priority: 'playingTime', role: 'starter', salary: 36_000, seasonsLeft: 2, bio: 'Slick defender still growing at the plate.' },
  { firstName: 'Dwayne', lastName: 'Price', number: 25, age: 28, bats: 'R', throws: 'R', positions: ['LF', 'RF'], contact: 60, power: 58, speed: 60, fielding: 58, pitching: 10, potential: 63, satisfaction: 60, popularity: 44, fitness: 89, priority: 'money', role: 'starter', salary: 34_000, seasonsLeft: 1, bio: 'Streaky left fielder with pop.' },
  { firstName: 'Diego', lastName: 'Ramos', number: 9, age: 30, bats: 'R', throws: 'R', positions: ['C'], contact: 55, power: 54, speed: 30, fielding: 72, pitching: 10, potential: 58, satisfaction: 66, popularity: 50, fitness: 87, priority: 'loyalty', role: 'starter', salary: 42_000, seasonsLeft: 2, bio: 'Veteran catcher who handles the staff.' },
  { firstName: 'Tom', lastName: 'Kowalski', number: 29, age: 25, bats: 'R', throws: 'R', positions: ['C', '1B'], contact: 50, power: 48, speed: 32, fielding: 62, pitching: 10, potential: 64, satisfaction: 60, popularity: 25, fitness: 96, priority: 'playingTime', role: 'reserve', salary: 18_000, seasonsLeft: 2, bio: 'Backup catcher waiting for his chance.' },
  { firstName: 'Cole', lastName: 'Bennett', number: 31, age: 29, bats: 'R', throws: 'R', positions: [], pitcher: true, contact: 10, power: 10, speed: 40, fielding: 55, pitching: 74, stamina: 78, potential: 76, satisfaction: 70, popularity: 64, fitness: 92, priority: 'titles', role: 'starter', salary: 78_000, seasonsLeft: 2, bio: 'The ace. Wants to pitch in big games.' },
  { firstName: 'Mateo', lastName: 'Silva', number: 45, age: 27, bats: 'L', throws: 'L', positions: [], pitcher: true, contact: 10, power: 10, speed: 40, fielding: 52, pitching: 66, stamina: 72, potential: 70, satisfaction: 64, popularity: 40, fitness: 93, priority: 'money', role: 'starter', salary: 46_000, seasonsLeft: 2, bio: 'Crafty lefty with good command.' },
  { firstName: 'Owen', lastName: 'Park', number: 51, age: 20, bats: 'R', throws: 'R', positions: [], pitcher: true, contact: 10, power: 10, speed: 45, fielding: 50, pitching: 56, stamina: 44, potential: 84, satisfaction: 62, popularity: 22, fitness: 97, priority: 'playingTime', role: 'prospect', salary: 12_000, seasonsLeft: 3, bio: 'Big arm, raw command. Could be special.' },
  { firstName: 'Gus', lastName: 'Whitaker', number: 38, age: 36, bats: 'R', throws: 'R', positions: [], pitcher: true, contact: 10, power: 10, speed: 30, fielding: 48, pitching: 62, stamina: 66, potential: 62, satisfaction: 66, popularity: 70, fitness: 90, priority: 'loyalty', role: 'reserve', salary: 30_000, seasonsLeft: 1, bio: 'Veteran arm and local legend.' },
  { firstName: 'Ray', lastName: 'Okafor', number: 47, age: 31, bats: 'R', throws: 'R', positions: [], pitcher: true, contact: 10, power: 10, speed: 38, fielding: 50, pitching: 64, stamina: 36, potential: 65, satisfaction: 68, popularity: 35, fitness: 94, priority: 'titles', role: 'reserve', salary: 26_000, seasonsLeft: 2, bio: 'Late-inning arm who wants the ball in big spots.' },
  { firstName: 'Marcus', lastName: 'Lee', number: 27, age: 28, bats: 'R', throws: 'R', positions: [], pitcher: true, contact: 10, power: 10, speed: 40, fielding: 53, pitching: 61, stamina: 63, potential: 64, satisfaction: 67, popularity: 30, fitness: 95, priority: 'loyalty', role: 'reserve', salary: 24_000, seasonsLeft: 2, bio: 'Dependable swingman: starts or relieves.' },
  { firstName: 'Danny', lastName: 'Cho', number: 29, age: 25, bats: 'L', throws: 'L', positions: [], pitcher: true, contact: 10, power: 10, speed: 42, fielding: 51, pitching: 58, stamina: 52, potential: 68, satisfaction: 66, popularity: 24, fitness: 96, priority: 'playingTime', role: 'reserve', salary: 15_000, seasonsLeft: 2, bio: 'Lefty swingman who can pitch long.' },
  { firstName: 'Eli', lastName: 'Ramirez', number: 39, age: 26, bats: 'R', throws: 'R', positions: [], pitcher: true, contact: 10, power: 10, speed: 40, fielding: 50, pitching: 59, stamina: 34, potential: 66, satisfaction: 66, popularity: 26, fitness: 95, priority: 'playingTime', role: 'reserve', salary: 16_000, seasonsLeft: 2, bio: 'Hard-throwing setup arm.' },
  { firstName: 'Nathan', lastName: 'Cole', number: 17, age: 30, bats: 'L', throws: 'L', positions: [], pitcher: true, contact: 10, power: 10, speed: 38, fielding: 52, pitching: 57, stamina: 40, potential: 60, satisfaction: 64, popularity: 30, fitness: 93, priority: 'money', role: 'reserve', salary: 18_000, seasonsLeft: 1, bio: 'Left-handed specialist, calm under pressure.' },
  { firstName: 'Tyler', lastName: 'Keller', number: 54, age: 23, bats: 'R', throws: 'R', positions: [], pitcher: true, contact: 10, power: 10, speed: 44, fielding: 48, pitching: 52, stamina: 30, potential: 72, satisfaction: 62, popularity: 15, fitness: 97, priority: 'playingTime', role: 'prospect', salary: 10_000, seasonsLeft: 3, bio: 'Young reliever with a lively fastball.' },
];

/** Position template for generated 21-man rosters: 11 hitters + 10 pitchers (four starters, six relievers). */
export const GENERATED_ROSTER_SHAPE: { positions: LineupPosition[]; pitcher?: boolean; role: SquadRole }[] = [
  { positions: ['C'], role: 'starter' },
  { positions: ['C', '1B'], role: 'reserve' },
  { positions: ['1B', '3B'], role: 'starter' },
  { positions: ['2B', 'SS'], role: 'starter' },
  { positions: ['3B', '1B'], role: 'starter' },
  { positions: ['SS', '2B'], role: 'starter' },
  { positions: ['LF', 'RF'], role: 'starter' },
  { positions: ['CF', 'LF', 'RF'], role: 'starter' },
  { positions: ['RF', 'LF'], role: 'starter' },
  { positions: ['DH', '1B'], role: 'starter' },
  { positions: ['2B', '3B', 'SS'], role: 'reserve' },
  { positions: [], pitcher: true, role: 'starter' },
  { positions: [], pitcher: true, role: 'starter' },
  { positions: [], pitcher: true, role: 'starter' },
  { positions: [], pitcher: true, role: 'starter' },
  { positions: [], pitcher: true, role: 'reserve' },
  { positions: [], pitcher: true, role: 'reserve' },
  { positions: [], pitcher: true, role: 'reserve' },
  { positions: [], pitcher: true, role: 'reserve' },
  { positions: [], pitcher: true, role: 'reserve' },
  { positions: [], pitcher: true, role: 'reserve' },
];
