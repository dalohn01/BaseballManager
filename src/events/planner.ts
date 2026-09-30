import { BALANCE } from '../balance/config';
import type { Rng } from '../domain/rng';
import { dayKind } from '../domain/calendar';
import type { Calendar, CyclePhase, EventInstance, FollowUp, GameState, QueuedSlot } from '../domain/state';
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

const phaseOf = (t: EventTemplate) => t.phase ?? (t.slot === 'media' ? 'media' : 'club');

/**
 * The earliest due follow-up for this cycle slot that can still be delivered.
 * Follow-ups whose premise is gone (e.g. the player left) are dropped; the
 * promise itself already records why it lapsed.
 */
function dueFollowUp(state: GameState, abs: number, phase: 'club' | 'media', skip: string[] = []): FollowUp | null {
  const due = state.followUps.filter((f) => f.dueRound <= abs && !skip.includes(f.id)).sort((a, b) => a.dueRound - b.dueRound || a.id.localeCompare(b.id));
  for (const fu of due) {
    const t = getTemplate(fu.templateId);
    if (phaseOf(t) !== phase) continue;
    if (!t.followUpValid || t.followUpValid(state, fu)) return fu;
    state.followUps = state.followUps.filter((f) => f.id !== fu.id);
  }
  return null;
}

/** Board checkpoints counted from the scheduled league rounds: a third, the middle and two thirds in. */
export function boardCheckpoints(rounds = BALANCE.season.rounds) {
  const third = Math.max(1, Math.round(rounds / 3));
  const mid = Math.max(1, Math.round(rounds / 2));
  const twoThirds = Math.max(1, Math.round((2 * rounds) / 3));
  // Short seasons: checkpoints that fall on the same round are merged.
  const list: { key: string; round: number; template: 'board_course_change' | 'board_checkin' }[] = [];
  for (const c of [
    { key: 'third', round: third, template: 'board_course_change' as const },
    { key: 'mid', round: mid, template: 'board_checkin' as const },
    { key: 'twoThirds', round: twoThirds, template: 'board_course_change' as const },
  ]) {
    if (!list.some((x) => x.round === c.round)) list.push(c);
  }
  return list;
}

/**
 * A due board checkpoint for the club slot, or null. A checkpoint that finds
 * nothing to discuss (Off Track while on track) is marked handled without a
 * popup; one that is due but crowded out moves to the next free club slot.
 */
function dueBoardCheck(state: GameState, season: number, round: number): string | null {
  for (const c of boardCheckpoints()) {
    const key = `${season}:${c.key}`;
    if (round < c.round || state.cycle.boardChecks.includes(key)) continue;
    const t = getTemplate(c.template);
    state.cycle.boardChecks.push(key);
    if (t.weight(state) > 0 && !onCooldown(state, t, season, round)) return c.template;
  }
  return null;
}

/** The club-slot pick with its priority: cash crisis, a due follow-up, a board checkpoint, then the weighted pool. */
function clubSlot(state: GameState, season: number, round: number, taken: QueuedSlot[]): QueuedSlot | null {
  const ids = taken.map((q) => q.templateId);
  const urgent = urgentTemplate(state, season, round);
  if (urgent && !ids.includes(urgent.id)) return { kind: 'management', templateId: urgent.id, gameId: null };
  const fu = dueFollowUp(state, absoluteRound(season, round), 'club', taken.map((q) => q.followUpId).filter((x): x is string => !!x));
  if (fu) return { kind: 'management', templateId: fu.templateId, gameId: null, followUpId: fu.id };
  const board = dueBoardCheck(state, season, round);
  if (board) return { kind: 'management', templateId: board, gameId: null, scheduled: true };
  return null;
}

/**
 * The events of one day, planned when the day starts (built one at a time as
 * they come up, so later events see earlier decisions).
 * - Club day: 0–3 club events; something due (crisis, follow-up, board
 *   checkpoint) always gets a slot.
 * - Match day: a crisis first if one is due, then the league game and the
 *   post-match media (chosen after the game).
 * - Preseason: the season plan and a sponsor search or regular event.
 * - Off-season: the draft, which leads on to contracts and the season review.
 */
