import { defaultPitchingPlan } from '../domain/lineup';
import { cycleId, defaultActions, defaultCycle } from '../simulation/cycle';
import { defaultTactics } from '../domain/tactics';
import { createRng } from '../domain/rng';
import { SCHEMA_VERSION, type GameState } from '../domain/state';
import { buildEvent, planPreseason } from '../events/planner';
import { startNextSeason } from '../simulation/season';

type AnyState = Record<string, unknown> & { schemaVersion: number };

/**
 * Upgrades older saves step by step. Never drops data; unknown newer versions
 * are rejected by the caller instead of being touched.
 */
export function migrate(input: AnyState): GameState {
  const s = structuredClone(input) as unknown as GameState & { schemaVersion: number };
  if (s.schemaVersion === 1) {
    for (const p of Object.values(s.players)) {
      p.contract.startRound ??= 0;
    }
    for (const c of Object.values(s.clubs)) {
      c.project ??= null;
      c.publicStance ??= null;
      if (c.sponsor) {
        c.sponsor.kind ??= 'standard';
        c.sponsor.bonus ??= null;
      }
    }
    for (const ev of [s.currentEvent, s.nextEvent]) {
      if (ev) {
        ev.candidates ??= [];
        ev.rerollCost ??= null;
      }
    }
    s.schemaVersion = 2;
  }
  if (s.schemaVersion === 2) {
    s.promises ??= [];
    s.followUps ??= [];
    s.seasonSummaries ??= [];
    for (const p of Object.values(s.players)) p.pastSeasons ??= [];
    for (const c of Object.values(s.clubs)) {
      c.seasonPlan ??= null;
      c.spendingFreezeUntil ??= 0;
      c.seasonStartCash ??= c.cash;
    }
    // v2 ended a season with no further events; v3 continues into the next season.
    const phase = s.calendar.phase as string;
    const finished = phase === 'seasonComplete' || (s.currentEvent?.type === 'seasonReview' && s.currentEvent.status !== 'pending' && !s.nextEvent);
    if (finished) {
      const rng = createRng(s.rngState);
      startNextSeason(s, rng);
      s.queue = planPreseason(s, rng, s.calendar.season);
      s.currentEvent = buildEvent(s, s.queue.shift()!, rng, s.calendar.season, 0, 0);
      s.nextEvent = null;
      s.rngState = rng.getState();
    } else if (phase === 'seasonComplete') {
      s.calendar.phase = 'regular';
    }
    s.schemaVersion = 3;
  }
  if (s.schemaVersion === 3) {
    // Fatigue (0 = fresh, higher = worse) became fitness in percent (100 = fully ready).
    for (const p of Object.values(s.players) as (typeof s.players)[string][]) {
      const legacy = p as unknown as { fatigue?: number };
      if (legacy.fatigue !== undefined) {
        p.fitness ??= Math.max(0, Math.min(100, Math.round(100 - legacy.fatigue * 0.4)));
        delete legacy.fatigue;
      }
    }
    s.schemaVersion = 4;
  }
  if (s.schemaVersion === 4) {
    // Pitching plans (reliever, rest, hook) became part of each club.
    for (const c of Object.values(s.clubs)) c.pitchingPlan ??= defaultPitchingPlan();
    s.schemaVersion = 5;
  }
  if (s.schemaVersion === 5) {
    // Facility happenings (temporary modifiers) became part of each club.
    for (const c of Object.values(s.clubs)) c.modifiers ??= [];
    // Proposals still waiting in the plan become a happening; an open or pre-built one keeps working (legacy template).
    for (const q of s.queue) if (q.templateId === 'facility_expansion') q.templateId = 'facility_training_clinic';
    s.schemaVersion = 6;
  }
  if (s.schemaVersion === 6) {
    // Tactics: older saves play Balanced and every player follows the team.
    for (const c of Object.values(s.clubs)) c.tactics ??= defaultTactics();
    s.schemaVersion = 7;
  }
  if (s.schemaVersion === 7) {
    // Influence moved to a ×10 scale (it was start 10, costs 2). Converted exactly once:
    // the balance, and any Influence amounts frozen in saved events. A balance above the
    // new cap is kept; income simply pauses until it is below the cap.
    const x10 = (n: number) => Math.round(n * 10);
    s.influence = x10(s.influence ?? 1);
    for (const ev of [s.currentEvent, s.nextEvent]) {
      if (!ev) continue;
      for (const o of ev.options) o.cost.influence = x10(o.cost.influence);
      for (const b of ev.boosts) b.cost.influence = x10(b.cost.influence);
      if (ev.rerollCost !== null && ev.rerollCost !== undefined) ev.rerollCost = x10(ev.rerollCost);
      if (ev.resolution) ev.resolution.costPaid.influence = x10(ev.resolution.costPaid.influence);
    }
    // Satisfaction already uses 0–100 with the club's normal level around 75: values are kept as they are.
    // The round in progress finishes on its old two-event plan (no media, no cycle income for it);
    // the new cycle starts at the next round boundary, when the planner builds club → match → media.
    s.cycle ??= defaultCycle();
    s.actions ??= defaultActions();
    const done = Object.values(s.schedule ?? []).filter((g) => g.result && (g.homeId === s.userClubId || g.awayId === s.userClubId)).length;
    s.cycle.matchesPlayed = done;
    s.cycle.lastClosedId = cycleId(s.calendar.season, s.calendar.round);
    s.schemaVersion = 8;
  }
  if (s.schemaVersion !== SCHEMA_VERSION) throw new Error(`Cannot migrate save v${s.schemaVersion}`);
  return s;
}

export const canMigrate = (version: number) => version >= 1 && version <= SCHEMA_VERSION;
