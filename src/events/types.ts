import type { EffectSink } from '../domain/effects';
import type { Rng } from '../domain/rng';
import type { BoostOption, EventInstance, EventOption, EventType, FollowUp, GameState } from '../domain/state';
import type { GameId, Player, PlayerId } from '../domain/types';

export type EventDraft = Pick<EventInstance, 'kicker' | 'title' | 'context' | 'prompt' | 'subjects' | 'data' | 'options' | 'boosts'> & {
  candidates?: Player[];
  rerollCost?: number | null;
};

export interface BuildContext {
  state: GameState;
  rng: Rng;
  season: number;
  round: number;
  gameId: GameId | null;
  /** Present when this event delivers a scheduled follow-up. */
  followUp?: FollowUp;
}

export interface ResolveContext {
  state: GameState;
  rng: Rng;
  sink: EffectSink;
  event: EventInstance;
  option: EventOption;
  boost: BoostOption | null;
}

export interface ResolveOutput {
  headline: string;
  narrative: string[];
  reactions?: { playerId: PlayerId; text: string }[];
  matchId?: GameId;
  /** Structured numbers for result screens (e.g. development points), never parsed from text. */
  metrics?: Record<string, number>;
}

/**
 * Event templates are typed data plus a small set of safe functions. No
 * content is ever evaluated from text.
 */
export interface EventTemplate {
  id: string;
  version: number;
  type: EventType;
  /** 'management' = the club slot, 'media' = the post-match media slot. */
  slot: 'management' | 'match' | 'media' | 'seasonEnd' | 'preseason' | 'followUp';
  /** For follow-ups: which cycle slot delivers it (default: the club slot). */
  phase?: 'club' | 'media';
  /** Only placed by the calendar (board checkpoints), never drawn from the weighted pool. */
  scheduledOnly?: boolean;
  cooldownRounds: number;
  /** For follow-up templates: can this follow-up still be delivered? (e.g. the player is still here) */
  followUpValid?(state: GameState, fu: FollowUp): boolean;
  /** 0 means not eligible in the current state. */
  weight(state: GameState): number;
  /** If true, this event takes the first management slot of the round (e.g. a cash crisis). */
  urgent?(state: GameState): boolean;
  build(ctx: BuildContext): EventDraft;
  /** Re-scout: new candidates and matching options. Existing club problems are untouched. */
  reroll?(ctx: BuildContext & { event: EventInstance }): Pick<EventDraft, 'candidates' | 'options' | 'context'>;
  /** Extra, template-specific reason an option cannot be picked right now. */
  optionBlocker?(state: GameState, event: EventInstance, optionId: string): string | null;
  resolve(ctx: ResolveContext): ResolveOutput;
}
