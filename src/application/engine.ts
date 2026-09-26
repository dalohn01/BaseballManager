import { BALANCE } from '../balance/config';
import { EffectSink } from '../domain/effects';
import { autoLineup, validateLineup, validatePitchingPlan } from '../domain/lineup';
import { createRng } from '../domain/rng';
import { releasePlayer, remainingSeasonSalary, repairLineup, squadProblem } from '../domain/roster';
import type { BoostOption, Cost, EventInstance, EventOption, GameState } from '../domain/state';
import { absoluteRound, userClub } from '../domain/state';
import { canAffordTime, regenerate, spendTime } from '../domain/time';
import type { Lineup, PitchingPlan } from '../domain/types';
import { prepareNextEvent } from '../events/planner';
import { getTemplate } from '../events/registry';

export type Command =
  | {
      type: 'resolveEvent';
      eventId: string;
      revision: number;
      optionId: string;
      boostId: string | null;
      /** League games only: the confirmed pre-match selection, applied atomically with the game. */
      selection?: { lineup: Lineup; pitchingPlan: PitchingPlan };
    }
  | { type: 'acknowledgeEvent'; eventId: string }
  | { type: 'setLineup'; lineup: Lineup }
  | { type: 'autoLineup'; mode: 'strongest' | 'rest' }
  | { type: 'setTimeMode'; mode: 'economy' | 'unlimited' }
  | { type: 'rerollCandidates'; eventId: string; revision: number }
  | { type: 'releasePlayer'; playerId: string };

export type CommandError = { ok: false; code: 'stale' | 'duplicate' | 'invalid' | 'unaffordable'; error: string };
export type CommandResult = { ok: true; state: GameState } | CommandError;

const POSTSEASON = new Set(['draft', 'contracts', 'seasonReview']);

const fail = (code: CommandError['code'], error: string): CommandError => ({ ok: false, code, error });

export function totalCost(option: EventOption, boost: BoostOption | null): Cost {
  return {
    time: option.cost.time + (boost?.cost.time ?? 0),
    cash: option.cost.cash + (boost?.cost.cash ?? 0),
    influence: option.cost.influence + (boost?.cost.influence ?? 0),
  };
}

/** Why an option (with optional boost) cannot be chosen right now, or null if it can. */
export function optionBlocker(state: GameState, event: EventInstance, option: EventOption, boost: BoostOption | null, now: number): string | null {
  const cost = totalCost(option, boost);
  const club = userClub(state);
  if (cost.time > 0 && !canAffordTime(state.time, now, cost.time)) return 'Not enough Time. Wait for it to recover.';
  if (cost.cash > 0 && club.cash < 0) return 'Cash is negative: new voluntary spending is blocked.';
  if (cost.cash > 0 && spendingFrozen(state)) return `Owners' spending freeze: no voluntary spending until after round ${club.spendingFreezeUntil - absoluteRound(state.calendar.season, 0)}.`;
  if (cost.cash > 0 && club.cash < cost.cash) return `Needs $${cost.cash.toLocaleString('en-US')} Club Cash.`;
  if (cost.influence > state.influence) return `Needs ${cost.influence} Influence.`;
  const t = getTemplate(event.templateId);
  return t.optionBlocker?.(state, event, option.id) ?? null;
}

/**
 * Pure command handler: takes a state and returns a new state (never mutates the
 * input). All randomness comes from the RNG state stored in GameState; all time
 * comes from the injected `now`.
 */
