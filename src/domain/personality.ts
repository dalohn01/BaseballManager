import { BALANCE } from '../balance/config';
import { clamp, createRng, hashSeed } from './rng';

/*
 * Personality: seven stable 0–100 tendencies per player. 50 is the middle of
 * each scale; values do not drift toward 75 and are not changed by games.
 * Mechanics read the dimensions (never the profile name); the name and the
 * one-line description are derived deterministically for the UI.
 */

export const DIMENSIONS = ['teamOrientation', 'recognitionNeed', 'outspokenness', 'drive', 'discipline', 'temper', 'consideration'] as const;
export type Dimension = (typeof DIMENSIONS)[number];

export interface Personality {
  version: 1;
  /** Seed the values were generated from (stable per player). */
  seed: number;
  teamOrientation: number;
  recognitionNeed: number;
  outspokenness: number;
  drive: number;
  discipline: number;
  temper: number;
  consideration: number;
}

/** −1 … +1 around the middle of the scale. */
export const nd = (v: number) => (v - 50) / 50;

/** Shifts (−1 … +1 toward low/high) that a generation hint or an old priority maps to. */
export type PersonalityHint = Partial<Record<Dimension, number>>;

/** Loose starting patterns for generation; mechanics never read these. */
const PATTERNS: PersonalityHint[] = [
  { teamOrientation: 1, discipline: 0.8, outspokenness: -0.8, recognitionNeed: -0.8 },
  { teamOrientation: 0.8, drive: 1, outspokenness: 0.8, temper: 0.8 },
  { recognitionNeed: 1, consideration: 0.8, outspokenness: 0.7 },
  { teamOrientation: -0.9, recognitionNeed: 0.8, temper: 0.9 },
  { drive: -1, consideration: 0.8 },
  { drive: 0.9, discipline: 0.9 },
  { drive: 0.9, discipline: -0.8 },
  { teamOrientation: 0.8, outspokenness: 0.7, temper: -0.8, consideration: 0.7 },
];

/** Approximately normal noise (mean 0, sd ≈ 1) from three uniforms. */
function noise(r: () => number) {
  return (r() + r() + r() - 1.5) * 2;
}

/**
 * Stable generation from a player-specific seed (independent of the game's
 * main RNG, so adding personalities does not change other outcomes). Soft,
 * overlapping distributions: about two in three players lean toward one
 * pattern at a random strength, everyone gets individual noise, and a
 * hint (e.g. from an old priority) nudges the main tendency.
 */
export function generatePersonality(seed: number, hint: PersonalityHint = {}, hintStrength = 1): Personality {
  const rng = createRng(seed);
  const r = () => rng.next();
  const cfg = BALANCE.personality.generation;
  const v: Record<Dimension, number> = Object.fromEntries(DIMENSIONS.map((d) => [d, 50 + noise(r) * cfg.spread])) as Record<Dimension, number>;
  if (r() < cfg.patternChance) {
    const pattern = PATTERNS[Math.floor(r() * PATTERNS.length)];
    const k = cfg.patternShift * (0.4 + 0.6 * r());
    for (const [d, s] of Object.entries(pattern) as [Dimension, number][]) v[d] += s * k;
  }
  for (const [d, s] of Object.entries(hint) as [Dimension, number][]) v[d] += s * cfg.hintShift * hintStrength;
  // Mild co-variation, never copies: considerate players lean slightly team-first; discipline cools temper a little.
  v.consideration += (v.teamOrientation - 50) * 0.15;
  v.temper -= (v.discipline - 50) * 0.1;
  const out = { version: 1, seed } as Personality;
  for (const d of DIMENSIONS) out[d] = Math.round(clamp(v[d], 3, 97));
  return out;
}

export const personalitySeed = (playerId: string, name: string) => hashSeed(`personality:${playerId}:${name}`);

// ---------------------------------------------------------------- Description

interface Profile {
  name: string;
  text: string;
  /** Direction per dimension (+1 high, −1 low); the profile fits when all hold. */
  pattern: PersonalityHint;
}

