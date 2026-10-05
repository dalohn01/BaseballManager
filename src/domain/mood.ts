import { BALANCE } from '../balance/config';

export type MoodActor = 'player' | 'owners' | 'fans';

const LABELS: Record<MoodActor, [string, string, string, string, string]> = {
  player: ['Miserable', 'Unhappy', 'Uneasy', 'Content', 'Delighted'],
  owners: ['Furious', 'Doubtful', 'Uneasy', 'Satisfied', 'Delighted'],
  fans: ['Hostile', 'Frustrated', 'Restless', 'Supportive', 'Euphoric'],
};

export function moodBand(value: number): 0 | 1 | 2 | 3 | 4 {
  const [a, b, c, d] = BALANCE.moodBands;
  if (value < a) return 0;
  if (value < b) return 1;
  if (value < c) return 2;
  if (value < d) return 3;
  return 4;
}

export const moodLabel = (actor: MoodActor, value: number) => LABELS[actor][moodBand(value)];

/** Next band boundary above and below, for "next relevant threshold" display. */
export function moodThresholds(value: number): { below: number | null; above: number | null } {
  const bands = [0, ...BALANCE.moodBands, 101];
  const i = moodBand(value);
  return { below: i > 0 ? bands[i] : null, above: i < 4 ? bands[i + 1] : null };
}

/** Fitness in percent → readable label (shown next to the number, never colour alone). */
export function fitnessLabel(value: number): string {
  return BALANCE.modifiers.hitterFitness.find((b) => value >= b.from)?.label ?? 'Exhausted';
}
