import type { EffectSink } from '../domain/effects';
import type { Rng } from '../domain/rng';
import type { BoostOption, EventInstance, EventOption, EventType, GameState } from '../domain/state';
import type { GameId, PlayerId } from '../domain/types';

export type EventDraft = Pick<
  EventInstance,
  'kicker' | 'title' | 'context' | 'prompt' | 'subjects' | 'data' | 'options' | 'boosts'
>;

export interface BuildContext {
  state: GameState;
  rng: Rng;
  season: number;
  round: number;
  gameId: GameId | null;
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
}

/**
 * Event templates are typed data plus a small set of safe functions. No
 * content is ever evaluated from text.
 */
export interface EventTemplate {
  id: string;
  version: number;
  type: EventType;
  slot: 'management' | 'match' | 'seasonReview';
  cooldownRounds: number;
  /** 0 means not eligible in the current state. */
  weight(state: GameState): number;
  build(ctx: BuildContext): EventDraft;
  /** Extra, template-specific reason an option cannot be picked right now. */
  optionBlocker?(state: GameState, event: EventInstance, optionId: string): string | null;
  resolve(ctx: ResolveContext): ResolveOutput;
}
