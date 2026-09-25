import type { GameState } from '../domain/state';
import type { Clock } from '../platform/clock';
import { envelopeFor, SaveConflictError, type SaveRepository } from '../platform/saveRepository';
import { execute, type Command } from './engine';
import { createNewGame, type NewGameOptions } from './newGame';
import { exportSave, parseSaveFile } from './saveFormat';
import { SCHEMA_VERSION } from '../domain/state';

export interface Snapshot {
  status: 'loading' | 'noGame' | 'ready' | 'conflict' | 'loadError';
  state: GameState | null;
  busy: boolean;
  /** A computed-but-unsaved state is waiting for a successful save. */
  saveError: string | null;
  /** Last rejected command, e.g. not enough Time. */
  commandError: string | null;
  loadError: string | null;
}

/**
 * Orchestrates commands and persistence. A command's full result is saved as
 * one unit before the UI may start another action; if saving fails, the same
 * computed state is retried (never recomputed, so no re-roll or double charge).
 */
export class GameController {
  private snap: Snapshot = { status: 'loading', state: null, busy: false, saveError: null, commandError: null, loadError: null };
  private listeners = new Set<() => void>();
  private persistedRevision: number | null = null;
  private unsaved: GameState | null = null;
  private channel: BroadcastChannel | null = null;

  constructor(
    private readonly repo: SaveRepository,
    readonly clock: Clock,
    /** Name of a BroadcastChannel used to notice saves from other tabs (browser only). */
    crossTabChannel: string | null = null,
  ) {
    if (crossTabChannel && typeof BroadcastChannel !== 'undefined') {
      this.channel = new BroadcastChannel(crossTabChannel);
      this.channel.onmessage = (e: MessageEvent<{ revision: number }>) => {
        if (this.persistedRevision !== null && e.data.revision !== this.persistedRevision) {
          this.set({ status: 'conflict' });
        }
      };
    }
  }

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };
  getSnapshot = () => this.snap;

  private set(patch: Partial<Snapshot>) {
    this.snap = { ...this.snap, ...patch };
    this.listeners.forEach((l) => l());
  }

  async init() {
    try {
      const env = await this.repo.loadCurrent();
      if (!env) return this.set({ status: 'noGame' });
      if (env.schemaVersion !== SCHEMA_VERSION) {
        this.persistedRevision = env.revision;
        return this.set({
          status: 'loadError',
          loadError: `Your save uses format v${env.schemaVersion}; this build reads v${SCHEMA_VERSION}. It has not been changed or deleted.`,
        });
      }
      this.persistedRevision = env.revision;
      this.set({ status: 'ready', state: env.state });
    } catch (e) {
      this.set({ status: 'loadError', loadError: `Could not open local storage: ${(e as Error).message}` });
    }
  }

  private async persist(state: GameState): Promise<boolean> {
    try {
      await this.repo.save(envelopeFor(state, this.clock.now()), this.persistedRevision);
      this.persistedRevision = state.revision;
      this.unsaved = null;
      this.channel?.postMessage({ revision: state.revision });
      this.set({ state, saveError: null, busy: false, status: 'ready' });
      return true;
    } catch (e) {
      if (e instanceof SaveConflictError) {
        this.unsaved = null;
        this.set({ status: 'conflict', busy: false });
        return false;
      }
      this.unsaved = state;
      this.set({ saveError: `Saving failed: ${(e as Error).message}`, busy: false });
      return false;
    }
  }

  async dispatch(cmd: Command): Promise<boolean> {
    const current = this.snap.state;
    if (!current || this.snap.busy || this.unsaved || this.snap.status !== 'ready') return false;
    const result = execute(current, cmd, this.clock.now());
    if (!result.ok) {
      // A repeated resolve (double click, stale tab) is a harmless no-op.
      if (result.code === 'duplicate') return false;
      this.set({ commandError: result.error });
      return false;
    }
    this.set({ busy: true, commandError: null });
    return this.persist(result.state);
  }

  async retrySave(): Promise<boolean> {
    if (!this.unsaved || this.snap.busy) return false;
    this.set({ busy: true });
    return this.persist(this.unsaved);
  }

  clearCommandError() {
    this.set({ commandError: null });
  }

  async newGame(opts: Omit<NewGameOptions, 'now'>): Promise<boolean> {
    const state = createNewGame({ ...opts, now: this.clock.now() });
    state.revision = (this.persistedRevision ?? -1) + 1;
    this.set({ busy: true, status: 'ready', loadError: null });
    return this.persist(state);
  }

  exportCurrent(): string | null {
    const s = this.snap.state;
    return s ? exportSave(envelopeFor(s, this.clock.now())) : null;
  }

  /** Returns an error message, or null on success. A bad file never touches the current game. */
  async importSave(text: string): Promise<string | null> {
    const parsed = parseSaveFile(text);
    if (!parsed.ok) return parsed.error;
    const state = parsed.envelope.state;
    state.revision = Math.max(this.persistedRevision ?? -1, state.revision) + 1;
    this.set({ busy: true });
    const ok = await this.persist(state);
    return ok ? null : this.snap.saveError ?? 'Import could not be saved.';
  }

  async reloadFromStorage() {
    this.unsaved = null;
    this.set({ status: 'loading', saveError: null, commandError: null });
    await this.init();
  }
}
