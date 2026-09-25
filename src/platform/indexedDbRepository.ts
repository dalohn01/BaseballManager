import { SaveConflictError, type SaveEnvelope, type SaveRepository } from './saveRepository';

const DB_NAME = 'baseball-manager';
const STORE = 'saves';
const CURRENT = 'current';
const BACKUP = 'backup';

function openDb(factory: IDBFactory): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = factory.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

const reqToPromise = <T>(req: IDBRequest<T>) =>
  new Promise<T>((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

export class IndexedDbSaveRepository implements SaveRepository {
  private db: Promise<IDBDatabase> | null = null;
  constructor(private readonly factory: IDBFactory = indexedDB) {}

  private getDb() {
    this.db ??= openDb(this.factory);
    return this.db;
  }

  private async read(key: string): Promise<SaveEnvelope | null> {
    const db = await this.getDb();
    const tx = db.transaction(STORE, 'readonly');
    return (await reqToPromise(tx.objectStore(STORE).get(key))) ?? null;
  }

  loadCurrent() {
    return this.read(CURRENT);
  }
  loadBackup() {
    return this.read(BACKUP);
  }

  /** Revision check, backup rotation and write happen in one readwrite transaction. */
  async save(envelope: SaveEnvelope, expectedRevision: number | null): Promise<void> {
    const db = await this.getDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      const store = tx.objectStore(STORE);
      let conflict: SaveConflictError | null = null;
      const get = store.get(CURRENT);
      get.onsuccess = () => {
        const stored = get.result as SaveEnvelope | undefined;
        const storedRevision = stored?.revision ?? null;
        if (storedRevision !== expectedRevision) {
          conflict = new SaveConflictError(storedRevision ?? -1);
          tx.abort();
          return;
        }
        if (stored) store.put(stored, BACKUP);
        store.put(envelope, CURRENT);
      };
      tx.oncomplete = () => resolve();
      tx.onabort = () => reject(conflict ?? tx.error ?? new Error('Save aborted'));
      tx.onerror = () => reject(conflict ?? tx.error);
    });
  }

  async clear(): Promise<void> {
    const db = await this.getDb();
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).clear();
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }
}
