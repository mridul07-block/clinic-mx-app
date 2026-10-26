import 'server-only';
import { flagUnsignedNotes, queueNextUnsignedNotesFlag, type Db } from '@clinic-mx/db';
import { z } from 'zod';
import { systemService } from '../access/service';

/**
 * The unsigned notes flag (CLN-10; docs/runbooks/tasks.md): the nightly job queues the next night
 * first, in its own transaction, so a failed night never breaks the chain; then each centre's
 * Centre Manager gets the night's list of unsigned notes, replacing last night's task.
 */

const night = z.object({ date: z.iso.date() });

const queueNext = systemService({
  component: 'notes',
  input: night,
  run: (tx, { date }) => queueNextUnsignedNotesFlag(tx, date),
});

const flag = systemService({
  component: 'notes',
  input: night,
  run: (tx, { date }) => flagUnsignedNotes(tx, date),
});

/** The night's run: the next night queued, then the flag. */
export async function runUnsignedNotesFlag(db: Db, input: { date: string }) {
  await queueNext(db, input);
  return flag(db, input);
}
