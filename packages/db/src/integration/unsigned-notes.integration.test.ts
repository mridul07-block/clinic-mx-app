import { UNSIGNED_NOTES_TASK, addDays, earlierToday, istDate } from '@clinic-mx/schemas';
import { and, eq, sql } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { systemActor, withActor } from '../audit';
import { createDb } from '../client';
import { insertEpisode } from '../episodes';
import type { StaffMember } from '../identity';
import { inboxTasks } from '../tasks';
import { appointment, consultation, job, task, treatmentSession } from '../schema';
import { centreIds, seedStaff, seedStaffCentres } from '../seed/data';
import {
  UNSIGNED_NOTES_FLAG_JOB,
  flagUnsignedNotes,
  queueNextUnsignedNotesFlag,
} from '../unsigned-notes';
import { becomeStaff, testPatient, testPhysio, typeId } from './fake-schedule';

// CLN-10: every night each centre's Centre Manager gets one task listing the consultation and
// session notes started and not signed, any day; tonight's replaces last night's; a second run of
// a night changes nothing; the next night is queued once. Every test runs in a transaction that is
// rolled back. CI database only.
const url = process.env.DIRECT_DATABASE_URL;
if (!url) throw new Error('DIRECT_DATABASE_URL is not set.');
const { db, close } = createDb(url, { max: 1 });
afterAll(close);

function member(email: string): StaffMember {
  const row = seedStaff.find((s) => s.email === email);
  if (!row?.id) throw new Error(`seed has no ${email}`);
  const id = row.id;
  return {
    id,
    email: row.email,
    name: row.name,
    role: row.role,
    treatsPatients: row.treatsPatients ?? false,
    consultant: row.consultant ?? false,
    centreIds: seedStaffCentres.filter((c) => c.staffUserId === id).map((c) => c.centreId),
    support: row.velyxSupport ?? false,
  };
}
const superAdmin = member('super.admin@clinicmx.test');
const manager = member('manager@clinicmx.test');

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
class Rollback extends Error {}

async function rolledBack(work: (tx: Tx) => Promise<void>): Promise<void> {
  try {
    await withActor(db, systemActor('tests'), async (tx) => {
      await work(tx);
      throw new Rollback();
    });
  } catch (error) {
    if (!(error instanceof Rollback)) throw error;
  }
}

/** A night far ahead, so the flag's own tasks from other nights never mix in. */
const night = addDays(istDate(new Date()), 400);

/** Only this test's drafts count: earlier rows in the database stay out of the comparison. */
async function clearDrafts(tx: Tx) {
  await tx.execute(sql`update task set status = 'closed', decision = 'Test setup', closed_at = now()
    where kind = ${UNSIGNED_NOTES_TASK} and status = 'open'`);
}

/** A started visit with a draft note of `kind` at a centre, with the physio's name on it. */
async function draft(
  tx: Tx,
  kind: 'consultation' | 'session',
  centreId: string,
  kbVersionId: string,
  minutesAgo: number,
) {
  const physio = await testPhysio(tx, { centreIds: [centreId], createdBy: superAdmin.id });
  const patientId = await testPatient(tx);
  const episodeId = await insertEpisode(tx, { patientId, centreId });
  const startsAt = earlierToday(minutesAgo);
  const [visit] = await tx
    .insert(appointment)
    .values({
      number: '',
      patientId,
      centreId,
      physioId: physio.id,
      appointmentTypeId: await typeId(tx, kind),
      episodeId,
      startsAt,
      endsAt: new Date(startsAt.getTime() + 45 * 60_000),
      channel: 'front_desk',
      bookedBy: superAdmin.id,
      status: 'in_progress',
      arrivedAt: startsAt,
      checkedInBy: superAdmin.id,
      startedAt: startsAt,
      startedBy: physio.id,
    })
    .returning({ id: appointment.id, number: appointment.number });
  if (!visit) throw new Error('no visit');
  if (kind === 'consultation') {
    await tx.insert(consultation).values({
      appointmentId: visit.id,
      episodeId,
      physioId: physio.id,
      kbVersionId,
      sections: {},
    });
  } else {
    await tx.insert(treatmentSession).values({
      appointmentId: visit.id,
      physioId: physio.id,
      kbVersionId,
      episodeId: sql`null`,
      patientId: sql`null`,
      centreId: sql`null`,
      number: 1,
      note: {},
    });
  }
  return { number: visit.number, physio: physio.name, appointmentId: visit.id };
}

