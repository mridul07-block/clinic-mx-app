import { istDate } from '@clinic-mx/schemas';
import { and, eq, sql } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { systemActor, withActor } from '../audit';
import { createDb } from '../client';
import { insertEpisode } from '../episodes';
import type { StaffMember } from '../identity';
import { insertRedFlagAlerts } from '../clinical';
import { myPatientsToday, startVisit } from '../my-patients';
import { insertPatientLink } from '../patient-links';
import { appointment, auditEvent, consentRecord, patientLink, redFlagAlert } from '../schema';
import { centreIds, seedStaff, seedStaffCentres } from '../seed/data';
import { becomeStaff, testPatient, testPhysio, typeId } from './fake-schedule';

// CLN-01 done when: a physio's own visits today in time order with status, form status and
// alerts; Start marks their checked in visit In progress, and nobody else's (user decision 24
// October 2026). Under row level security as the physio, in transactions rolled back. CI only.
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
const deskHsr = member('desk.hsr@clinicmx.test');

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

/** The Postgres error code a statement failed with, inside a savepoint. */
async function failure(tx: Tx, work: (sp: Tx) => Promise<unknown>): Promise<string | undefined> {
  try {
    await tx.transaction(async (sp) => {
      await work(sp);
    });
  } catch (error) {
    const cause = (error as { cause?: { code?: string }; code?: string }).cause;
    return cause?.code ?? (error as { code?: string }).code;
  }
  return undefined;
}

/** Two physios at HSR Layout and a way to give them visits that start `minutesFromNow`. */
async function setUp(tx: Tx) {
  const session = await typeId(tx, 'session');
  const physio = await testPhysio(tx, {
    centreIds: [centreIds.hsrLayout],
    createdBy: superAdmin.id,
  });
  const other = await testPhysio(tx, {
    centreIds: [centreIds.hsrLayout],
    createdBy: superAdmin.id,
  });
  const visit = async (
    physioId: string,
    minutesFromNow: number,
    values: Partial<typeof appointment.$inferInsert> = {},
  ) => {
    const patientId = values.patientId ?? (await testPatient(tx));
    const startsAt = new Date(Date.now() + minutesFromNow * 60000);
    const [row] = await tx
      .insert(appointment)
      .values({
        number: '',
        patientId,
        centreId: centreIds.hsrLayout,
        physioId,
        appointmentTypeId: session,
        startsAt,
        endsAt: new Date(startsAt.getTime() + 60000),
        channel: 'front_desk',
        bookedBy: superAdmin.id,
        ...values,
      })
      .returning({ id: appointment.id, patientId: appointment.patientId });
    if (!row) throw new Error('The appointment was not recorded.');
    return row;
  };
  const checkedIn = {
    status: 'checked_in' as const,
    arrivedAt: new Date(),
    checkedInBy: deskHsr.id,
  };
  return { physio, other, visit, checkedIn };
}

const statusOf = async (tx: Tx, id: string) =>
  (
    await tx.select({ status: appointment.status }).from(appointment).where(eq(appointment.id, id))
  )[0]?.status;