export function execute(state: GameState, cmd: Command, now: number): CommandResult {
  switch (cmd.type) {
    case 'resolveEvent':
      return resolveEvent(state, cmd, now);
    case 'acknowledgeEvent': {
      const ev = state.currentEvent;
      if (!ev || ev.id !== cmd.eventId) return fail('stale', 'That event is no longer current.');
      if (ev.status !== 'resolved') return fail('invalid', 'Resolve the event before continuing.');
      const next = structuredClone(state);
      next.currentEvent!.status = 'acknowledged';
      next.currentEvent = next.nextEvent;
      next.nextEvent = null;
      const cur = next.currentEvent;
      if (cur) {
        next.calendar.season = cur.season;
        next.calendar.round = cur.round;
        next.calendar.slot = cur.slot;
        next.calendar.phase = cur.round === 0 ? 'preseason' : POSTSEASON.has(cur.type) ? 'postseason' : 'regular';
      }
      next.revision += 1;
      return { ok: true, state: next };
    }
    case 'setLineup': {
      const errors = validateLineup(state, state.userClubId, cmd.lineup).filter((i) => i.severity === 'error');
      if (errors.length) return fail('invalid', errors[0].text);
      const next = structuredClone(state);
      next.clubs[next.userClubId].lineup = structuredClone(cmd.lineup);
      next.revision += 1;
      return { ok: true, state: next };
    }
    case 'autoLineup': {
      const next = structuredClone(state);
      next.clubs[next.userClubId].lineup = autoLineup(next, next.userClubId, {
        restBelow: cmd.mode === 'rest' ? BALANCE.fitness.restBelow : undefined,
      });
      next.revision += 1;
      return { ok: true, state: next };
    }
    case 'setTimeMode': {
      const next = structuredClone(state);
      next.time = regenerate({ ...next.time, mode: cmd.mode }, now);
      next.revision += 1;
      return { ok: true, state: next };
    }
    case 'rerollCandidates':
      return rerollCandidates(state, cmd);
    case 'releasePlayer': {
      const blocker = releaseBlocker(state, cmd.playerId);
      if (blocker) return fail('invalid', blocker);
      const next = structuredClone(state);
      const p = next.players[cmd.playerId];
      const buyout = releaseCost(next, cmd.playerId);
      const sink = new EffectSink(next, null);
      if (buyout > 0) sink.cash(next.userClubId, -buyout, 'salaries', `Released ${p.firstName} ${p.lastName} (buyout)`);
      releasePlayer(next, p.id);
      repairLineup(next, next.userClubId);
      next.revision += 1;
      return { ok: true, state: next };
    }
  }
}

export const spendingFrozen = (state: GameState) => {
  const until = userClub(state).spendingFreezeUntil;
  return until > 0 && until >= absoluteRound(state.calendar.season, state.calendar.round);
};

export const releaseCost = (state: GameState, playerId: string) =>
  Math.round(remainingSeasonSalary(state, state.players[playerId]) * BALANCE.roster.releaseBuyoutShare);

export function releaseBlocker(state: GameState, playerId: string): string | null {
  const p = state.players[playerId];
  const club = userClub(state);
  if (!p || p.clubId !== club.id) return 'He is not on your roster.';
  if (state.currentEvent?.status === 'resolved') return 'Continue past the current result first.';
  const problem = squadProblem(state, club.roster.filter((id) => id !== playerId));
  if (problem) return problem;
  const cost = releaseCost(state, playerId);
  if (cost > 0 && club.cash < cost) return `The buyout costs $${cost.toLocaleString('en-US')}.`;
  return null;
}

/**
 * Re-scouting is a separate paid action: Influence only, no Time, once per
 * event instance. New candidates are saved immediately; nothing else changes.
 */
function rerollCandidates(state: GameState, cmd: Extract<Command, { type: 'rerollCandidates' }>): CommandResult {
  const ev = state.currentEvent;
  if (!ev || ev.id !== cmd.eventId) return fail('stale', 'That event is no longer current.');
  if (ev.status !== 'pending') return fail('duplicate', 'This decision has already been made.');
  if (cmd.revision !== state.revision) return fail('stale', 'The game changed since this screen was opened.');
  if (ev.rerolled) return fail('duplicate', 'Candidates can only be re-scouted once.');
  const t = getTemplate(ev.templateId);
  if (!t.reroll || ev.rerollCost === null) return fail('invalid', 'This event cannot be re-scouted.');
  if (state.influence < ev.rerollCost) return fail('unaffordable', `Needs ${ev.rerollCost} Influence.`);
  const next = structuredClone(state);
  const nev = next.currentEvent!;
  const rng = createRng(next.rngState);
  const fresh = t.reroll({ state: next, rng, season: nev.season, round: nev.round, gameId: null, event: nev });
  nev.candidates = fresh.candidates ?? [];
  nev.options = fresh.options;
  nev.context = fresh.context;
  nev.rerolled = true;
  next.influence -= nev.rerollCost!;
  next.rngState = rng.getState();
  next.revision += 1;
  return { ok: true, state: next };
}

