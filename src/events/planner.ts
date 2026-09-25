import { BALANCE } from '../balance/config';
import type { Rng } from '../domain/rng';
import type { EventInstance, FollowUp, GameState, QueuedSlot } from '../domain/state';
import { absoluteRound, nextId, userClub } from '../domain/state';
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
export function pickManagementTemplate(state: GameState, rng: Rng, season: number, round: number, exclude: string[]): EventTemplate {
  const excludedTypes = new Set(exclude.map((id) => getTemplate(id).type));
  const pool = managementTemplates().filter((t) => !exclude.includes(t.id) && !t.urgent && eligible(state, t, season, round));
  const varied = pool.filter((t) => !excludedTypes.has(t.type));
  const candidates = (varied.length > 0 ? varied : pool).map((t) => ({ item: t, weight: t.weight(state) }));
  // Team training is always eligible, so the queue can never run dry.
  return rng.weighted(candidates) ?? getTemplate('team_training');
}

/** Urgent events (cash crisis) jump the queue. */
function urgentTemplate(state: GameState, season: number, round: number): EventTemplate | null {
  return managementTemplates().find((t) => t.urgent?.(state) && !onCooldown(state, t, season, round)) ?? null;
}

/**
 * The earliest due follow-up that can still be delivered. Follow-ups whose
 * premise is gone (e.g. the player left) are dropped; the promise itself
 * already records why it lapsed.
 */
function dueFollowUp(state: GameState, abs: number): FollowUp | null {
  const due = state.followUps.filter((f) => f.dueRound <= abs).sort((a, b) => a.dueRound - b.dueRound || a.id.localeCompare(b.id));
  for (const fu of due) {
    const t = getTemplate(fu.templateId);
    if (!t.followUpValid || t.followUpValid(state, fu)) return fu;
    state.followUps = state.followUps.filter((f) => f.id !== fu.id);
  }
  return null;
}

/**
 * The fixed calendar for a round. Priority: urgent crisis, then due follow-ups,
 * then weighted context events — with at most one priority slot per round so
 * follow-ups never crowd out the regular rhythm; the rest wait for the next round.
 */
export function planRound(state: GameState, rng: Rng, season: number, round: number): QueuedSlot[] {
  const game = state.schedule.find(
    (g) => g.season === season && g.round === round && (g.homeId === state.userClubId || g.awayId === state.userClubId),
  );
  const queue: QueuedSlot[] = [];
  const used: string[] = [];
  const urgent = urgentTemplate(state, season, round);
  const fu = urgent ? null : dueFollowUp(state, absoluteRound(season, round));
  let prioritySlot: QueuedSlot | null = urgent
    ? { kind: 'management', templateId: urgent.id, gameId: null }
    : fu
      ? { kind: 'management', templateId: fu.templateId, gameId: null, followUpId: fu.id }
      : null;
  for (const kind of BALANCE.season.slotsPerRound) {
    if (kind === 'match') {
      queue.push({ kind: 'match', templateId: 'league_game', gameId: game?.id ?? null });
    } else if (prioritySlot) {
      used.push(prioritySlot.templateId);
      queue.push(prioritySlot);
      prioritySlot = null;
    } else {
      const t = pickManagementTemplate(state, rng, season, round, used);
      used.push(t.id);
      queue.push({ kind: 'management', templateId: t.id, gameId: null });
    }
  }
  return queue;
}

/** Preseason: the owners' season plan, then a sponsor search if needed, otherwise a regular event. */
export function planPreseason(state: GameState, rng: Rng, season: number): QueuedSlot[] {
  const second = !userClub(state).sponsor ? getTemplate('sponsor_offer') : pickManagementTemplate(state, rng, season, 0, ['season_plan']);
  return [
    { kind: 'management', templateId: 'season_plan', gameId: null },
    { kind: 'management', templateId: second.id, gameId: null },
  ];
}

/** Turns a queued slot into a concrete, frozen event. Slots whose conditions no longer hold get a valid replacement. */
export function buildEvent(state: GameState, slot: QueuedSlot, rng: Rng, season: number, round: number, slotIndex: number): EventInstance {
  let template = getTemplate(slot.templateId);
  let followUp: FollowUp | undefined;
  if (slot.followUpId) {
    followUp = state.followUps.find((f) => f.id === slot.followUpId);
    state.followUps = state.followUps.filter((f) => f.id !== slot.followUpId);
    if (!followUp || (template.followUpValid && !template.followUpValid(state, followUp))) {
      followUp = undefined;
      template = pickManagementTemplate(state, rng, season, round, [template.id]);
    }
  } else if (slot.kind === 'management' && template.slot === 'management') {
    const urgent = urgentTemplate(state, season, round);
    const urgentDoneThisRound = urgent && state.templateLastUsed[urgent.id] === absoluteRound(season, round);
    const stillValid = template.urgent ? template.urgent(state) : eligible(state, template, season, round);
    if (urgent && !urgentDoneThisRound && urgent.id !== template.id) template = urgent;
    else if (!stillValid) template = pickManagementTemplate(state, rng, season, round, [template.id]);
  }
  const draft = template.build({ state, rng, season, round, gameId: slot.gameId, followUp });
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
 * the first slot of the next round, the season-end sequence
 * (draft → contracts → review) or the next season's preseason.
 */
export function prepareNextEvent(state: GameState, rng: Rng, after: EventInstance): EventInstance {
  const rounds = BALANCE.season.rounds;
  if (after.type === 'seasonReview') {
    // The review already moved the calendar to the next season's preseason.
    const season = state.calendar.season;
    state.queue = planPreseason(state, rng, season);
    return buildEvent(state, state.queue.shift()!, rng, season, 0, 0);
  }
  const season = after.season;
  let round = after.round;
  let slotIndex = after.slot + 1;

  if (state.queue.length === 0) {
    if (round >= rounds) {
      const seasonEnd = (templateId: string) => buildEvent(state, { kind: 'seasonEnd', templateId, gameId: null }, rng, season, round, slotIndex);
      if (after.type === 'leagueGame') return seasonEnd('draft');
      if (after.type === 'draft' && getTemplate('contracts').weight(state) > 0) return seasonEnd('contracts');
      return seasonEnd('season_review');
    }
    round += 1;
    slotIndex = 0;
    state.queue = planRound(state, rng, season, round);
  }
  return buildEvent(state, state.queue.shift()!, rng, season, round, slotIndex);
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
  fans_protest: 'Fan interaction',
  media_expectations: 'Media coverage',
  media_spotlight: 'Media coverage',
  media_stance_review: 'Media follow-up',
  board_checkin: 'Board meeting',
  board_emergency: 'Board meeting',
  board_course_change: 'Board meeting',
  board_ultimatum: 'Board meeting',
  season_plan: 'Season plan',
  facility_expansion: 'Facility expansion',
  free_agent: 'Free agent signing',
  tryouts: 'Tryouts',
  trade_veteran: 'Trade offer',
  trade_pitching: 'Trade offer',
  trade_request: 'Trade request',
  promise_followup: 'Promise follow-up',
  sponsor_offer: 'Sponsor offer',
  league_game: 'League game',
  draft: 'Draft',
  contracts: 'Contracts',
  season_review: 'Season review',
};
