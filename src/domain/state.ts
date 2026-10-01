import type {
  Player,
  Club,
  ClubId,
  EventInstanceId,
  GameId,
  MatchResult,
  PlayerId,
  ScheduledGame,
} from './types';
import { BALANCE } from '../balance/config';

export const SCHEMA_VERSION = 10;

export type EventType =
  | 'leagueGame'
  | 'teamTraining'
  | 'individualTraining'
  | 'draft'
  | 'freeAgent'
  | 'tryouts'
  | 'media'
  | 'boardMeeting'
  | 'fanInteraction'
  | 'facility'
  | 'trade'
  | 'sponsor'
  | 'contracts'
  | 'seasonReview';

export type EventStatus = 'pending' | 'resolved' | 'acknowledged';

export interface Cost {
  time: number;
  cash: number;
  influence: number;
}

export interface EffectPreview {
  text: string;
  tone: 'positive' | 'negative' | 'neutral';
}

export interface EventOption {
  id: string;
  label: string;
  summary: string;
  /** Effects that will happen for certain. */
  certain: EffectPreview[];
  /** Outcomes that depend on chance or ability; described, not promised. */
  uncertain: EffectPreview[];
  cost: Cost;
  primary?: boolean;
  /** Recruitment options point at a frozen candidate in `EventInstance.candidates`. */
  candidateId?: string;
}

export interface BoostOption {
  id: string;
  label: string;
  description: string;
  cost: Cost;
  appliesTo: string[];
}

export interface EffectRecord {
  targetKind: 'player' | 'club' | 'resource' | 'team';
  targetId: string;
  targetLabel: string;
  stat: string;
  statLabel: string;
  before: number;
  after: number;
  /** Optional denominator for progress-style values ("62/100"). */
  outOf?: number;
  format?: 'number' | 'cash';
  /** Why it changed, when the source gave a reason (satisfaction, fans, owners). */
  reason?: string;
}

export interface Resolution {
  optionId: string;
  optionLabel: string;
  boostId: string | null;
  costPaid: Cost;
  headline: string;
  narrative: string[];
  effects: EffectRecord[];
  reactions: { playerId: PlayerId; text: string }[];
  matchId: GameId | null;
  resolvedAt: { season: number; round: number };
}

export interface EventInstance {
  id: EventInstanceId;
  templateId: string;
  templateVersion: number;
  type: EventType;
  status: EventStatus;
  season: number;
  round: number;
  slot: number;
  kicker: string;
  title: string;
  context: string;
  prompt: string;
  subjects: { playerIds: PlayerId[]; clubIds: ClubId[] };
  /** Frozen offer data (game id, projected numbers…). Never re-rolled. */
  data: Record<string, string | number | boolean | null>;
  options: EventOption[];
  boosts: BoostOption[];
  /** Frozen recruitment candidates (not yet part of any club). */
  candidates: Player[];
  /** Influence cost of re-scouting candidates, or null if this event cannot be rerolled. */
  rerollCost: number | null;
  rerolled: boolean;
  resolution: Resolution | null;
  /**
   * Place in the match cycle: club event, league game, post-match media, or an
   * extra event outside the paid slots (e.g. a cash crisis after the club slot).
   * Absent on legacy events planned before the cycle existed.
   */
  phase?: CyclePhase;
}

export type CyclePhase = 'club' | 'match' | 'media' | 'extra';

export interface QueuedSlot {
  /** 'management' is the club slot (kept for older saves), 'media' the post-match slot. */
  kind: 'management' | 'match' | 'media' | 'seasonEnd';
  templateId: string;
  gameId: GameId | null;
  /** Set when this slot delivers a scheduled follow-up. */
  followUpId?: string;
  /** Placed by the calendar (board checkpoint): not swapped for a weighted pick at build time. */
  scheduled?: boolean;
}

/** A checkable commitment. Evaluated from real data (e.g. actual starts), never from text. */
export interface PromiseRecord {
  id: string;
  kind: 'starts';
  playerId: PlayerId;
  /** Starting player who lost out when the promise was made (reacts when it is kept). */
  rivalId: PlayerId | null;
  threshold: number;
  /** Absolute rounds (inclusive) whose league games count. */
  fromRound: number;
  toRound: number;
  originEventId: EventInstanceId;
  originTitle: string;
  madeAt: { season: number; round: number };
  status: 'active' | 'kept' | 'broken' | 'void';
  progress: number;
  closedAt: { season: number; round: number } | null;
  closeReason: string | null;
}

/** A consequence scheduled for a later calendar slot, referring back to real earlier events. */
export interface FollowUp {
  id: string;
  templateId: string;
  /** Absolute round from which it may be delivered. */
  dueRound: number;
  originEventId: EventInstanceId | null;
  data: Record<string, string | number | boolean | null>;
}

export type SeasonDirection = 'winNow' | 'rebuild' | 'balanced';

export interface SeasonPlan {
  direction: SeasonDirection;
  /** Goal targets; progress is always computed from actual results. */
  winsTarget: number | null;
  prospectStartsTarget: number | null;
  cashTarget: number | null;
  setAt: { season: number; round: number; eventId: EventInstanceId };
  /** Earlier directions this season stay on record. */
  changes: { from: SeasonDirection; to: SeasonDirection; round: number }[];
}

export interface SeasonSummary {
  season: number;
  direction: SeasonDirection | null;
  goalMet: boolean | null;
  goalText: string;
  wins: number;
  losses: number;
  position: number;
  championId: ClubId;
  cashStart: number;
  cashEnd: number;
  payrollEnd: number;
  fanSupport: number;
  ownerConfidence: number;
  prospectStarts: number;
}