describe('my patients today', () => {
  it('lists the physio’s own visits today in time order, with form status and open alerts', async () => {
    await rolledBack(async (tx) => {
      const { physio, other, visit, checkedIn } = await setUp(tx);
      const later = await visit(physio.id, 3);
      const here = await visit(physio.id, -3, checkedIn);
      const declined = await visit(physio.id, -2, checkedIn);
      const cancelled = await visit(physio.id, -1, {
        status: 'cancelled',
        changeReason: 'patient',
        changedAt: new Date(),
        changedBy: deskHsr.id,
      });
      const theirs = await visit(other.id, -4);

      // The checked in one submitted its form, which opened the episode, with two alerts.
      const episodeId = await insertEpisode(tx, {
        patientId: here.patientId,
        centreId: centreIds.hsrLayout,
      });
      await tx.update(appointment).set({ episodeId }).where(eq(appointment.id, here.id));
      const link = await insertPatientLink(tx, {
        patientId: here.patientId,
        purpose: 'health_form',
        appointmentId: here.id,
        expiresAt: new Date(Date.now() + 3600_000),
      });
      await tx
        .update(patientLink)
        .set({ completedAt: new Date() })
        .where(eq(patientLink.id, link.id));
      const [version] = await tx.execute<{ id: string }>(
        sql`insert into kb_version (number, source, report, created_by)
          select coalesce(max(number), 0) + 1, '{}'::jsonb, '{}'::jsonb, 'tests' from kb_version
          returning id`,
      );
      const alert = {
        episodeId,
        appointmentId: here.id,
        kbVersionId: version?.id ?? '',
        triage: 'urgent_medical_referral' as const,
        display: 'review' as const,
        action: 'Refer.',
        signedOff: false,
      };
      await insertRedFlagAlerts(tx, [
        { ...alert, ruleKey: 'test.open', name: 'Open' },
        { ...alert, ruleKey: 'test.closed', name: 'Closed' },
      ]);
      // A clinician reviews and closes one (ALT-01 allows only them).
      const closing = eq(redFlagAlert.ruleKey, 'test.closed');
      await becomeStaff(tx, physio);
      await tx
        .update(redFlagAlert)
        .set({ status: 'reviewed', reviewedBy: physio.id, reviewedAt: new Date() })
        .where(closing);
      await tx
        .update(redFlagAlert)
        .set({ status: 'closed', decision: 'Seen', closedBy: physio.id, closedAt: new Date() })
        .where(closing);
      await tx.execute(sql`reset role`);
      // The other one declined a Part A statement on its form.
      await insertPatientLink(tx, {
        patientId: declined.patientId,
        purpose: 'health_form',
        appointmentId: declined.id,
        expiresAt: new Date(Date.now() + 3600_000),
      });
      await tx.insert(consentRecord).values({
        patientId: declined.patientId,
        appointmentId: declined.id,
        stage: 'A',
        statementKey: 'test.statement',
        statementVersion: 1,
        accepted: false,
        signer: 'patient',
      });

      await becomeStaff(tx, physio);
      const visits = await myPatientsToday(tx, { staffId: physio.id, date: istDate(new Date()) });
      expect(visits.map((v) => v.id)).toEqual([here.id, declined.id, later.id]);
      expect(visits.map((v) => v.id)).not.toContain(cancelled.id);
      expect(visits.map((v) => v.id)).not.toContain(theirs.id);
      expect(visits[0]).toMatchObject({ status: 'checked_in', openAlerts: 1, episodeId });
      expect(visits[0]?.alertDisplays).toEqual(['review']);
      expect(visits[0]?.healthForm?.completedAt).toBeInstanceOf(Date);
      expect(visits[1]).toMatchObject({ consentDeclined: true, openAlerts: 0, alertDisplays: [] });
      expect(visits[1]?.healthForm?.completedAt).toBeNull();
      expect(visits[2]?.healthForm).toBeUndefined();

      // The other physio reads none of it.
      await becomeStaff(tx, other);
      expect(
        (await myPatientsToday(tx, { staffId: physio.id, date: istDate(new Date()) })).length,
      ).toBe(0);
    });
  });

  it('starts the physio’s own checked in visit, In progress as them', async () => {
    await rolledBack(async (tx) => {
      const { physio, visit, checkedIn } = await setUp(tx);
      const here = await visit(physio.id, -3, checkedIn);
      await becomeStaff(tx, physio);
      const now = new Date();
      expect(await startVisit(tx, { appointmentId: here.id, by: physio.id, now })).toEqual({
        id: here.id,
      });
      expect(await startVisit(tx, { appointmentId: here.id, by: physio.id, now })).toBeUndefined();
      await tx.execute(sql`reset role`);
      const [row] = await tx
        .select({ status: appointment.status, startedBy: appointment.startedBy })
        .from(appointment)
        .where(eq(appointment.id, here.id));
      expect(row).toEqual({ status: 'in_progress', startedBy: physio.id });
      const audited = await tx
        .select({ actor: auditEvent.actor })
        .from(auditEvent)
        .where(and(eq(auditEvent.entity, 'appointment'), eq(auditEvent.entityId, here.id)));
      expect(audited.map((a) => a.actor)).toContain(`staff:${physio.id}`);
    });
  });

  it('is refused before check in, on another day, for someone else, and for any other change', async () => {
    await rolledBack(async (tx) => {
      const { physio, other, visit, checkedIn } = await setUp(tx);
      const booked = await visit(physio.id, 3);
      const here = await visit(physio.id, -3, checkedIn);
      const yesterday = await visit(physio.id, -24 * 60, checkedIn);
      const start = (by: string) => ({
        status: 'in_progress' as const,
        startedAt: new Date(),
        startedBy: by,
      });
      const set = (id: string, values: Partial<typeof appointment.$inferInsert>) => (sp: Tx) =>
        sp.update(appointment).set(values).where(eq(appointment.id, id));

      // The desk may change appointments, but never starts one, nor one not checked in.
      await becomeStaff(tx, deskHsr);
      expect(await failure(tx, set(here.id, start(deskHsr.id)))).toBe('23514');
      expect(await failure(tx, set(booked.id, start(physio.id)))).toBe('23514');

      await becomeStaff(tx, physio);
      expect(await failure(tx, set(yesterday.id, start(physio.id)))).toBe('23514');
      expect(await failure(tx, set(booked.id, start(physio.id)))).toBe('42501');
      expect(await failure(tx, set(here.id, { confirmedAt: new Date() }))).toBe('42501');
      expect(
        await failure(tx, set(here.id, { ...start(physio.id), confirmedAt: new Date() })),
      ).toBe('42501');

      // Another physio's update reaches nothing.
      await becomeStaff(tx, other);
      const reached = await tx
        .update(appointment)
        .set(start(other.id))
        .where(eq(appointment.id, here.id))
        .returning({ id: appointment.id });
      expect(reached).toEqual([]);

      // Started, it goes on only to Completed.
      await becomeStaff(tx, physio);
      await startVisit(tx, { appointmentId: here.id, by: physio.id, now: new Date() });
      await becomeStaff(tx, deskHsr);
      expect(
        await failure(tx, set(here.id, { status: 'checked_in', startedAt: null, startedBy: null })),
      ).toBe('23514');
      await tx.execute(sql`reset role`);
      expect(await statusOf(tx, here.id)).toBe('in_progress');
    });
  });
});