async function knowledgeVersion(tx: Tx) {
  const [version] = await tx.execute<{ id: string }>(
    sql`insert into kb_version (number, source, report, created_by)
      select coalesce(max(number), 0) + 1, '{}'::jsonb, '{}'::jsonb, 'tests' from kb_version
      returning id`,
  );
  return version?.id ?? '';
}

const tasksOf = (tx: Tx, centreId: string) =>
  tx
    .select({
      title: task.title,
      status: task.status,
      decision: task.decision,
      role: task.assigneeRole,
      details: task.details,
    })
    .from(task)
    .where(and(eq(task.kind, UNSIGNED_NOTES_TASK), eq(task.centreId, centreId)))
    .orderBy(task.createdAt);

describe('the unsigned notes flag', () => {
  it('gives each centre’s manager one task listing its unsigned notes, without patients', async () => {
    await rolledBack(async (tx) => {
      await clearDrafts(tx);
      const kb = await knowledgeVersion(tx);
      const older = await draft(tx, 'session', centreIds.hsrLayout, kb, 26 * 60);
      const today = await draft(tx, 'consultation', centreIds.hsrLayout, kb, 30);
      const elsewhere = await draft(tx, 'session', centreIds.koramangala, kb, 60);
      // A signed note is left out.
      const signed = await draft(tx, 'session', centreIds.hsrLayout, kb, 90);
      await tx.execute(sql`update session set status = 'signed', signed_at = now(), pain_rest = 2,
        pain_activity = 3, pain_after = 1,
        signed_by = physio_id where appointment_id = ${signed.appointmentId}`);

      await flagUnsignedNotes(tx, night);
      const [hsr] = await tasksOf(tx, centreIds.hsrLayout);
      const notes = (hsr?.details as { notes: { number: string }[] }).notes.map((n) => n.number);
      expect(notes).toEqual(expect.arrayContaining([older.number, today.number]));
      expect(notes).not.toContain(signed.number);
      expect(notes).not.toContain(elsewhere.number);
      expect(hsr?.title).toBe(`Unsigned notes: ${String(notes.length)} at HSR Layout`);
      expect(hsr?.role).toBe('centre_manager');
      expect(JSON.stringify(hsr?.details)).not.toMatch(/Test Patient/);
      const [koramangala] = await tasksOf(tx, centreIds.koramangala);
      expect(JSON.stringify(koramangala?.details)).toContain(elsewhere.number);

      // The manager at HSR Layout reads it in their inbox.
      await becomeStaff(tx, manager);
      const inbox = await inboxTasks(tx);
      expect(inbox.some((entry) => entry.kind === UNSIGNED_NOTES_TASK)).toBe(
        manager.centreIds.includes(centreIds.hsrLayout),
      );
    });
  });

  it('changes nothing the second time a night runs; the next night replaces or closes it', async () => {
    await rolledBack(async (tx) => {
      await clearDrafts(tx);
      const kb = await knowledgeVersion(tx);
      const left = await draft(tx, 'consultation', centreIds.whitefield, kb, 45);
      await flagUnsignedNotes(tx, night);
      await flagUnsignedNotes(tx, night);
      expect(await tasksOf(tx, centreIds.whitefield)).toHaveLength(1);

      // The next night: still unsigned, so a new list replaces it.
      await flagUnsignedNotes(tx, addDays(night, 1));
      const [first, second] = await tasksOf(tx, centreIds.whitefield);
      expect(first).toMatchObject({ status: 'closed', decision: 'Replaced by tonight’s list.' });
      expect(second?.status).toBe('open');

      // Signed by the night after: nothing unsigned, so the open one closes and none is added.
      await tx.execute(sql`delete from consultation where appointment_id = ${left.appointmentId}`);
      await flagUnsignedNotes(tx, addDays(night, 2));
      const after = await tasksOf(tx, centreIds.whitefield);
      expect(after).toHaveLength(2);
      expect(after[1]).toMatchObject({ status: 'closed', decision: 'Nothing unsigned tonight.' });
    });
  });

  it('queues the next night once', async () => {
    await rolledBack(async (tx) => {
      const next = await queueNextUnsignedNotesFlag(tx, night);
      await queueNextUnsignedNotesFlag(tx, night);
      expect(next).toBe(addDays(night, 1));
      const queued = await tx
        .select({ payload: job.payload })
        .from(job)
        .where(eq(job.idempotencyKey, [UNSIGNED_NOTES_FLAG_JOB, next].join(':')));
      expect(queued).toEqual([{ payload: { date: next } }]);
    });
  });
});