function resolveEvent(state: GameState, cmd: Extract<Command, { type: 'resolveEvent' }>, now: number): CommandResult {
  const current = state.currentEvent;
  if (!current || current.id !== cmd.eventId) return fail('stale', 'That event is no longer current.');
  if (current.status !== 'pending') return fail('duplicate', 'This decision has already been made.');
  if (cmd.revision !== state.revision) return fail('stale', 'The game changed since this screen was opened. Please try again.');
  const option = current.options.find((o) => o.id === cmd.optionId);
  if (!option) return fail('invalid', 'Unknown choice.');
  const boost = cmd.boostId ? current.boosts.find((b) => b.id === cmd.boostId) ?? null : null;
  if (cmd.boostId && (!boost || !boost.appliesTo.includes(option.id))) return fail('invalid', 'That boost does not apply to this choice.');
  const blocker = optionBlocker(state, current, option, boost, now);
  if (blocker) return fail('unaffordable', blocker);
  if (cmd.selection) {
    if (current.type !== 'leagueGame') return fail('invalid', 'A lineup can only be confirmed for a league game.');
    const problems = [
      ...validateLineup(state, state.userClubId, cmd.selection.lineup),
      ...validatePitchingPlan(state, state.userClubId, cmd.selection.lineup.pitcherId, cmd.selection.pitchingPlan),
    ].filter((i) => i.severity === 'error');
    if (problems.length) return fail('invalid', problems[0].text);
  }

  const next = structuredClone(state);
  const ev = next.currentEvent!;
  const club = userClub(next);
  if (cmd.selection) {
    // The confirmed draft becomes the lineup and plan that the simulator uses for this game.
    club.lineup = structuredClone(cmd.selection.lineup);
    club.pitchingPlan = structuredClone(cmd.selection.pitchingPlan);
  }
  const sink = new EffectSink(next, ev.id);
  const cost = totalCost(option, boost);

  // Costs, outcome and follow-ups are computed together and saved as one unit.
  const timeBefore = regenerate(next.time, now).current;
  next.time = spendTime(next.time, now, cost.time);
  if (next.time.mode === 'economy' && cost.time > 0) {
    sink.record({ targetKind: 'resource', targetId: 'time', targetLabel: 'Manager', stat: 'time', statLabel: 'Time', before: timeBefore, after: next.time.current });
  }
  if (cost.cash > 0) sink.cash(club.id, -cost.cash, 'event', `${ev.title}: ${option.label}`);
  if (cost.influence > 0) {
    const before = next.influence;
    next.influence -= cost.influence;
    sink.record({ targetKind: 'resource', targetId: 'influence', targetLabel: 'Manager', stat: 'influence', statLabel: 'Influence', before, after: next.influence });
  }

  const rng = createRng(next.rngState);
  const template = getTemplate(ev.templateId);
  const out = template.resolve({ state: next, rng, sink, event: ev, option, boost });

  ev.status = 'resolved';
  ev.resolution = {
    optionId: option.id,
    optionLabel: option.label,
    boostId: boost?.id ?? null,
    costPaid: cost,
    headline: out.headline,
    narrative: out.narrative,
    effects: sink.records,
    reactions: out.reactions ?? [],
    matchId: out.matchId ?? null,
    resolvedAt: { season: next.calendar.season, round: next.calendar.round },
  };
  next.history.push({
    eventId: ev.id,
    templateId: ev.templateId,
    type: ev.type,
    season: ev.season,
    round: ev.round,
    title: ev.title,
    choice: option.label + (boost ? ` + ${boost.label}` : ''),
    headline: out.headline,
    costPaid: cost,
    effects: sink.records,
  });

  next.nextEvent = prepareNextEvent(next, rng, ev);
  next.rngState = rng.getState();
  next.revision += 1;
  return { ok: true, state: next };
}
