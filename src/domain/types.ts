import type { SeasonPlan } from './state';
import type { Personality } from './personality';
import type { PitchingStaff } from './staff';

export type PlayerId = string;
export type ClubId = string;
export type EventInstanceId = string;
export type GameId = string;

export const DEFENSIVE_POSITIONS = ['C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF'] as const;
export type DefensivePosition = (typeof DEFENSIVE_POSITIONS)[number];
export type LineupPosition = DefensivePosition | 'DH';
export const LINEUP_POSITIONS: LineupPosition[] = [...DEFENSIVE_POSITIONS, 'DH'];

/** Hitters: contact, power, speed, fielding. Pitchers: velocity, control, stamina, fielding; pitching = (velocity + control) / 2, kept in sync. */
export type RatingKey = 'contact' | 'power' | 'speed' | 'fielding' | 'pitching' | 'velocity' | 'control' | 'stamina';
export type Ratings = Record<RatingKey, number>;

/** Legacy single-trait field (replaced by `personality`; only read by the v10 migration). */
export type PersonalPriority = 'playingTime' | 'titles' | 'money' | 'loyalty';
export type SquadRole = 'starter' | 'reserve' | 'prospect';

export interface Contract {
  /** Salary per season, whole dollars. Paid 1/20 per round. */
  salary: number;
  seasonsLeft: number;
  /** Absolute round from which the salary is paid (players who join are paid from the next round). */
  startRound: number;
}

export interface SeasonStats {
  games: number;
  starts: number;
  pa: number;
  ab: number;
  h: number;
  doubles: number;
  triples: number;
  hr: number;
  rbi: number;
  r: number;
  bb: number;
  so: number;
  sb: number;
  pitchingApps: number;
  pitchingStarts: number;
  outsPitched: number;
  hitsAllowed: number;
  runsAllowed: number;
  walksAllowed: number;
  strikeouts: number;
}

export interface ReasonEntry {
  season: number;
  round: number;
  delta: number;
  text: string;
}

export interface Player {
  id: PlayerId;
  firstName: string;
  lastName: string;
  number: number;
  age: number;
  bats: 'R' | 'L' | 'S';
  throws: 'R' | 'L';
  clubId: ClubId;
  isPitcher: boolean;
  /** Eligible lineup positions, primary first. Empty for pitchers. */
  positions: LineupPosition[];
  ratings: Ratings;
  /** Progress 0–99 toward the next point per rating, so small gains are never hidden by rounding. */
  progress: Ratings;
  /** True development ceiling (hidden). */
  potential: number;
  /** What the club's scouts believe, shown to the player. */
  potentialEstimate: { low: number; high: number };
  /** Match readiness in percent: 100 = fully ready, lower = rating penalty. */
  fitness: number;
  satisfaction: number;
  popularity: number;
  /** Seven stable tendencies; mechanics read these, the profile name is derived for display. */
  personality: Personality;
  role: SquadRole;
  contract: Contract;
  joinedSeason: number;
  bio: string;
  stats: SeasonStats;
  /** Archived seasons (most recent first, capped). */
  pastSeasons: { season: number; clubId: ClubId; stats: SeasonStats }[];
  moodLog: ReasonEntry[];
  lastReaction: { text: string; context: string; season: number; round: number } | null;
  /** Personality reactions with their cause and the personality's share (newest first, capped). */
  reactions: ReactionEntry[];
  /** Day number (absDay) of his last appearance as a pitcher, for rest days. */
  pitchedOn?: number;
}

/**
 * One reaction to a coded situation: what happened (cause), the base outcome,
 * what the personality added, and the result. `id` is the stable situation id,
 * so the same situation is never applied twice.
 */
export interface ReactionEntry {
  id: string;
  cause: string;
  base: number;
  personal: number;
  delta: number;
  text: string;
  season: number;
  round: number;
}

export interface LineupSlot {
  playerId: PlayerId;
  position: LineupPosition;
}

export interface Lineup {
  /** Nine batters in batting order, each with a unique position (8 defensive + DH). */
  battingOrder: LineupSlot[];
  pitcherId: PlayerId;
}

/** When the starter is replaced: thresholds per setting live in BALANCE.match.hooks. */
export type PitchingHook = 'early' | 'balanced' | 'long';

/**
 * Today's pitching plan, followed by the simulator: the designated reliever (or
 * automatic choice when null), pitchers who must not be used, and how long the
 * starter stays in. Reliever and rest apply to the next game only.
 */
