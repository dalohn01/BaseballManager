import type {
  Club,
  ClubId,
  EventInstanceId,
  GameId,
  MatchResult,
  Player,
  PlayerId,
  ScheduledGame,
} from './types';
import { BALANCE } from '../balance/config';

export const SCHEMA_VERSION = 1;

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
  rerolled: boolean;
  resolution: Resolution | null;
}

export interface QueuedSlot {
  kind: 'management' | 'match' | 'seasonReview';
  templateId: string;
  gameId: GameId | null;
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

export type LedgerCategory = 'tickets' | 'sponsor' | 'salaries' | 'upkeep' | 'event';

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
  round: number;
  slot: number;
  phase: 'regular' | 'seasonComplete';
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
