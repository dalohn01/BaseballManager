import type { EffectSink } from '../domain/effects';
import type { Rng } from '../domain/rng';
import type { GameState } from '../domain/state';
import { userClub } from '../domain/state';
import type { Player, RatingKey } from '../domain/types';
import { trainingModifier } from './economy';
import { startProgram } from './locks';
import { applyReaction } from './reactions';
import { applyProgress, recordProgress } from './training';

export const growthKeys = (p: Player): RatingKey[] =>
  p.isPitcher ? ['pitching'] : (['contact', 'power', 'fielding'] as RatingKey[]).sort((a, b) => p.ratings[a] - p.ratings[b]).slice(0, 2);

/**
 * An individual development program, however it was started (event option
 * or an Influence-paid direct action): progress in his weakest areas (drive
 * and discipline size it through the training model), the fitness cost, his
 * reaction to the opportunity (drive makes it matter more) and the program slot.
 */
export function individualProgram(
  state: GameState,
  sink: EffectSink,
  rng: Rng,
  p: Player,
  opts: { base: number; fitness: number; satisfaction: number; multiplier: number; source: string; situationId: string },
) {
  const club = userClub(state);
  for (const k of growthKeys(p)) recordProgress(sink, p, k, applyProgress(p, k, opts.base, club.facilities.training, rng, opts.multiplier * trainingModifier(club)));
  if (opts.fitness) sink.playerMood(p.id, 'fitness', opts.fitness, 'Extra sessions');
  applyReaction(state, sink, p.id, 'development_opportunity', opts.satisfaction, `Given ${opts.source}`, opts.situationId);
  startProgram(state, p.id, 'training', opts.source);
}