export interface PitchingPlan {
  relieverId: PlayerId | null;
  rest: PlayerId[];
  hook: PitchingHook;
}

export interface SponsorDeal {
  name: string;
  kind: 'standard' | 'commercial' | 'local';
  perSeason: number;
  seasonsLeft: number;
  /** One-off bonus, paid at most once. */
  bonus: { condition: 'top3'; amount: number; paid: boolean } | null;
}

export type FacilityId = 'training' | 'scouting' | 'stadium';

/**
 * Temporary facility happening (from an event), kept apart from permanent
 * levels. Counts down one per league game of the club and is removed at 0.
 */
export interface FacilityModifier {
  id: string;
  facility: FacilityId;
  /** upgradeDiscount: share off the next upgrade · trainingBoost: training progress ± share · capacityCut: share of seats unavailable. */
  kind: 'upgradeDiscount' | 'trainingBoost' | 'capacityCut';
  value: number;
  label: string;
  /** Event that created it. */
  source: string;
  matchesLeft: number;
}

/** Legacy construction project (older saves); new upgrades are immediate. */
export interface FacilityProject {
  facility: FacilityId;
  toLevel: number;
  startedRound: number;
  /** Absolute round whose league game completes the project. */
  completesRound: number;
  cost: number;
}

export type TacticArea = 'batting' | 'baserunning' | 'pitching';
export type BattingStyle = 'contact' | 'balanced' | 'power';
export type RunningStyle = 'cautious' | 'balanced' | 'aggressive';
export type PitchingStyle = 'attack' | 'balanced' | 'careful';
export interface TeamStyle {
  batting: BattingStyle;
  baserunning: RunningStyle;
  pitching: PitchingStyle;
}
/** A player's exceptions per area; 'team' = explicitly follow the team (used for one-match overrides). */
export type Instruction = { [A in TacticArea]?: TeamStyle[A] | 'team' };
export interface ClubTactics {
  /** Saved playing style, applies until changed. */
  style: TeamStyle;
  /** Next match only; cleared after the game. */
  match: Partial<TeamStyle>;
  /** Saved per-player exceptions. */
  instructions: Record<PlayerId, Instruction>;
  /** Per-player exceptions for the next match only. */
  matchInstructions: Record<PlayerId, Instruction>;
}

export interface Club {
  id: ClubId;
  city: string;
  name: string;
  abbreviation: string;
  colors: { primary: string; secondary: string };
  isUser: boolean;
  roster: PlayerId[];
  lineup: Lineup;
  pitchingPlan: PitchingPlan;
  /** Standing pitching staff: rotation order and bullpen roles (absent until first normalised). */
  staff?: PitchingStaff;
  cash: number;
  ownerConfidence: number;
  fanSupport: number;
  /** Size of the potential crowd — separate from how satisfied the fans are. */
  fanBase: number;
  brand: { local: number; commercial: number };
  ticketPriceLevel: number;
  sponsor: SponsorDeal | null;
  facilities: Record<FacilityId, number>;
  project: FacilityProject | null;
  /** Active facility happenings (temporary, separate from levels). */
  modifiers: FacilityModifier[];
  /** Playing style and player instructions (optional layer). */
  tactics: ClubTactics;
  /** What the club has said publicly about its ambitions (used by follow-ups). */
  publicStance: { stance: 'contend' | 'patience'; season: number; round: number; eventId: string } | null;
  /** Season direction and measurable goals agreed with the owners. */
  seasonPlan: SeasonPlan | null;
  /** Owners' spending freeze: voluntary cash spending blocked through this absolute round. */
  spendingFreezeUntil: number;
  seasonStartCash: number;
  reasons: { fanSupport: ReasonEntry[]; ownerConfidence: ReasonEntry[] };
}

export interface ScheduledGame {
  id: GameId;
  season: number;
  round: number;
  homeId: ClubId;
  awayId: ClubId;
  result: { homeRuns: number; awayRuns: number; innings: number; decidedBy: DecidedBy } | null;
}

export type DecidedBy = 'regulation' | 'extraInnings' | 'suddenDeath';

export interface BattingLine {
  pa: number;
  ab: number;
  h: number;
  doubles: number;
  triples: number;
  hr: number;
  rbi: number;
  r: number;
  bb: number;
  so: number;
  sb: number;
}

export interface PitchingLine {
  battersFaced: number;
  outs: number;
  h: number;
  r: number;
  bb: number;
  so: number;
}

