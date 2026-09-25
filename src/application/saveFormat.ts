import { SCHEMA_VERSION, type GameState } from '../domain/state';
import type { SaveEnvelope } from '../platform/saveRepository';
import { canMigrate, migrate } from './migrations';

export type ImportResult = { ok: true; envelope: SaveEnvelope } | { ok: false; error: string };

/**
 * Validates an exported save before it is allowed anywhere near the stored game.
 * Unknown (newer) schema versions are rejected rather than silently dropped.
 */
export function parseSaveFile(text: string): ImportResult {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { ok: false, error: 'The file is not valid JSON.' };
  }
  if (!isObject(data) || data.format !== 'baseball-manager-save') return { ok: false, error: 'This is not a Baseball Manager save file.' };
  if (typeof data.schemaVersion !== 'number') return { ok: false, error: 'The save file has no version.' };
  if (data.schemaVersion > SCHEMA_VERSION) return { ok: false, error: `This save was made by a newer version (v${data.schemaVersion}). Update the game first.` };
  if (!canMigrate(data.schemaVersion)) return { ok: false, error: `Save version v${data.schemaVersion} cannot be migrated.` };
  const problem = checkState(data.state);
  if (problem) return { ok: false, error: `The save file is damaged: ${problem}` };
  try {
    const state = migrate(data.state as Record<string, unknown> & { schemaVersion: number });
    return { ok: true, envelope: { ...(data as unknown as SaveEnvelope), schemaVersion: SCHEMA_VERSION, state } };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

function checkState(s: unknown): string | null {
  if (!isObject(s)) return 'missing game state';
  const st = s as unknown as GameState;
  if (typeof st.revision !== 'number' || typeof st.rngState !== 'number') return 'missing revision or RNG state';
  if (!isObject(st.clubs) || !isObject(st.players) || !Array.isArray(st.schedule)) return 'missing league data';
  if (!st.clubs[st.userClubId]) return 'missing your club';
  for (const club of Object.values(st.clubs)) {
    if (!Array.isArray(club.roster) || club.roster.some((id) => !st.players[id])) return `roster of ${club.name} references unknown players`;
  }
  if (!isObject(st.time) || typeof st.time.current !== 'number') return 'missing Time';
  return null;
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

export function exportSave(envelope: SaveEnvelope): string {
  return JSON.stringify(envelope);
}
