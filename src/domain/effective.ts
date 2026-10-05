import { BALANCE } from '../balance/config';
import { overall, overallAs } from './ratings';
import { clamp } from './rng';
import type { GameState } from './state';
import type { BattingLine, ClubId, PitchingLine, Player } from './types';

/*
 * Effective value: what a player is worth today. OVR plus four modifiers,
 * and the simulator adds the same four numbers to every rating he uses:
 *
 *   Fitness  pitchers by rest stage (Exhausted −25 … Fresh +1), hitters by fitness %
 *   Morale   his satisfaction, −2..+2
 *   Team     the squad's shared state, −2..+2, plus temporary boosts
 *   Form     his recent games, −2..+2 (Very cold … Very hot)
 */

const M = () => BALANCE.modifiers;

export type ModifierKey = 'fitness' | 'morale' | 'team' | 'form';
export const MODIFIER_KEYS: ModifierKey[] = ['fitness', 'morale', 'team', 'form'];
export const MODIFIER_LABEL: Record<ModifierKey, string> = { fitness: 'Fitness', morale: 'Morale', team: 'Team', form: 'Form' };
export type Modifiers = Record<ModifierKey, number>;

// ---------------------------------------------------------------- Rest (pitchers)

export type RestStage = 0 | 1 | 2 | 3;

/** Exhausted (0), Tired (1), Ready (2), Fresh (3), from the pitcher's fitness band. */
export function restStage(p: Player): RestStage {
  const stages = M().restStages;
  for (let i = stages.length - 1; i > 0; i--) if (p.fitness >= stages[i].from) return i as RestStage;
  return 0;
}

export const restLabel = (stage: RestStage) => M().restStages[stage].label;

/** After one of his club's games: a start → Exhausted, relief → one stage down, no outing → one stage up. */
export function restAfterGame(p: Player, outing: 'start' | 'relief' | 'none') {
  const now = restStage(p);
  const next = outing === 'start' ? 0 : outing === 'relief' ? Math.max(0, now - 1) : Math.min(3, now + 1);
  p.fitness = M().restStages[next].fitness;
}

/** Games without pitching until he is Ready (0 = ready now). */
export const gamesUntilReady = (p: Player) => Math.max(0, 2 - restStage(p));

/** "Fresh", "Ready", "Tired · ready in 1 game", "Exhausted · ready in 2 games". */
export function restText(p: Player): string {
  const label = restLabel(restStage(p));
  const n = gamesUntilReady(p);
  return n === 0 ? label : `${label} · ready in ${n} game${n === 1 ? '' : 's'}`;
}

// ---------------------------------------------------------------- Personal modifiers

export function fitnessModifier(p: Player): number {
  if (p.isPitcher) return M().restStages[restStage(p)].modifier;
  return M().hitterFitness.find((b) => p.fitness >= b.from)?.modifier ?? -3;
}

export function moraleModifier(p: Player): number {
  return M().morale.find((b) => p.satisfaction >= b.from)?.modifier ?? -2;
}

export const FORM_LABEL: Record<number, string> = { [-2]: 'Very cold', [-1]: 'Cold', 0: 'Neutral', 1: 'Hot', 2: 'Very hot' };

/** Form level −2..+2 from the running score. */
export const formModifier = (p: Player): number => clamp(Math.round(p.form ?? 0), -2, 2);

/** Rating points from fitness, morale and form (everything but Team, which needs the club). */
export const personalModifier = (p: Player) => fitnessModifier(p) + moraleModifier(p) + formModifier(p);

// ---------------------------------------------------------------- Form

/** One game's value for form: about 0 for an average game, positive for a good one. */
export function battingGameValue(l: BattingLine): number {
  const singles = l.h - l.doubles - l.triples - l.hr;
  const tb = singles + 2 * l.doubles + 3 * l.triples + 4 * l.hr;
  return tb + l.bb - 0.5 * l.ab;
}

export function pitchingGameValue(l: PitchingLine): number {
  const expected = (l.outs / 27) * M().form.leagueEra;
  return (expected - l.r) * 0.8 + 0.06 * (l.so - 2 * l.bb);
}

export function updateForm(p: Player, gameValue: number | null) {
  const f = M().form;
  const now = p.form ?? 0;
  p.form = gameValue === null ? now * f.idleKeep[p.isPitcher ? 'pitcher' : 'hitter'] : clamp(now * f.keep + gameValue * f.weight, -f.cap, f.cap);
  p.form = Math.round(p.form * 100) / 100;
}

// ---------------------------------------------------------------- Team

export interface TeamStatus {
  /** −2..+2 from the squad, before temporary boosts. */
  base: number;
  /** Temporary squad boost for the next game (tactics session). */
  boost: number;
  /** base + boost, kept within −2..+2. */
  level: number;
  /** The three inputs, each on the −2..+2 scale, and the weighted sum. */
  parts: { morale: number; form: number; fans: number };
  raw: number;
  avgSatisfaction: number;
  hot: number;
  cold: number;
}

export function teamStatus(state: GameState, clubId: ClubId): TeamStatus {
  const t = M().team;
  const club = state.clubs[clubId];
  const players = club.roster.map((id) => state.players[id]).filter(Boolean);
  const avgSatisfaction = players.reduce((a, p) => a + p.satisfaction, 0) / Math.max(1, players.length);
  const forms = players.map(formModifier);
  const parts = {
    morale: clamp((avgSatisfaction - t.moraleNeutral) / t.moralePerStep, -2, 2),
    form: clamp(forms.reduce((a, b) => a + b, 0) / t.formPerStep, -2, 2),
    fans: clamp((club.fanSupport - t.fansNeutral) / t.fansPerStep, -2, 2),
  };
  const raw = parts.morale * t.weights.morale + parts.form * t.weights.form + parts.fans * t.weights.fans;
  const base = clamp(Math.round(raw), -2, 2);
  const boost = club.isUser ? (state.actions?.teamBoost ?? 0) : 0;
  return { base, boost, level: clamp(base + boost, -2, 2), parts, raw, avgSatisfaction, hot: forms.filter((f) => f > 0).length, cold: forms.filter((f) => f < 0).length };
}

/** A pep talk lifts one player in his next game (user club), on top of the squad's Team. */
export function pepTalkBoost(state: GameState, p: Player): number {
  const club = state.clubs[p.clubId];
  if (!club?.isUser || !state.actions?.motivated.includes(p.id)) return 0;
  return state.actions.boosts?.[p.id] ?? BALANCE.actions.pepTalk.ratingBoost;
}

export const teamModifier = (state: GameState, p: Player, status = teamStatus(state, p.clubId)) => status.level + pepTalkBoost(state, p);

// ---------------------------------------------------------------- Effective

export function modifiers(state: GameState, p: Player, status?: TeamStatus): Modifiers {
  return { fitness: fitnessModifier(p), morale: moraleModifier(p), team: teamModifier(state, p, status), form: formModifier(p) };
}

export const modifierTotal = (m: Modifiers) => m.fitness + m.morale + m.team + m.form;

/** Effective = OVR (as starter or reliever for pitchers, when given) + the four modifiers. */
export function effectiveValue(state: GameState, p: Player, job?: 'SP' | 'RP', status?: TeamStatus): { ovr: number; mods: Modifiers; effective: number } {
  const ovr = p.isPitcher && job ? overallAs(p, job) : overall(p);
  const mods = modifiers(state, p, status);
  return { ovr, mods, effective: ovr + modifierTotal(mods) };
}
