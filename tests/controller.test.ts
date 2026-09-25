import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { GameController } from '../src/application/controller';
import { ManualClock } from '../src/platform/clock';
import { IndexedDbSaveRepository } from '../src/platform/indexedDbRepository';
import { MemorySaveRepository } from '../src/platform/saveRepository';
import { T0 } from './helpers';

async function ready(repo = new MemorySaveRepository()) {
  const c = new GameController(repo, new ManualClock(T0));
  await c.init();
  await c.newGame({ seed: 1, timeMode: 'economy' });
  return { c, repo };
}

const resolveFirst = (c: GameController) => {
  const s = c.getSnapshot().state!;
  const ev = s.currentEvent!;
  return c.dispatch({ type: 'resolveEvent', eventId: ev.id, revision: s.revision, optionId: ev.options[0].id, boostId: null });
};

describe('controller + saving', () => {
  it('a failed save retries the same computed result without re-rolling or double charging', async () => {
    const { c, repo } = await ready();
    const before = c.getSnapshot().state!;
    repo.failNext = 1;
    expect(await resolveFirst(c)).toBe(false);
    expect(c.getSnapshot().saveError).toMatch(/Saving failed/);
    // Blocked until saved.
    expect(await resolveFirst(c)).toBe(false);
    expect(await c.retrySave()).toBe(true);
    const after = c.getSnapshot().state!;
    expect(after.time.current).toBe(before.time.current - 1);
    expect(after.currentEvent!.status).toBe('resolved');
    expect((await repo.loadCurrent())!.state.rngState).toBe(after.rngState);
  });

  it('double click resolves once', async () => {
    const { c } = await ready();
    const s = c.getSnapshot().state!;
    const ev = s.currentEvent!;
    const cmd = { type: 'resolveEvent' as const, eventId: ev.id, revision: s.revision, optionId: ev.options[0].id, boostId: null };
    const [a, b] = await Promise.all([c.dispatch(cmd), c.dispatch(cmd)]);
    expect([a, b].filter(Boolean)).toHaveLength(1);
    expect(c.getSnapshot().state!.time.current).toBe(s.time.current - 1);
  });

  it('a resolved but unacknowledged result is shown again after reload', async () => {
    const { repo, c } = await ready();
    await resolveFirst(c);
    const c2 = new GameController(repo, new ManualClock(T0));
    await c2.init();
    expect(c2.getSnapshot().state!.currentEvent!.status).toBe('resolved');
  });

  it('detects a conflicting write from another tab', async () => {
    const repo = new MemorySaveRepository();
    const { c } = await ready(repo);
    const other = new GameController(repo, new ManualClock(T0));
    await other.init();
    await resolveFirst(other);
    expect(await resolveFirst(c)).toBe(false);
    expect(c.getSnapshot().status).toBe('conflict');
  });

  it('export → import round-trips; a bad import leaves the game untouched', async () => {
    const { c } = await ready();
    await resolveFirst(c);
    const text = c.exportCurrent()!;
    const before = c.getSnapshot().state!;
    expect(await c.importSave('{"nope":1}')).toMatch(/not a Baseball Manager save/);
    expect(c.getSnapshot().state).toBe(before);
    expect(await c.importSave(text)).toBeNull();
    const after = c.getSnapshot().state!;
    expect(after.currentEvent!.id).toBe(before.currentEvent!.id);
    expect(after.rngState).toBe(before.rngState);
  });

  it('works against IndexedDB with backup rotation', async () => {
    const repo = new IndexedDbSaveRepository(indexedDB);
    await repo.clear();
    const c = new GameController(repo, new ManualClock(T0));
    await c.init();
    await c.newGame({ seed: 3 });
    await resolveFirst(c);
    const cur = await repo.loadCurrent();
    const bak = await repo.loadBackup();
    expect(cur!.revision).toBe(bak!.revision + 1);
  });
});
