import { BALANCE } from '../balance/config';
import { clamp, type Rng } from '../domain/rng';
import type { EffectSink } from '../domain/effects';
import { STAT_LABELS } from '../domain/effects';
import type { GameState } from '../domain/state';
import { playerName } from '../domain/state';
import type { Player, RatingKey } from '../domain/types';

export function ageFactor(age: number): number {
  if (age <= 21) return 1.4;
  if (age <= 24) return 1.2;
  if (age <= 28) return 1.0;
  if (age <= 31) return 0.7;
  return 0.4;
}

/** Training Center levels 1–3. */
export const trainingFacilityFactor = (level: number) => 1 + (level - 1) * 0.2;

export interface ProgressResult {
  gain: number;
  ratingBefore: number;
  ratingAfter: number;
  progressBefore: number;
  progressAfter: number;
  atCeiling: boolean;
}

/** Expected (no-variance) progress, used for forecasts. */
export function expectedProgress(p: Player, key: RatingKey, base: number, facilityLevel: number, multiplier = 1): number {
  const headroom = clamp((p.potential - p.ratings[key]) / BALANCE.training.fullEffectHeadroom, 0, 1);
  const moodFactor = 1 + (p.satisfaction - 50) / 250;
  return base * ageFactor(p.age) * headroom * trainingFacilityFactor(facilityLevel) * moodFactor * multiplier;
}

export function applyProgress(
  p: Player,
  key: RatingKey,
  base: number,
  facilityLevel: number,
  rng: Rng,
  multiplier = 1,
): ProgressResult {
  const [lo, hi] = BALANCE.training.variance;
  const expected = expectedProgress(p, key, base, facilityLevel, multiplier);
  const gain = Math.round(expected * rng.range(lo, hi));
  const ratingBefore = p.ratings[key];
  const progressBefore = p.progress[key];
  let progress = progressBefore + gain;
  let rating = ratingBefore;
  while (progress >= 100 && rating < Math.min(100, p.potential)) {
    rating += 1;
    progress -= 100;
  }
  if (rating >= Math.min(100, p.potential)) progress = Math.min(progress, 99);
  p.ratings[key] = rating;
  p.progress[key] = progress;
  return { gain, ratingBefore, ratingAfter: rating, progressBefore, progressAfter: progress, atCeiling: expected === 0 };
}

/** Records a progress result so the UI can show "Contact 72 → 73" or "progress 20 → 55/100". */
export function recordProgress(sink: EffectSink, p: Player, key: RatingKey, r: ProgressResult) {
  if (r.ratingAfter !== r.ratingBefore) {
    sink.record({
      targetKind: 'player',
      targetId: p.id,
      targetLabel: playerName(p),
      stat: key,
      statLabel: STAT_LABELS[key],
      before: r.ratingBefore,
      after: r.ratingAfter,
    });
  } else if (r.gain > 0) {
    sink.record({
      targetKind: 'player',
      targetId: p.id,
      targetLabel: playerName(p),
      stat: `${key}Progress`,
      statLabel: `${STAT_LABELS[key]} progress`,
      before: r.progressBefore,
      after: r.progressAfter,
      outOf: 100,
    });
  }
}

export type TeamTrainingFocus = 'batting' | 'defense' | 'recovery';

export interface TeamTrainingSummary {
  pointsGained: { playerId: string; key: RatingKey; before: number; after: number }[];
  totalProgress: number;
  /** Progress points that came from Training Center levels above 1. */
  facilityContribution: number;
  facilityLevel: number;
  fatigueBefore: number;
  fatigueAfter: number;
}

export function runTeamTraining(
  state: GameState,
  clubId: string,
  focus: TeamTrainingFocus,
  multiplier: number,
  rng: Rng,
  sink: EffectSink,
): TeamTrainingSummary {
  const club = state.clubs[clubId];
  const t = BALANCE.training;
  const players = club.roster.map((id) => state.players[id]);
  const fatigueBefore = avg(players.map((p) => p.fatigue));
  const level = club.facilities.training;
  const summary: TeamTrainingSummary = { pointsGained: [], totalProgress: 0, facilityContribution: 0, facilityLevel: level, fatigueBefore, fatigueAfter: fatigueBefore };

  if (focus !== 'recovery') {
    for (const p of players) {
      const keys: RatingKey[] = p.isPitcher
        ? focus === 'defense'
          ? ['pitching']
          : []
        : focus === 'batting'
          ? ['contact', 'power']
          : ['fielding'];
      for (const key of keys) {
        const base = p.isPitcher ? t.pitcherBaseProgress : t.baseProgress;
        const r = applyProgress(p, key, base, level, rng, multiplier);
        summary.totalProgress += r.gain;
        recordProgress(sink, p, key, r);
        if (r.ratingAfter > r.ratingBefore) summary.pointsGained.push({ playerId: p.id, key, before: r.ratingBefore, after: r.ratingAfter });
      }
    }
  }

  summary.facilityContribution = summary.totalProgress - Math.round(summary.totalProgress / trainingFacilityFactor(level));
  const fatigueDelta = focus === 'batting' ? t.battingFatigue : focus === 'defense' ? t.defenseFatigue : t.recoveryFatigue;
  for (const p of players) sink.playerMood(p.id, 'fatigue', fatigueDelta, 'Team training', { record: false });
  summary.fatigueAfter = avg(players.map((p) => p.fatigue));
  sink.record({
    targetKind: 'team',
    targetId: clubId,
    targetLabel: 'Squad average',
    stat: 'fatigue',
    statLabel: 'Fatigue',
    before: Math.round(fatigueBefore),
    after: Math.round(summary.fatigueAfter),
  });
  return summary;
}

export const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
