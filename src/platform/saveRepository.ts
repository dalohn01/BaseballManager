import type { GameState } from '../domain/state';

export interface SaveEnvelope {
  format: 'baseball-manager-save';
  schemaVersion: number;
  revision: number;
  savedAt: number;
  state: GameState;
}

export class SaveConflictError extends Error {
  constructor(public readonly storedRevision: number) {
    super('This game was changed in another tab or window. Reload to continue from the latest save.');
  }
}

/**
 * Storage port. The engine never touches storage directly, so a native app can
 * swap this for a different adapter later.
 */
export interface SaveRepository {
  loadCurrent(): Promise<SaveEnvelope | null>;
  loadBackup(): Promise<SaveEnvelope | null>;
  /**
   * Atomically writes a new save if the stored revision still equals
   * `expectedRevision` (null = no save expected). The previous save becomes the backup.
   */
  save(envelope: SaveEnvelope, expectedRevision: number | null): Promise<void>;
  clear(): Promise<void>;
}

export function envelopeFor(state: GameState, now: number): SaveEnvelope {
  return { format: 'baseball-manager-save', schemaVersion: state.schemaVersion, revision: state.revision, savedAt: now, state };
}

export class MemorySaveRepository implements SaveRepository {
  current: SaveEnvelope | null = null;
  backup: SaveEnvelope | null = null;
  failNext = 0;

  async loadCurrent() {
    return this.current ? structuredClone(this.current) : null;
  }
  async loadBackup() {
    return this.backup ? structuredClone(this.backup) : null;
  }
  async save(envelope: SaveEnvelope, expectedRevision: number | null) {
    if (this.failNext > 0) {
      this.failNext -= 1;
      throw new Error('Simulated storage failure');
    }
    const stored = this.current?.revision ?? null;
    if (stored !== expectedRevision) throw new SaveConflictError(stored ?? -1);
    this.backup = this.current;
    this.current = structuredClone(envelope);
  }
  async clear() {
    this.current = null;
    this.backup = null;
  }
}
