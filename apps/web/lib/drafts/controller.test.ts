import 'fake-indexeddb/auto';
import type { DraftSaveResponse } from '@clinic-mx/schemas';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DraftController, type DraftSaver } from './controller';
import { clearDrafts, getDraft, listDrafts, putDraft } from './store';
import { claimDraft, flushDrafts } from './sync';

const scope = 'staff-1';

/** A fake server holding one note with a version, like updateVersioned. */
function fakeServer(initial = 'saved text') {
  const server = { value: initial, version: 1, saves: 0, down: false };
  const save: DraftSaver<string> = (value, baseVersion) => {
    server.saves++;
    if (server.down) return Promise.reject(new TypeError('Failed to fetch'));
    if (baseVersion !== server.version) {
      return Promise.resolve<DraftSaveResponse<string>>({
        status: 'conflict',
        version: server.version,
        value: server.value,
      });
    }
    server.value = value;
    server.version++;
    return Promise.resolve({ status: 'saved', version: server.version });
  };
  return { server, save };
}

let online = true;
let created: DraftController<string>[] = [];

/** Moves the clock, then waits until every controller has finished its device writes and saves. */
async function advance(ms: number) {
  await vi.advanceTimersByTimeAsync(ms);
  for (const c of created) await c.settled();
}

function controller(save: DraftSaver<string>, serverValue = 'saved text', serverVersion = 1) {
  const draft = new DraftController({
    scope,
    kind: 'note',
    id: 'n1',
    serverValue,
    serverVersion,
    save,
    debounceMs: 800,
    retryMs: 10_000,
    isOnline: () => online,
  });
  created.push(draft);
  return draft;
}

