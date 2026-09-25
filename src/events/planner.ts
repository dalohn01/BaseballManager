import { BALANCE } from '../balance/config';
import type { Rng } from '../domain/rng';
import type { EventInstance, GameState, QueuedSlot } from '../domain/state';
import { absoluteRound, nextId } from '../domain/state';
import { getTemplate, managementTemplates } from './registry';
import type { EventTemplate } from './types';

function onCooldown(state: GameState, t: EventTemplate, season: number, round: number): boolean {
  const last = state.templateLastUsed[t.id];
  if (last === undefined || t.cooldownRounds === 0) return false;
  return absoluteRound(season, round) - last < t.cooldownRounds;
}

/** Weighted choice among eligible templates, skipping cooldowns and already-used ones. */
export function pickManagementTemplate(
  state: GameState,
  rng: Rng,
  season: number,
  round: number,
  exclude: string[],
): EventTemplate {
  const candidates = managementTemplates()
    .filter((t) => !exclude.includes(t.id) && !onCooldown(state, t, season, round))
    .map((t) => ({ item: t, weight: t.weight(state) }))
    .filter((c) => c.weight > 0);
  // Team training is always eligible, so the queue can never run dry.
  return rng.weighted(candidates) ?? getTemplate('team_training');
}

/** Plans the fixed calendar for a round: management slots first, then the league game. */
export function planRound(state: GameState, rng: Rng, season: number, round: number): QueuedSlot[] {
  const game = state.schedule.find(
    (g) => g.season === season && g.round === round && (g.homeId === state.userClubId || g.awayId === state.userClubId),
  );
  const queue: QueuedSlot[] = [];
  const used: string[] = [];
  for (const kind of BALANCE.season.slotsPerRound) {
    if (kind === 'match') {
      queue.push({ kind: 'match', templateId: 'league_game', gameId: game?.id ?? null });
    } else {
      const t = pickManagementTemplate(state, rng, season, round, used);
      used.push(t.id);
      queue.push({ kind: 'management', templateId: t.id, gameId: null });
    }
  }
  return queue;
}

/** Turns a queued slot into a concrete, frozen event. Invalid slots are replaced by a valid event. */
export function buildEvent(state: GameState, slot: QueuedSlot, rng: Rng, season: number, round: number, slotIndex: number): EventInstance {
  let template = getTemplate(slot.templateId);
  if (slot.kind === 'management' && (template.weight(state) <= 0 || onCooldown(state, template, season, round))) {
    template = pickManagementTemplate(state, rng, season, round, [template.id]);
  }
  const draft = template.build({ state, rng, season, round, gameId: slot.gameId });
  state.templateLastUsed[template.id] = absoluteRound(season, round);
  return {
    id: nextId(state, 'evt'),
    templateId: template.id,
    templateVersion: template.version,
    type: template.type,
    status: 'pending',
    season,
    round,
    slot: slotIndex,
    rerolled: false,
    resolution: null,
    ...draft,
  };
}

/**
 * Produces the event that follows the current one: next slot in this round,
 * or the first slot of the next round, or the season review.
 */
export function prepareNextEvent(state: GameState, rng: Rng, after: EventInstance): EventInstance | null {
  if (after.type === 'seasonReview') return null;
  const perRound = BALANCE.season.slotsPerRound.length;
  let season = after.season;
  let round = after.round;
  let slotIndex = after.slot + 1;

  if (state.queue.length === 0) {
    if (round >= BALANCE.season.rounds) {
      return buildEvent(state, { kind: 'seasonReview', templateId: 'season_review', gameId: null }, rng, season, round, perRound);
    }
    round += 1;
    slotIndex = 0;
    state.queue = planRound(state, rng, season, round);
  }
  const slot = state.queue.shift()!;
  return buildEvent(state, slot, rng, season, round, slotIndex);
}

/** Labels for the "upcoming" list on Home. */
export const SLOT_LABELS: Record<string, string> = {
  team_training: 'Team training',
  fans_ticket_prices: 'Fan interaction',
  fans_community_day: 'Fan interaction',
  fans_after_loss: 'Fan interaction',
  league_game: 'League game',
  season_review: 'Season review',
};