const PROFILES: Profile[] = [
  { name: 'Quiet team player', text: 'Puts the team first, does his job and rarely seeks attention.', pattern: { teamOrientation: 1, discipline: 1, outspokenness: -1, recognitionNeed: -1 } },
  { name: 'Demanding team driver', text: 'Puts the team first. Pushes others hard and has a short fuse.', pattern: { teamOrientation: 1, drive: 1, outspokenness: 1, temper: 1 } },
  { name: 'Calm leader', text: 'Team-first and speaks his mind, but keeps his head and treats people well.', pattern: { teamOrientation: 1, outspokenness: 1, temper: -1, consideration: 1 } },
  { name: 'Charming star', text: 'Wants to be seen and appreciated, and makes others enjoy being around him.', pattern: { recognitionNeed: 1, consideration: 1, outspokenness: 1 } },
  { name: 'Hot-headed individualist', text: 'Puts his own role first and reacts strongly when he is passed over.', pattern: { teamOrientation: -1, recognitionNeed: 1, temper: 1 } },
  { name: 'Easy-going teammate', text: 'Friendly and relaxed, but needs a push to work hard.', pattern: { drive: -1, consideration: 1 } },
  { name: 'Driven professional', text: 'Ambitious and meticulous: he wants to improve and does the work.', pattern: { drive: 1, discipline: 1 } },
  { name: 'Restless talent', text: 'Hungry to get better, but inconsistent in how he goes about it.', pattern: { drive: 1, discipline: -1 } },
  { name: 'Reserved individualist', text: 'Keeps to himself and looks after his own interests.', pattern: { teamOrientation: -1, outspokenness: -1 } },
];

const WORDS: Record<Dimension, [string, string]> = {
  teamOrientation: ['self-focused', 'team-first'],
  recognitionNeed: ['needs little attention', 'wants to be seen'],
  outspokenness: ['reserved', 'outspoken'],
  drive: ['laid-back', 'ambitious'],
  discipline: ['inconsistent', 'meticulous'],
  temper: ['calm', 'hot-headed'],
  consideration: ['blunt', 'considerate'],
};

export const DIMENSION_LABEL: Record<Dimension, string> = {
  teamOrientation: 'Team orientation',
  recognitionNeed: 'Need for recognition',
  outspokenness: 'Outspokenness',
  drive: 'Drive',
  discipline: 'Discipline',
  temper: 'Temper',
  consideration: 'Consideration',
};

/** How well every direction of a pattern holds (the weakest one decides). */
function fit(p: Personality, pattern: PersonalityHint): number {
  return Math.min(...(Object.entries(pattern) as [Dimension, number][]).map(([d, s]) => nd(p[d]) * s));
}

/**
 * A stable short profile: the best-fitting named pattern when every part of
 * it clearly holds (so a calm driver is never called short-fused), otherwise
 * a neutral description of the two clearest tendencies.
 */
export function describePersonality(p: Personality): { name: string; text: string } {
  const best = PROFILES.map((pr) => ({ pr, f: fit(p, pr.pattern) })).sort((a, b) => b.f - a.f)[0];
  if (best && best.f >= BALANCE.personality.profileMinFit) return { name: best.pr.name, text: best.pr.text };
  // Only clear tendencies (the same "high"/"low" as the detail view) are named.
  const top = [...DIMENSIONS]
    .filter((d) => levelWord(p[d]) !== 'Moderate')
    .sort((a, b) => Math.abs(nd(p[b])) - Math.abs(nd(p[a])) || a.localeCompare(b))
    .slice(0, 2);
  if (top.length === 0) return { name: 'Balanced', text: 'No tendency stands out; he takes things as they come.' };
  const words = top.map((d) => WORDS[d][p[d] >= 50 ? 1 : 0]);
  const name = cap(words.join(', '));
  return { name, text: words.length === 2 ? `${cap(words[0])} and ${words[1]}; otherwise fairly balanced.` : `${cap(words[0])}; otherwise fairly balanced.` };
}

const cap = (s: string) => s[0].toUpperCase() + s.slice(1);

/** Words for the optional detail view: low, moderate or high. */
export const levelWord = (v: number) => (v < 35 ? 'Low' : v > 65 ? 'High' : 'Moderate');

// -------------------------------------------------------------- Reactions

/**
 * What happened, coded explicitly (never read from display text). Each cause
 * has central weights in BALANCE.personality.weights over the two to four
 * dimensions that matter for it.
 */
export type Cause =
  | 'rotation'
  | 'playing_time'
  | 'got_start'
  | 'role_reduction'
  | 'told_to_wait'
  | 'development_opportunity'
  | 'planned_rest'
  | 'public_praise'
  | 'team_praise'
  | 'private_praise'
  | 'private_criticism'
  | 'public_criticism'
  | 'promise_made'
  | 'promise_kept'
  | 'broken_promise'
  | 'new_competitor'
  | 'teammate_traded'
  | 'community_attention'
  | 'community_off_day';

export interface Reaction {
  cause: Cause;
  base: number;
  /** The personality multiplier (0.5 … 1.75). */
  factor: number;
  delta: number;
  /** delta − base: what the personality added or took away. */
  personal: number;
  /** Dimension that moved the outcome most, when the personality mattered. */
  driver: Dimension | null;
}

/**
 * factor = clamp(1 + Σ weight × (value − 50) / 50, 0.5, 1.75); delta = base × factor.
 * Never flips the sign and never creates an effect from a zero base.
 */