export interface DecisionRecord {
  eventId: EventInstanceId;
  templateId: string;
  type: EventType;
  season: number;
  round: number;
  title: string;
  choice: string;
  headline: string;
  costPaid: Cost;
  effects: EffectRecord[];
}

export type LedgerCategory = 'tickets' | 'sponsor' | 'salaries' | 'upkeep' | 'event' | 'facility';

export interface LedgerEntry {
  id: number;
  season: number;
  round: number;
  category: LedgerCategory;
  amount: number;
  note: string;
  eventId: EventInstanceId | null;
  balanceAfter: number;
}

export interface TimeState {
  current: number;
  /** Real-world ms timestamp from which partial regeneration is measured. */
  lastRegenAt: number;
  mode: 'economy' | 'unlimited';
}

export interface Calendar {
  season: number;
  /** 0 = preseason. */
  round: number;
  slot: number;
  phase: 'preseason' | 'regular' | 'postseason';
  /**
   * Day within the round. Regular rounds run 1..daysPerRound (the last is match
   * day); preseason is day 1 (0 = not started yet); the off-season is one day
   * after the last match day. The day's events are planned when it starts.
   */
  day: number;
  /** Events planned when today started (0 = a quiet day). */
  planned?: number;
}

export interface GameState {
  schemaVersion: number;
  revision: number;
  seed: number;
  rngState: number;
  nextId: number;
  userClubId: ClubId;
  clubs: Record<ClubId, Club>;
  clubOrder: ClubId[];
  players: Record<PlayerId, Player>;
  calendar: Calendar;
  schedule: ScheduledGame[];
  /** Full match results for the user's games. */
  matches: Record<GameId, MatchResult>;
  time: TimeState;
  influence: number;
  currentEvent: EventInstance | null;
  /** Created and saved together with the current event's resolution. */
  nextEvent: EventInstance | null;
  queue: QueuedSlot[];
  /** Absolute round index of the last time each template was used (for cooldowns). */
  templateLastUsed: Record<string, number>;
  history: DecisionRecord[];
  ledger: LedgerEntry[];
  promises: PromiseRecord[];
  followUps: FollowUp[];
  seasonSummaries: SeasonSummary[];
  /** Match cycle bookkeeping: closes, satisfaction drift and Influence income. */
  cycle: CycleState;
  /** Manager initiatives paid with Influence (direct actions). */
  actions: ActionState;
}

export interface GroupChange {
  /** Value when the cycle closed, before drift. */
  before: number;
  drift: number;
  after: number;
}

/** One closed match cycle: exactly one per league round, saved with the close. */
export interface CycleRecord {
  id: string;
  season: number;
  round: number;
  board: GroupChange;
  fans: GroupChange;
  /** Squad mean (each player drifts individually; the mean is not drifted again). */
  players: GroupChange;
  contributions: { board: number; fans: number; players: number };
  income: number;
  credited: number;
  balanceAfter: number;
}

export interface CycleState {
  /** Id of the last closed cycle ("c-<season>-<round>"): a close for the same id never runs twice. */
  lastClosedId: string | null;
  /** League games completed by the user's club (all seasons); durations and cooldowns count these. */
  matchesPlayed: number;
  /** Closed cycles, newest last (capped). */
  log: CycleRecord[];
  /** Cycle whose income has not been shown in the club phase yet. */
  unseen: string | null;
  /** Scheduled board checkpoints already handled, e.g. "1:third", "1:mid". */
  boardChecks: string[];
  /** Consecutive closed cycles below the serious-event thresholds. */
  lowStreak: { owners: number; fans: number; players: Record<PlayerId, number> };
}

export type ActionKind = 'pepTalk' | 'extraTraining' | 'recovery' | 'boardMeeting' | 'communityInitiative' | 'fundraiser';

export interface ActionRecord {
  id: string;
  kind: ActionKind | 'facilityUpgrade';
  target: string | null;
  option: string | null;
  cost: { influence: number; cash: number };
  season: number;
  round: number;
  summary: string;
}

export interface ActionState {
  /** matchesPlayed when an action (or the event option sharing its lock) was last used. Keys: action kind or "pepTalk:<playerId>". */
  lastUse: Record<string, number>;
  /** One individual program per player (event or direct), active until the given matchesPlayed. */
  programs: Record<PlayerId, { kind: 'training' | 'recovery'; until: number; source: string }>;
  /** Players motivated for their next league game (pep talk). */
  motivated: PlayerId[];
  /** Rating boost per motivated player (a private demand scales with discipline); absent = the standard pep talk boost. */
  boosts?: Record<PlayerId, number>;
  /** Active fundraiser: pays out once when it ends. */
  fundraiser: { purpose: string; startedAt: number; endsAt: number; amount: number } | null;
  /** Money raised for facility upgrades only (a credit, not free cash). */
  earmarked: number;
  /** Board money granted this season (events and meetings share it). */
  boardFunding: { season: number; granted: number };
  log: ActionRecord[];
}

export const absoluteRound = (season: number, round: number) =>
  (season - 1) * BALANCE.season.rounds + round;

export const userClub = (s: GameState): Club => s.clubs[s.userClubId];

export const clubPlayers = (s: GameState, clubId: ClubId): Player[] =>
  s.clubs[clubId].roster.map((id) => s.players[id]);

export const playerName = (p: Player) => `${p.firstName} ${p.lastName}`;
export const shortName = (p: Player) => `${p.firstName[0]}. ${p.lastName}`;
export const clubName = (c: Club) => `${c.city} ${c.name}`;

export function nextId(s: GameState, prefix: string): string {
  const id = `${prefix}-${s.nextId}`;
  s.nextId += 1;
  return id;
}

export const emptyCost = (): Cost => ({ time: 0, cash: 0, influence: 0 });
