import { syncPitching } from '../domain/pitching';
import { demandingness, moodPenaltyShare, nd, trainingFactor } from '../domain/personality';
import { BALANCE } from '../balance/config';
import { clamp, type Rng } from '../domain/rng';
import type { EffectSink } from '../domain/effects';
import { STAT_LABELS } from '../domain/effects';
import type { GameState } from '../domain/state';
import { playerName } from '../domain/state';
import type { Player, RatingKey } from '../domain/types';
import { trainingModifier } from './economy';

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
  // Happiness still matters, but a disciplined player keeps more of his work when he is unhappy.
  const mood = (p.satisfaction - 50) / 250;
  const moodFactor = 1 + (mood < 0 ? mood * moodPenaltyShare(p.personality) : mood);
  // Drive (will) and discipline (execution), limited to 0.7–1.3, after facility and happening rules.
  const personal = trainingFactor(p.personality).factor;
  return base * ageFactor(p.age) * headroom * trainingFacilityFactor(facilityLevel) * moodFactor * personal * multiplier;
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
  if (key === 'velocity' || key === 'control') syncPitching(p);
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
  fitnessBefore: number;
  fitnessAfter: number;
  /** One demanding player's influence on low-drive teammates this session, if any. */
  group: GroupInfluence | null;
}

export interface GroupInfluence {
  leaderId: string;
  /** Encouraging (considerate) or harsh (blunt and hot-headed). */
  tone: 'encouraging' | 'harsh';
  /** Team-first demands lift the group's effort; self-focused ones are about his own chances. */
  aboutTeam: boolean;
  recipients: string[];
  intensity: number;
  text: string;
}

/**
 * Demanding behaviour at one session: the single most demanding player (drive
 * and outspokenness) influences up to four low-drive teammates. Only the
 * strongest leader counts, so one recipient gets one influence per session.
 */
export function groupInfluence(players: Player[]): GroupInfluence | null {
  const G = BALANCE.personality.group;
  const ranked = players.map((p) => ({ p, d: demandingness(p.personality) })).filter((x) => x.d > 0).sort((a, b) => b.d - a.d || a.p.id.localeCompare(b.p.id));
  const lead = ranked[0];
  if (!lead) return null;
  const pp = lead.p.personality;
  const tone = nd(pp.consideration) - 0.5 * nd(pp.temper) >= 0 ? 'encouraging' : 'harsh';
  const aboutTeam = nd(pp.teamOrientation) >= 0;
  const recipients = players
    .filter((x) => x.id !== lead.p.id && x.personality.drive < 50)
    .sort((a, b) => a.personality.drive - b.personality.drive || a.id.localeCompare(b.id))
    .slice(0, G.maxRecipients)
    .map((x) => x.id);
  if (recipients.length === 0) return null;
  if (tone === 'encouraging' && !aboutTeam) return null; // Quietly pushing for himself: no effect on others.
  const n = recipients.length;
  const text =
    tone === 'encouraging'
      ? `${lead.p.lastName} drove the session and lifted the effort of ${n} teammate${n === 1 ? '' : 's'}.`
      : aboutTeam
        ? `${lead.p.lastName} demanded more from the group, harshly: ${n} teammate${n === 1 ? ' was' : 's were'} irritated.`
        : `${lead.p.lastName} complained loudly about the sessions: ${n} teammate${n === 1 ? ' was' : 's were'} irritated.`;
  return { leaderId: lead.p.id, tone, aboutTeam, recipients, intensity: lead.d, text };
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
  const fitnessBefore = avg(players.map((p) => p.fitness));
  const level = club.facilities.training;
  // Temporary training happenings (guest clinic, maintenance) on top of the level.
  const boost = trainingModifier(club);
  const summary: TeamTrainingSummary = { pointsGained: [], totalProgress: 0, facilityContribution: 0, facilityLevel: level, fitnessBefore, fitnessAfter: fitnessBefore, group: null };

  if (focus !== 'recovery') {
    const G = BALANCE.personality.group;
    const group = club.isUser ? groupInfluence(players) : null;
    summary.group = group;
    // A team-first push lifts the recipients' session a little (harsh or not); a self-focused one does not.
    const lift = (id: string) => (group && group.aboutTeam && group.recipients.includes(id) ? 1 + G.progressBoost * group.intensity * (group.tone === 'harsh' ? 0.5 : 1) : 1);
    if (group?.tone === 'harsh') {
      const leader = state.players[group.leaderId];
      for (const id of group.recipients) {
        const delta = Math.round(G.harshSatisfaction * group.intensity * 10) / 10;
        if (delta === 0) continue;
        const reason = `Irritated by ${leader.lastName}'s harsh demands at training`;
        sink.playerMood(id, 'satisfaction', delta, reason);
        const r = state.players[id];
        r.reactions ??= [];
        r.reactions.unshift({ id: `group:${leader.id}:${state.cycle.matchesPlayed}:${state.nextId}:${id}`, cause: 'group_irritation', base: delta, personal: 0, delta, text: reason, season: state.calendar.season, round: state.calendar.round });
        if (r.reactions.length > 12) r.reactions.length = 12;
      }
    }
    for (const p of players) {
      const keys: RatingKey[] = p.isPitcher
        ? focus === 'defense'
          ? ['velocity', 'control']
          : []
        : focus === 'batting'
          ? ['contact', 'power']
          : ['fielding'];
      for (const key of keys) {
        const base = p.isPitcher ? t.pitcherBaseProgress : t.baseProgress;
        const r = applyProgress(p, key, base, level, rng, multiplier * boost * lift(p.id));
        summary.totalProgress += r.gain;
        recordProgress(sink, p, key, r);
        if (r.ratingAfter > r.ratingBefore) summary.pointsGained.push({ playerId: p.id, key, before: r.ratingBefore, after: r.ratingAfter });
      }
    }
  }

  summary.facilityContribution = summary.totalProgress - Math.round(summary.totalProgress / trainingFacilityFactor(level));
  const fitnessDelta = focus === 'batting' ? t.battingFitness : focus === 'defense' ? t.defenseFitness : t.recoveryFitness;
  for (const p of players) sink.playerMood(p.id, 'fitness', fitnessDelta, 'Team training', { record: false });
  summary.fitnessAfter = avg(players.map((p) => p.fitness));
  sink.record({
    targetKind: 'team',
    targetId: clubId,
    targetLabel: 'Squad average',
    stat: 'fitness',
    statLabel: 'Fitness',
    before: Math.round(fitnessBefore),
    after: Math.round(summary.fitnessAfter),
  });
  return summary;
}

export const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
