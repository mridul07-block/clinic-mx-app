import type { Db } from '@clinic-mx/db';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { runUnsignedNotesFlag } from './unsigned-notes';

const fakeTx = { kind: 'transaction' };
const db = vi.hoisted(() => ({
  systemActor: vi.fn((component: string) => `system:${component}`),
  withActor: vi.fn(),
  flagUnsignedNotes: vi.fn(),
  queueNextUnsignedNotesFlag: vi.fn(),
}));
vi.mock('@clinic-mx/db', () => db);

// CLN-10: the night's run queues the next night first, in its own transaction, so a failed night
// never breaks the chain; then it flags.
describe('the unsigned notes flag run', () => {
  const order: string[] = [];
  beforeEach(() => {
    order.length = 0;
    for (const fn of Object.values(db)) fn.mockReset();
    db.systemActor.mockImplementation((component: string) => `system:${component}`);
    db.withActor.mockImplementation((_db: Db, actor: string, work: (tx: unknown) => unknown) => {
      order.push(`transaction as ${actor}`);
      return work(fakeTx);
    });
    db.queueNextUnsignedNotesFlag.mockImplementation(() => {
      order.push('queue next');
      return Promise.resolve('2026-11-03');
    });
    db.flagUnsignedNotes.mockImplementation(() => {
      order.push('flag');
      return Promise.resolve([]);
    });
  });

  it('queues the next night, then flags, each as the notes system', async () => {
    await runUnsignedNotesFlag({} as Db, { date: '2026-11-02' });
    expect(order).toEqual([
      'transaction as system:notes',
      'queue next',
      'transaction as system:notes',
      'flag',
    ]);
    expect(db.queueNextUnsignedNotesFlag).toHaveBeenCalledWith(fakeTx, '2026-11-02');
    expect(db.flagUnsignedNotes).toHaveBeenCalledWith(fakeTx, '2026-11-02');
  });

  it('keeps the next night queued when the flag fails', async () => {
    db.flagUnsignedNotes.mockRejectedValueOnce(new Error('database unavailable'));
    await expect(runUnsignedNotesFlag({} as Db, { date: '2026-11-02' })).rejects.toThrow(
      'database unavailable',
    );
    expect(db.queueNextUnsignedNotesFlag).toHaveBeenCalledTimes(1);
  });
});
