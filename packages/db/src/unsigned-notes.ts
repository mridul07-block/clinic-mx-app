import {
  UNSIGNED_NOTES_TASK,
  nextUnsignedNotesRun,
  unsignedNotesTitle,
  type UnsignedNote,
} from '@clinic-mx/schemas';
import { and, asc, eq, sql } from 'drizzle-orm';
import { enqueueJob } from './jobs/queue';
import { appointment, centre, consultation, staffUser, task, treatmentSession } from './schema';
import type { DbOrTransaction } from './versioned';

/**
 * The unsigned notes flag (CLN-10; PRD J3.9 and section 7; TAD job table: 9:00 PM IST daily;
 * docs/runbooks/tasks.md). Every night each centre's Centre Manager gets one task listing the
 * consultation and session notes started and not yet signed, whatever day they were started;
 * tonight's task replaces last night's. The task names the visit and the physio, never the
 * patient. User decisions, 26 October 2026.
 */

export const UNSIGNED_NOTES_FLAG_JOB = 'notes.unsigned_flag';

/** Queues the flag's next night (its own key per date, so queuing twice adds nothing). */
export async function queueNextUnsignedNotesFlag(
  db: DbOrTransaction,
  date: string,
  now: Date = new Date(),
): Promise<string> {
  const next = nextUnsignedNotesRun(now, date);
  await enqueueJob(db, {
    kind: UNSIGNED_NOTES_FLAG_JOB,
    payload: { date: next.date },
    runAt: next.runAt,
    idempotencyKey: [UNSIGNED_NOTES_FLAG_JOB, next.date].join(':'),
  });
  return next.date;
}

/** Every unsigned note with its visit's centre, oldest visit first. */
export async function unsignedNotes(
  db: DbOrTransaction,
): Promise<(UnsignedNote & { centreId: string; centreName: string })[]> {
  const columns = {
    centreId: appointment.centreId,
    centreName: centre.name,
    number: appointment.number,
    physio: staffUser.name,
    startsAt: appointment.startsAt,
  };
  const consultations = await db
    .select(columns)
    .from(consultation)
    .innerJoin(appointment, eq(appointment.id, consultation.appointmentId))
    .innerJoin(centre, eq(centre.id, appointment.centreId))
    .innerJoin(staffUser, eq(staffUser.id, consultation.physioId))
    .where(eq(consultation.status, 'draft'));
  const sessions = await db
    .select(columns)
    .from(treatmentSession)
    .innerJoin(appointment, eq(appointment.id, treatmentSession.appointmentId))
    .innerJoin(centre, eq(centre.id, appointment.centreId))
    .innerJoin(staffUser, eq(staffUser.id, treatmentSession.physioId))
    .where(eq(treatmentSession.status, 'draft'));
  return [
    ...consultations.map((row) => ({ ...row, kind: 'consultation' as const })),
    ...sessions.map((row) => ({ ...row, kind: 'session' as const })),
  ]
    .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime() || a.number.localeCompare(b.number))
    .map((row) => ({ ...row, startsAt: row.startsAt.toISOString() }));
}

/**
 * The night's flag for `date`: per centre, the open task from an earlier night is closed (replaced,
 * or nothing left) and a new task lists what is unsigned. A centre already flagged for `date` is
 * left as it is, so running twice changes nothing. What it did, by centre.
 */
export async function flagUnsignedNotes(
  db: DbOrTransaction,
  date: string,
): Promise<{ centreId: string; notes: number }[]> {
  const notes = await unsignedNotes(db);
  const open = await db
    .select({ id: task.id, centreId: task.centreId, date: sql<string>`${task.details} ->> 'date'` })
    .from(task)
    .where(and(eq(task.kind, UNSIGNED_NOTES_TASK), eq(task.status, 'open')))
    .orderBy(asc(task.createdAt));
  const flaggedTonight = await db
    .select({ centreId: task.centreId })
    .from(task)
    .where(and(eq(task.kind, UNSIGNED_NOTES_TASK), sql`${task.details} ->> 'date' = ${date}`));
  const centres = new Set([
    ...notes.map((note) => note.centreId),
    ...open.flatMap((row) => (row.centreId ? [row.centreId] : [])),
  ]);
  const done: { centreId: string; notes: number }[] = [];
  for (const centreId of centres) {
    if (flaggedTonight.some((row) => row.centreId === centreId)) continue;
    const theirs = notes.filter((note) => note.centreId === centreId);
    const decision =
      theirs.length > 0 ? 'Replaced by tonight’s list.' : 'Nothing unsigned tonight.';
    for (const row of open.filter((entry) => entry.centreId === centreId)) {
      await db
        .update(task)
        .set({ status: 'closed', decision, closedAt: new Date(), updatedAt: new Date() })
        .where(and(eq(task.id, row.id), eq(task.status, 'open')));
    }
    const first = theirs.at(0);
    if (first) {
      await db.insert(task).values({
        kind: UNSIGNED_NOTES_TASK,
        title: unsignedNotesTitle(theirs.length, first.centreName),
        details: {
          date,
          notes: theirs.map(({ kind, number, physio, startsAt }) => ({
            kind,
            number,
            physio,
            startsAt,
          })),
        },
        assigneeRole: 'centre_manager',
        centreId,
      });
    }
    done.push({ centreId, notes: theirs.length });
  }
  return done;
}