beforeEach(async () => {
  online = true;
  created = [];
  await clearDrafts(scope);
  // Only the controller's debounce and retry timers: fake-indexeddb schedules its own work
  // with setImmediate, which must keep running.
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('DraftController', () => {
  it('keeps every change on the device at once and saves once typing pauses', async () => {
    const { server, save } = fakeServer();
    const draft = controller(save);
    draft.setValue('a');
    draft.setValue('ab');
    await advance(0);
    expect((await getDraft<string>(draft.key))?.value).toBe('ab');
    expect(server.saves).toBe(0);

    await advance(800);
    expect(server).toMatchObject({ value: 'ab', version: 2, saves: 1 });
    expect(draft.getState().status).toBe('saved');
    expect(await getDraft(draft.key)).toBeUndefined();
  });

  it('restores a draft after a reload and saves it', async () => {
    const { server, save } = fakeServer();
    const before = controller(save);
    server.down = true;
    before.setValue('typed before the reload');
    await advance(800);
    before.dispose();

    server.down = false;
    const after = controller(save);
    await after.start();
    expect(after.getState()).toMatchObject({ value: 'typed before the reload', status: 'saved' });
    expect(server.value).toBe('typed before the reload');
  });

  it('waits offline and saves when flushed after reconnecting', async () => {
    const { server, save } = fakeServer();
    const draft = controller(save);
    online = false;
    draft.setValue('offline edit');
    await advance(800);
    expect(draft.getState().status).toBe('pending');
    expect(server.saves).toBe(0);

    online = true;
    await draft.flush();
    expect(draft.getState().status).toBe('saved');
    expect(server.value).toBe('offline edit');
  });

  it('retries while online when the server cannot be reached', async () => {
    const { server, save } = fakeServer();
    const draft = controller(save);
    server.down = true;
    draft.setValue('server down');
    await advance(800);
    expect(draft.getState().status).toBe('pending');

    server.down = false;
    await advance(10_000);
    expect(draft.getState().status).toBe('saved');
  });

  it('on a conflict overwrites nothing, then "Keep my version" saves mine', async () => {
    const { server, save } = fakeServer();
    const draft = controller(save);
    server.value = 'changed on another device';
    server.version = 2;
    draft.setValue('my offline edit');
    await advance(800);
    expect(draft.getState()).toMatchObject({
      status: 'conflict',
      conflict: { version: 2, value: 'changed on another device' },
    });
    expect(server.value).toBe('changed on another device');
    expect((await getDraft(draft.key))?.conflict).toBeDefined();

    await draft.keepMine();
    expect(draft.getState().status).toBe('saved');
    expect(server).toMatchObject({ value: 'my offline edit', version: 3 });
  });

  it('on a conflict, "Use the saved version" shows theirs and drops my draft', async () => {
    const { server, save } = fakeServer();
    const draft = controller(save);
    server.value = 'theirs';
    server.version = 2;
    draft.setValue('mine');
    await advance(800);

    await draft.takeSaved();
    expect(draft.getState()).toMatchObject({ value: 'theirs', status: 'saved' });
    expect(await getDraft(draft.key)).toBeUndefined();
    draft.setValue('theirs, edited');
    await advance(800);
    expect(server).toMatchObject({ value: 'theirs, edited', version: 3 });
  });

  it('keeps a conflict across a reload until the person chooses', async () => {
    const { server, save } = fakeServer();
    const first = controller(save);
    server.version = 2;
    first.setValue('mine');
    await advance(800);
    first.dispose();

    const second = controller(save);
    await second.start();
    expect(second.getState().status).toBe('conflict');
  });

  // CLN-09: signing signs only what is saved.
  it('saves now and answers the saved version, or nothing while changes stay unsaved', async () => {
    const { server, save } = fakeServer();
    const draft = controller(save);
    expect(await draft.saveNow()).toBe(1);
    draft.setValue('before signing');
    expect(await draft.saveNow()).toBe(2);
    expect(server.value).toBe('before signing');
    online = false;
    draft.setValue('offline');
    expect(await draft.saveNow()).toBeUndefined();
  });

  it('saves an edit made while the previous save was on its way', async () => {
    const { server, save } = fakeServer();
    let release: () => void = () => undefined;
    const slow: DraftSaver<string> = (value, base) =>
      new Promise((resolve) => {
        release = () => void save(value, base).then(resolve);
      });
    const draft = controller(slow);
    draft.setValue('first');
    // The save is held back here, so the clock moves without waiting for it to settle.
    await vi.advanceTimersByTimeAsync(800);
    draft.setValue('first and second');
    release();
    await draft.settled();
    expect(draft.getState().status).toBe('pending');
    await vi.advanceTimersByTimeAsync(800);
    release();
    await draft.settled();
    expect(server.value).toBe('first and second');
    expect(draft.getState().status).toBe('saved');
  });
});

describe('flushDrafts', () => {
  it('saves drafts whose screen is closed, and records conflicts for later', async () => {
    const { server, save } = fakeServer();
    await putDraft({
      key: `${scope}:note:n1`,
      scope,
      kind: 'note',
      id: 'n1',
      value: 'closed screen edit',
      baseVersion: 1,
      updatedAt: 0,
    });
    await putDraft({
      key: `${scope}:note:n2`,
      scope,
      kind: 'note',
      id: 'n2',
      value: 'stale edit',
      baseVersion: 7,
      updatedAt: 0,
    });
    await putDraft({
      key: `${scope}:unknown:n3`,
      scope,
      kind: 'unknown',
      id: 'n3',
      value: 'no saver yet',
      baseVersion: 1,
      updatedAt: 0,
    });

    const result = await flushDrafts(scope, { note: () => save as DraftSaver<unknown> });
    expect(result).toEqual({ saved: 1, conflicts: 1, waiting: 1 });
    expect(server.value).toBe('closed screen edit');
    const left = await listDrafts(scope);
    expect(left.map((d) => d.id).sort()).toEqual(['n2', 'n3']);
    expect(left.find((d) => d.id === 'n2')?.conflict).toBeDefined();
  });

  it('lets an open screen save its own draft', async () => {
    const { server, save } = fakeServer();
    const draft = controller(save);
    const release = claimDraft(draft as DraftController<unknown>);
    online = false;
    draft.setValue('open screen edit');
    await advance(800);

    online = true;
    const result = await flushDrafts(scope, {});
    expect(result.saved).toBe(1);
    expect(server.value).toBe('open screen edit');
    release();
  });

  it('keeps each staff member apart and clears one on sign out', async () => {
    await putDraft({
      key: 'other:note:n1',
      scope: 'other',
      kind: 'note',
      id: 'n1',
      value: 'x',
      baseVersion: 1,
      updatedAt: 0,
    });
    expect(await listDrafts(scope)).toEqual([]);
    await clearDrafts('other');
    expect(await listDrafts('other')).toEqual([]);
  });
});
