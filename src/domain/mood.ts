import { BALANCE } from '../balance/config';

export type MoodActor = 'player' | 'owners' | 'fans';

const LABELS: Record<MoodActor, [string, string, string, string, string]> = {
  player: ['Miserable', 'Unhappy', 'Content', 'Happy', 'Delighted'],
  owners: ['Furious', 'Doubtful', 'Neutral', 'Confident', 'Delighted'],
  fans: ['Hostile', 'Frustrated', 'Neutral', 'Supportive', 'Euphoric'],
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

export function fatigueLabel(value: number): string {
  if (value < 25) return 'Fresh';
  if (value < 50) return 'Fit';
  if (value < 70) return 'Tired';
  return 'Exhausted';
}
