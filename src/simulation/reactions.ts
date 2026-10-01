import type { EffectSink } from '../domain/effects';
import { react, reasonText, type Cause, type Reaction } from '../domain/personality';
import type { GameState } from '../domain/state';
import type { Player, PlayerId } from '../domain/types';

const MAX_REACTIONS = 12;

/**
 * Applies a personality reaction to happiness: base outcome from what
 * happened, sized by the player's personality (the pure `react`), recorded
 * with its cause and saved once per situation id (a reload or a repeated
 * command never applies it twice). Previews use `reactionPreview`, the same
 * calculation, so the shown number is the saved one.
 */
export function applyReaction(state: GameState, sink: EffectSink, playerId: PlayerId, cause: Cause, base: number, reason: string, situationId: string, opts: { record?: boolean } = {}): Reaction | null {
  const p = state.players[playerId];
  if (!p || base === 0) return null;
  p.reactions ??= [];
  if (p.reactions.some((r) => r.id === situationId)) return null;
  const r = react(p.personality, cause, base);
  const text = reasonText(p.personality, r, reason);
  sink.playerMood(p.id, 'satisfaction', r.delta, text, opts);
  p.reactions.unshift({ id: situationId, cause, base, personal: r.personal, delta: r.delta, text, season: state.calendar.season, round: state.calendar.round });
  if (p.reactions.length > MAX_REACTIONS) p.reactions.length = MAX_REACTIONS;
  return r;
}

/** The happiness change a situation would cause (for option previews). */
export const reactionPreview = (p: Player, cause: Cause, base: number) => react(p.personality, cause, base).delta;

/** "+2", "−1.4": one decimal only when needed. */
export function fmtDelta(n: number): string {
  const a = Math.abs(n);
  const s = Number.isInteger(a) ? String(a) : a.toFixed(1);
  return n > 0 ? `+${s}` : n < 0 ? `−${s}` : '0';
}

/** Option text like "Lopez happiness +2.4". */
export const happinessText = (p: Player, cause: Cause, base: number) => `${p.lastName} happiness ${fmtDelta(reactionPreview(p, cause, base))}`;

/** "Squad happiness +0.6 to +1.4": the range a squad-wide statement causes, from the same calculation. */
export function squadText(players: Player[], cause: Cause, base: number): string {
  const d = players.map((p) => reactionPreview(p, cause, base));
  if (d.length === 0) return 'No players';
  const lo = Math.min(...d);
  const hi = Math.max(...d);
  return lo === hi ? `Squad happiness ${fmtDelta(lo)} each` : `Squad happiness ${fmtDelta(base > 0 ? lo : hi)} to ${fmtDelta(base > 0 ? hi : lo)} (by personality)`;
}

/**
 * "Right now": a current state with a real cause (an open promise, a recent
 * setback, a good spell), shown apart from the stable personality. Null when
 * nothing in particular is going on.
 */
export function currentConcern(state: GameState, p: Player): string | null {
  const promise = state.promises.find((x) => x.status === 'active' && x.playerId === p.id);
  if (promise) return `Waiting for the promised starts (${promise.progress}/${promise.threshold}).`;
  const abs = (s: number, r: number) => s * 100 + r;
  const now = abs(state.calendar.season, state.calendar.round);
  const recent = (p.reactions ?? []).filter((r) => now - abs(r.season, r.round) <= 2);
  const worst = [...recent].sort((a, b) => a.delta - b.delta)[0];
  const situation = (text: string) => text.split(' — ')[0];
  if (worst && worst.delta <= -1.5 && p.satisfaction < 65) {
    if (worst.cause === 'new_competitor') return `Worried that the new signing takes his place (${situation(worst.text).toLowerCase()}).`;
    if (worst.cause === 'broken_promise') return 'Lost trust after a broken promise.';
    return `Frustrated: ${situation(worst.text).toLowerCase()}.`;
  }
  const best = [...recent].sort((a, b) => b.delta - a.delta)[0];
  if (best && best.delta >= 1.5 && p.satisfaction >= 70) return `Pleased: ${situation(best.text).toLowerCase()}.`;
  return null;
}
