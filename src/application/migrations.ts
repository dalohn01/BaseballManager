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
  if (s.schemaVersion !== SCHEMA_VERSION) throw new Error(`Cannot migrate save v${s.schemaVersion}`);
  return s;
}

export const canMigrate = (version: number) => version >= 1 && version <= SCHEMA_VERSION;