export function react(p: Personality, cause: Cause, base: number): Reaction {
  const weights = BALANCE.personality.weights[cause] as PersonalityHint;
  let sum = 0;
  let driver: Dimension | null = null;
  let strongest = 0;
  for (const [d, w] of Object.entries(weights) as [Dimension, number][]) {
    const c = w * nd(p[d]);
    sum += c;
    if (Math.abs(c) > strongest) {
      strongest = Math.abs(c);
      driver = d;
    }
  }
  const [lo, hi] = BALANCE.personality.factorRange;
  const factor = clamp(1 + sum, lo, hi);
  const delta = Math.round(base * factor * 10) / 10;
  const personal = Math.round((delta - base) * 10) / 10;
  return { cause, base, factor, delta, personal, driver: Math.abs(personal) >= BALANCE.personality.explainFrom ? driver : null };
}

/** Why the personality made a reaction bigger or smaller, e.g. "puts the team's needs first". */
export function explain(p: Personality, r: Reaction): string | null {
  if (!r.driver) return null;
  // Did this dimension push the reaction's size up or down?
  const w = (BALANCE.personality.weights[r.cause] as PersonalityHint)[r.driver] ?? 0;
  const amplifies = w * nd(p[r.driver]) > 0;
  return EXPLAIN[r.driver][amplifies ? 1 : 0];
}

/** [dampens, amplifies] per dimension. */
const EXPLAIN: Record<Dimension, [string, string]> = {
  teamOrientation: ["puts the team's needs first", 'thinks of his own role first'],
  recognitionNeed: ['does not need the spotlight', 'wants to feel important'],
  outspokenness: ['keeps it to himself', 'says what he thinks'],
  drive: ['is not too bothered', 'is hungry to develop'],
  discipline: ['stays professional about it', 'lets it get to him'],
  temper: ['takes it calmly', 'is quick to anger'],
  consideration: ['keeps it about the job', 'cares about the people involved'],
};

/** Reason line for an effect: the situation, plus the personality's part when it changed the outcome. */
export function reasonText(p: Personality, r: Reaction, reason: string): string {
  const why = explain(p, r);
  return why ? `${reason} — ${why}` : reason;
}

// ------------------------------------------------------------- Behaviour

/**
 * Whether and how a reaction is voiced (separate from how much it hurts):
 * outspokenness decides if it is said, temper and consideration how.
 */
export function expression(p: Personality, delta: number): 'silent' | 'calm' | 'harsh' {
  const voice = nd(p.outspokenness) * 0.7 + nd(p.temper) * 0.3 + Math.min(1, Math.abs(delta) / 6);
  if (voice < BALANCE.personality.voiceFrom) return 'silent';
  return nd(p.temper) - nd(p.consideration) > 0.3 ? 'harsh' : 'calm';
}

/**
 * Own training development: drive (will) and discipline (execution) count
 * separately, combined within 0.7–1.3 of the base outcome.
 */
export function trainingFactor(p: Personality): { factor: number; drive: number; discipline: number } {
  const T = BALANCE.personality.training;
  const drive = T.drive * nd(p.drive);
  const discipline = T.discipline * nd(p.discipline);
  return { factor: clamp(1 + drive + discipline, T.range[0], T.range[1]), drive, discipline };
}

/** How much of a low-happiness training penalty a player keeps (disciplined players keep working). */
export function moodPenaltyShare(p: Personality): number {
  return 1 - BALANCE.personality.training.disciplineMoodShield * Math.max(0, nd(p.discipline));
}

/** "Demanding" behaviour (drive + outspokenness), 0 … 1; used for group influence at training. */
export function demandingness(p: Personality): number {
  return clamp((nd(p.drive) + nd(p.outspokenness) - BALANCE.personality.group.leaderFrom) / (2 - BALANCE.personality.group.leaderFrom), 0, 1);
}

/** Wish for a bigger role (event eligibility and UI notes), −1 … +1. */
export function roleAmbition(p: Personality): number {
  return clamp(0.5 * nd(p.recognitionNeed) + 0.4 * nd(p.drive) - 0.4 * nd(p.teamOrientation), -1, 1);
}

/**
 * Direction an old single priority gives the new model (generation hints for
 * content seeds and the v10 migration): the main tendency only; the other
 * dimensions are generated independently.
 */
export const PRIORITY_HINT: Record<string, PersonalityHint> = {
  loyalty: { teamOrientation: 1 },
  money: { teamOrientation: -0.8, recognitionNeed: 0.4 },
  playingTime: { recognitionNeed: 0.7, drive: 0.5 },
  titles: { drive: 0.8, teamOrientation: 0.4 },
};
