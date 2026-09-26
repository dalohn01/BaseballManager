import { defaultPitchingPlan } from '../domain/lineup';
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
  if (s.schemaVersion !== SCHEMA_VERSION) throw new Error(`Cannot migrate save v${s.schemaVersion}`);
  return s;
}

export const canMigrate = (version: number) => version >= 1 && version <= SCHEMA_VERSION;