export function planDay(state: GameState, rng: Rng, cal: Calendar): QueuedSlot[] {
  const { season, round } = cal;
  const kind = dayKind(cal);
  if (kind === 'preseason') return planPreseason(state, rng, season);
  if (kind === 'offseason') return [{ kind: 'seasonEnd', templateId: 'draft', gameId: null }];
  if (kind === 'match') {
    const game = state.schedule.find((g) => g.season === season && g.round === round && (g.homeId === state.userClubId || g.awayId === state.userClubId));
    const queue: QueuedSlot[] = [];
    const urgent = urgentTemplate(state, season, round);
    if (urgent && state.templateLastUsed[urgent.id] !== absoluteRound(season, round)) queue.push({ kind: 'management', templateId: urgent.id, gameId: null });
    queue.push({ kind: 'match', templateId: 'league_game', gameId: game?.id ?? null });
    queue.push({ kind: 'media', templateId: 'media_postgame', gameId: game?.id ?? null });
    return queue;
  }
  const weights = BALANCE.season.clubDayEvents;
  const count = rng.weighted(weights.map((w, n) => ({ item: n, weight: w }))) ?? 1;
  const queue: QueuedSlot[] = [];
  for (let i = 0; i < 3; i++) {
    const due = clubSlot(state, season, round, queue);
    if (due) queue.push(due);
    else if (queue.length < count) queue.push({ kind: 'management', templateId: pickManagementTemplate(state, rng, season, round, queue.map((q) => q.templateId)).id, gameId: null });
    else break;
  }
  return queue;
}

/**
 * The media slot after the game: a due media follow-up first, then a match
 * reaction, then editorial content, with the generic post-match piece as the
 * always-available fallback. A type already used by this round's club event
 * is skipped (one event type per cycle).
 */
function pickMediaTemplate(state: GameState, rng: Rng, season: number, round: number): { template: EventTemplate; followUp?: FollowUp } {
  const fu = dueFollowUp(state, absoluteRound(season, round), 'media');
  if (fu) {
    state.followUps = state.followUps.filter((f) => f.id !== fu.id);
    return { template: getTemplate(fu.templateId), followUp: fu };
  }
  const usedTypes = new Set(state.history.filter((h) => h.season === season && h.round === round).map((h) => h.type));
  const ok = (id: string) => {
    const t = getTemplate(id);
    return !onCooldown(state, t, season, round) && !usedTypes.has(t.type) ? t : null;
  };
  const seasonStart = absoluteRound(season, 0);
  const openerUsed = (state.templateLastUsed.media_expectations ?? -1) > seasonStart;
  const last = getTemplate('fans_after_loss').weight(state) > 0;
  const opener = !openerUsed && round <= 2 ? ok('media_expectations') : null;
  if (opener) return { template: opener };
  const lossReaction = last ? ok('fans_after_loss') : null;
  if (lossReaction) return { template: lossReaction };
  const feature = ok('media_spotlight');
  if (feature && getTemplate('media_spotlight').weight(state) > 0 && rng.chance(BALANCE.media.spotlightChance)) return { template: feature };
  return { template: getTemplate('media_postgame') };
}

/** Preseason: the owners' season plan, then a sponsor search if needed, otherwise a regular event. */
export function planPreseason(state: GameState, rng: Rng, season: number): QueuedSlot[] {
  const second = !userClub(state).sponsor ? getTemplate('sponsor_offer') : pickManagementTemplate(state, rng, season, 0, ['season_plan']);
  return [
    { kind: 'management', templateId: 'season_plan', gameId: null },
    { kind: 'management', templateId: second.id, gameId: null },
  ];
}

const PHASE: Record<QueuedSlot['kind'], CyclePhase | undefined> = { management: 'club', match: 'match', media: 'media', seasonEnd: undefined };

