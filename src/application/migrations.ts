import { SCHEMA_VERSION, type GameState } from '../domain/state';

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
  if (s.schemaVersion !== SCHEMA_VERSION) throw new Error(`Cannot migrate save v${s.schemaVersion}`);
  return s;
}

export const canMigrate = (version: number) => version >= 1 && version <= SCHEMA_VERSION;
