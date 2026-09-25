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

const eligible = (state: GameState, t: EventTemplate, season: number, round: number) =>
  !onCooldown(state, t, season, round) && t.weight(state) > 0;

/** Weighted choice among eligible templates, skipping cooldowns and types already used this round. */
export function pickManagementTemplate(
  state: GameState,
  rng: Rng,
  season: number,
  round: number,
  exclude: string[],
): EventTemplate {
  const excludedTypes = new Set(exclude.map((id) => getTemplate(id).type));
  const pool = managementTemplates().filter((t) => !exclude.includes(t.id) && !t.urgent && eligible(state, t, season, round));
  const varied = pool.filter((t) => !excludedTypes.has(t.type));
  const candidates = (varied.length > 0 ? varied : pool).map((t) => ({ item: t, weight: t.weight(state) }));
  // Team training is always eligible, so the queue can never run dry.
  return rng.weighted(candidates) ?? getTemplate('team_training');
}

/** Urgent events (cash crisis) jump the queue, at most one per round. */
function urgentTemplate(state: GameState, season: number, round: number): EventTemplate | null {
  return managementTemplates().find((t) => t.urgent?.(state) && !onCooldown(state, t, season, round)) ?? null;
}

/** Plans the fixed calendar for a round: management slots first, then the league game. */
export function planRound(state: GameState, rng: Rng, season: number, round: number): QueuedSlot[] {
  const game = state.schedule.find(
    (g) => g.season === season && g.round === round && (g.homeId === state.userClubId || g.awayId === state.userClubId),
  );
  const queue: QueuedSlot[] = [];
  const used: string[] = [];
  const urgent = urgentTemplate(state, season, round);
  for (const kind of BALANCE.season.slotsPerRound) {
    if (kind === 'match') {
      queue.push({ kind: 'match', templateId: 'league_game', gameId: game?.id ?? null });
    } else {
      const t = urgent && !used.includes(urgent.id) ? urgent : pickManagementTemplate(state, rng, season, round, used);
      used.push(t.id);
      queue.push({ kind: 'management', templateId: t.id, gameId: null });
    }
  }
  return queue;
}

/** Turns a queued slot into a concrete, frozen event. Slots whose conditions no longer hold get a valid replacement. */
export function buildEvent(state: GameState, slot: QueuedSlot, rng: Rng, season: number, round: number, slotIndex: number): EventInstance {
  let template = getTemplate(slot.templateId);
  if (slot.kind === 'management') {
    const urgent = urgentTemplate(state, season, round);
    const urgentDoneThisRound = urgent && state.templateLastUsed[urgent.id] === absoluteRound(season, round);
    const stillValid = template.urgent ? template.urgent(state) : eligible(state, template, season, round);
    if (urgent && !urgentDoneThisRound && urgent.id !== template.id) template = urgent;
    else if (!stillValid) template = pickManagementTemplate(state, rng, season, round, [template.id]);
  }
  const draft = template.build({ state, rng, season, round, gameId: slot.gameId });
  state.templateLastUsed[template.id] = absoluteRound(season, round);
  const { candidates = [], rerollCost = null, ...rest } = draft;
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
    candidates,
    rerollCost,
    ...rest,
  };
}

/**
 * Produces the event that follows the current one: next slot in this round,
 * the first slot of the next round, or the season-end sequence (draft → review).
 */
export function prepareNextEvent(state: GameState, rng: Rng, after: EventInstance): EventInstance | null {
  if (after.type === 'seasonReview') return null;
  const perRound = BALANCE.season.slotsPerRound.length;
  let season = after.season;
  let round = after.round;
  let slotIndex = after.slot + 1;

  if (state.queue.length === 0) {
    if (round >= BALANCE.season.rounds) {
      const templateId = after.type === 'draft' ? 'season_review' : 'draft';
      return buildEvent(state, { kind: 'seasonEnd', templateId, gameId: null }, rng, season, round, Math.max(perRound, slotIndex));
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
  team_training_scrimmage: 'Team training',
  individual_training_prospect: 'Individual training',
  individual_training_veteran: 'Individual training',
  fans_ticket_prices: 'Fan interaction',
  fans_community_day: 'Fan interaction',
  fans_after_loss: 'Fan interaction',
  media_expectations: 'Media coverage',
  media_spotlight: 'Media coverage',
  board_checkin: 'Board meeting',
  board_emergency: 'Board meeting',
  facility_expansion: 'Facility expansion',
  free_agent: 'Free agent signing',
  tryouts: 'Tryouts',
  trade_veteran: 'Trade offer',
  trade_pitching: 'Trade offer',
  sponsor_offer: 'Sponsor offer',
  league_game: 'League game',
  draft: 'Draft',
  season_review: 'Season review',
};