/** Turns a queued slot into a concrete, frozen event. Slots whose conditions no longer hold get a valid replacement. */
export function buildEvent(state: GameState, slot: QueuedSlot, rng: Rng, season: number, round: number, slotIndex: number, phase: CyclePhase | undefined = round > 0 ? PHASE[slot.kind] : undefined): EventInstance {
  let template = getTemplate(slot.templateId);
  let followUp: FollowUp | undefined;
  if (slot.kind === 'media') {
    ({ template, followUp } = pickMediaTemplate(state, rng, season, round));
  } else if (slot.followUpId) {
    followUp = state.followUps.find((f) => f.id === slot.followUpId);
    state.followUps = state.followUps.filter((f) => f.id !== slot.followUpId);
    if (!followUp || (template.followUpValid && !template.followUpValid(state, followUp))) {
      followUp = undefined;
      template = pickManagementTemplate(state, rng, season, round, [template.id]);
    }
  } else if (slot.kind === 'management' && template.slot === 'management' && !slot.scheduled) {
    const urgent = urgentTemplate(state, season, round);
    const urgentDoneThisRound = urgent && state.templateLastUsed[urgent.id] === absoluteRound(season, round);
    const stillValid = template.urgent ? template.urgent(state) : eligible(state, template, season, round);
    if (urgent && !urgentDoneThisRound && urgent.id !== template.id) template = urgent;
    else if (!stillValid) template = pickManagementTemplate(state, rng, season, round, [template.id]);
  }
  const draft = template.build({ state, rng, season, round, gameId: slot.gameId, followUp });
  state.templateLastUsed[template.id] = absoluteRound(season, round);
  const { candidates = [], rerollCost = null, ...rest } = draft;
  const ev: EventInstance = {
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
  if (phase) ev.phase = phase;
  // An extra event outside the paid slots (a crisis after the club slot) costs no Time.
  if (phase === 'extra') for (const o of ev.options) o.cost = { ...o.cost, time: 0 };
  return ev;
}

/**
 * The event that follows the current one on the same day, or null when the
 * day is done. The off-season runs draft → contracts → review in one day; the
 * review moves the calendar to the next season, whose preseason is a new day.
 */
export function prepareNextEvent(state: GameState, rng: Rng, after: EventInstance): EventInstance | null {
  const { season, round } = state.calendar;
  const slotIndex = after.slot + 1;
  if (after.type === 'seasonReview') return null;
  if (state.queue.length === 0) {
    const seasonEnd = (templateId: string) => buildEvent(state, { kind: 'seasonEnd', templateId, gameId: null }, rng, season, round, slotIndex);
    if (after.type === 'draft') return seasonEnd(getTemplate('contracts').weight(state) > 0 ? 'contracts' : 'season_review');
    if (after.type === 'contracts') return seasonEnd('season_review');
    return null;
  }
  return buildEvent(state, state.queue.shift()!, rng, season, round, slotIndex);
}

/** Starts the day the calendar is on: plans its events and builds the first one. */
export function startDay(state: GameState, rng: Rng): EventInstance | null {
  const cal = state.calendar;
  state.queue = planDay(state, rng, cal);
  const first = state.queue.shift();
  return first ? buildEvent(state, first, rng, cal.season, cal.round, 0) : null;
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
  facility_sponsor_discount: 'Club happening',
  facility_training_clinic: 'Club happening',
  facility_disruption: 'Club happening',
  free_agent: 'Free agent signing',
  tryouts: 'Tryouts',
  trade_veteran: 'Trade offer',
  trade_pitching: 'Trade offer',
  trade_request: 'Trade request',
  promise_followup: 'Promise follow-up',
  sponsor_offer: 'Sponsor offer',
  league_game: 'League game',
  media_postgame: 'Post-match media',
  draft: 'Draft',
  contracts: 'Contracts',
  season_review: 'Season review',
};