export type PlayKind =
  | 'single'
  | 'double'
  | 'triple'
  | 'homeRun'
  | 'walk'
  | 'sacFly'
  | 'groundOut'
  | 'steal'
  | 'caughtStealing'
  | 'doublePlay'
  | 'strikeout'
  | 'pitchingChange'
  | 'ghostRunner'
  | 'walkOff'
  | 'suddenDeath'
  | 'final';

export interface PlayRecord {
  inning: number;
  half: 'top' | 'bottom';
  battingClubId: ClubId;
  kind: PlayKind;
  text: string;
  runs: number;
  outs: number;
  score: { home: number; away: number };
  batterId?: PlayerId;
  pitcherId?: PlayerId;
}

/** Match situation at a moment: outs in the half-inning, runner IDs on 1st–3rd, score. */
export interface BaseState {
  outs: number;
  bases: [PlayerId | null, PlayerId | null, PlayerId | null];
  score: { home: number; away: number };
}

export type PaOutcome = 'strikeout' | 'walk' | 'single' | 'double' | 'triple' | 'homeRun' | 'groundOut' | 'doublePlay' | 'flyOut' | 'sacFly';

/** 0 = batter's box, 1–3 = bases, 4 = home (scored), 'out' = put out. */
export interface RunnerMove {
  playerId: PlayerId;
  from: 0 | 1 | 2 | 3;
  to: 1 | 2 | 3 | 4 | 'out';
}

export type FieldSpot = LineupPosition | 'P';

/**
 * One step of the game as simulated: every plate appearance, steal attempt,
 * pitching change, extra-innings runner and sudden-death decision, in order.
 * Everything here is recorded by the simulator; the presentation layer only
 * reads it. Fielder and ball direction are simulator-recorded metadata derived
 * from a hash of match id and index (never from the game RNG); they do not
 * influence outcomes, which use team fielding.
 */
export interface MatchSequence {
  index: number;
  inning: number;
  half: 'top' | 'bottom';
  kind: 'plateAppearance' | 'steal' | 'caughtStealing' | 'pitchingChange' | 'ghostRunner' | 'suddenDeath';
  battingClubId: ClubId;
  batterId: PlayerId | null;
  pitcherId: PlayerId;
  /** For pitching changes: the pitcher being replaced. */
  previousPitcherId?: PlayerId;
  outcome: PaOutcome | null;
  before: BaseState;
  after: BaseState;
  runners: RunnerMove[];
  /** Outs in the order they happened (e.g. lead runner, then batter on a double play). */
  outOrder: PlayerId[];
  fielder: { spot: FieldSpot; playerId: PlayerId } | null;
  ball: { type: 'ground' | 'line' | 'fly' | 'pop' | 'over'; dir: number } | null;
  text: string;
  /** Set only when a tactic actually changed what happened (steal tried, extra base taken, runner thrown out). */
  tactic?: { playerId: PlayerId; kind: 'steal' | 'extraBase' | 'thrownOut'; source: 'instruction' | 'team' };
}

/** The automatic change rule a starter played under, and whether a reliever was ready. */
export interface MatchHook {
  maxBatters: number;
  pullRuns: number;
  minBatters: number;
  reliever?: boolean;
}

export interface MatchResult {
  id: GameId;
  season: number;
  round: number;
  homeId: ClubId;
  awayId: ClubId;
  lineups: { home: Lineup; away: Lineup };
  /** Runs per inning. For home, null = bottom half not played ("X"). Sudden-death adds one extra column. */
  linescore: { home: (number | null)[]; away: number[] };
  runs: { home: number; away: number };
  hits: { home: number; away: number };
  innings: number;
  decidedBy: DecidedBy;
  walkOff: boolean;
  batting: Record<PlayerId, BattingLine>;
  pitching: Record<PlayerId, PitchingLine>;
  pitchersUsed: { home: PlayerId[]; away: PlayerId[] };
  /** Highlights: only things that actually happened in the simulation. */
  plays: PlayRecord[];
  /** Pitching style each pitcher used (absent in older saves: balanced). */
  pitchStyles?: Record<PlayerId, PitchingStyle>;
  /** When each side's starter was due to be replaced (absent in older saves). */
  hooks?: { home: MatchHook; away: MatchHook };
  /** Complete ordered sequence for the visual match view (absent in older saves). */
  sequence?: MatchSequence[];
  /** Crowd at the user's home games (absent for road games and older saves). */
  gate?: { attendance: number; capacity: number };
}
