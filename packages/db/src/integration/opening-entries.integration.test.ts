import { addDays, istDate, type EpisodeStatus } from '@clinic-mx/schemas';
import { and, eq, sql } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { systemActor, withActor } from '../audit';
import { createDb } from '../client';
import { insertEpisode, updateEpisodeState } from '../episodes';
import type { StaffMember } from '../identity';
import { correctOpeningEntry, insertOpeningEntry, openingEntryOf } from '../opening-entries';
import {
  appointment,
  job,
  kbVersion,
  openingEntry,
  patientPackage,
  setting,
  treatmentSession,
} from '../schema';
import { centreIds, seedStaff, seedStaffCentres } from '../seed/data';
import { becomeStaff, on, testDate, testPatient, testPhysio, typeId } from './fake-schedule';

// SCH-13 done when: name, mobile, physio, remaining sessions and package expiry entered before
// launch. User decisions, 27 October 2026: the Super Admin only, while entries are open; an Active
// episode and an opening package with no bill, used by closing a session as any package; a
// correction until it is first used; a Session booked for a patient with one open episode joins
// it. Every test runs in a transaction that is rolled back. CI database only.
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

async function asOwner(tx: Tx) {
  await tx.execute(sql`reset role`);
}

const toActive: EpisodeStatus[] = [
  'intake_pending',
  'awaiting_consultation',
  'plan_proposed',
  'active',
];

/** A treating physio at HSR Layout, and a patient whose episode there is walked to `status`. */
async function setUp(tx: Tx, status: EpisodeStatus = 'active') {
  const physio = await testPhysio(tx, {
    centreIds: [centreIds.hsrLayout],
    createdBy: superAdmin.id,
  });
  const patientId = await testPatient(tx);
  const episodeId = await insertEpisode(tx, { patientId, centreId: centreIds.hsrLayout });
  for (let step = 1; step <= toActive.indexOf(status); step++) {
    await updateEpisodeState(tx, episodeId, toActive[step - 1] as EpisodeStatus, {
      status: toActive[step] as EpisodeStatus,
      pausedFrom: null,
    });
  }
  const validUntil = addDays(istDate(new Date()), 60);
  const entry = (overrides: Partial<Parameters<typeof insertOpeningEntry>[1]> = {}) => ({
    patientId,
    episodeId,
    centreId: centreIds.hsrLayout,
    physioId: physio.id,
    sessionsLeft: 12,
    validUntil,
    by: superAdmin.id,
    ...overrides,
  });
  return { physio, patientId, episodeId, validUntil, entry };
}

const packageOf = async (tx: Tx, entryId: string) => {
  const [row] = await tx
    .select()
    .from(patientPackage)
    .where(eq(patientPackage.openingEntryId, entryId));
  return row;
};

describe('opening entries', () => {
  it('give the patient an opening package, kept in step until a closed session uses it', async () => {
    await rolledBack(async (tx) => {
      const { physio, patientId, episodeId, validUntil, entry } = await setUp(tx);
      await becomeStaff(tx, superAdmin);
      const entryId = await insertOpeningEntry(tx, entry());
      expect(await openingEntryOf(tx, patientId)).toMatchObject({
        physioName: physio.name,
        sessionsLeft: 12,
        validUntil,
        sessionsUsed: 0,
      });

      await asOwner(tx);
      const made = await packageOf(tx, entryId);
      expect(made).toMatchObject({
        patientId,
        episodeId,
        name: 'Opening package',
        sessionsTotal: 12,
        sessionsUsed: 0,
        reschedulesLeft: 1,
        validUntil,
        billId: null,
        paymentId: null,
        packageTypeId: null,
      });
      const reminder = async () =>
        (
          await tx
            .select({ runAt: job.runAt })
            .from(job)
            .where(eq(job.idempotencyKey, `package_expiry:${made?.id ?? ''}`))
        )[0]?.runAt;
      const before = await reminder();
      expect(before).toBeInstanceOf(Date);

      // A correction moves the package and its reminder with it.
      await becomeStaff(tx, superAdmin);
      const later = addDays(validUntil, 30);
      expect(
        await correctOpeningEntry(tx, entryId, {
          physioId: physio.id,
          sessionsLeft: 8,
          validUntil: later,
          by: superAdmin.id,
        }),
      ).toBe(true);
      await asOwner(tx);
      expect(await packageOf(tx, entryId)).toMatchObject({
        sessionsTotal: 8,
        reschedulesLeft: 0,
        validUntil: later,
      });
      expect((await reminder())?.getTime()).toBeGreaterThan(before?.getTime() ?? 0);

      // Closing a session of the episode uses the opening package, as any package.
      const [visit] = await tx
        .insert(appointment)
        .values({
          number: '',
          patientId,
          centreId: centreIds.hsrLayout,
          physioId: physio.id,
          appointmentTypeId: await typeId(tx, 'session'),
          episodeId,
          startsAt: on(600),
          endsAt: on(645),
          channel: 'front_desk',
          bookedBy: deskHsr.id,
          status: 'checked_in',
          arrivedAt: new Date(),
          checkedInBy: deskHsr.id,
        })
        .returning({ id: appointment.id });
      const [version] = await tx.select({ id: kbVersion.id }).from(kbVersion).limit(1);
      const [opened] = await tx
        .insert(treatmentSession)
        .values({
          appointmentId: visit?.id ?? '',
          episodeId,
          patientId,
          centreId: centreIds.hsrLayout,
          physioId: physio.id,
          number: 1,
          kbVersionId: version?.id ?? '',
        })
        .returning({ id: treatmentSession.id });
      // Closed by its own physio, as Close session does.
      await becomeStaff(tx, physio);
      const [closed] = await tx
        .update(treatmentSession)
        .set({
          status: 'signed',
          signedBy: physio.id,
          signedAt: new Date(),
          painRest: 1,
          painActivity: 2,
          painAfter: 0,
        })
        .where(eq(treatmentSession.id, opened?.id ?? ''))
        .returning({ packageId: treatmentSession.packageId });
      expect(closed?.packageId).toBe(made?.id);
      await asOwner(tx);
      expect((await packageOf(tx, entryId))?.sessionsUsed).toBe(1);

      // In use: no longer corrected.
      await becomeStaff(tx, superAdmin);
      expect(
        await failure(tx, (sp) =>
          correctOpeningEntry(sp, entryId, {
            physioId: physio.id,
            sessionsLeft: 10,
            validUntil: later,
            by: superAdmin.id,
          }),
        ),
        'in use',
      ).toBe('23514');
    });
  });

  it('keep used reschedules used, and remind again for a corrected expiry', async () => {
    await rolledBack(async (tx) => {
      const { physio, validUntil, entry } = await setUp(tx);
      await becomeStaff(tx, superAdmin);
      const entryId = await insertOpeningEntry(tx, entry({ sessionsLeft: 12 }));
      await asOwner(tx);
      const made = await packageOf(tx, entryId);
      // The patient moved a Session at their own request (SCH-10): its one reschedule is used.
      await tx
        .update(patientPackage)
        .set({ reschedulesLeft: 0 })
        .where(eq(patientPackage.id, made?.id ?? ''));
      // The reminder has already run.
      await tx
        .update(job)
        .set({ status: 'done' })
        .where(eq(job.idempotencyKey, `package_expiry:${made?.id ?? ''}`));

      const correct = async (sessionsLeft: number, until: string) => {
        await becomeStaff(tx, superAdmin);
        await correctOpeningEntry(tx, entryId, {
          physioId: physio.id,
          sessionsLeft,
          validUntil: until,
          by: superAdmin.id,
        });
        await asOwner(tx);
        return (await packageOf(tx, entryId))?.reschedulesLeft;
      };
      expect(await correct(12, validUntil), 'the physio only: still used').toBe(0);
      expect(await correct(20, validUntil), 'two allowed, one used').toBe(1);
      const later = addDays(validUntil, 30);
      await correct(20, later);
      const queued = await tx
        .select({ key: job.idempotencyKey })
        .from(job)
        .where(
          and(
            eq(job.kind, 'whatsapp.package_expiry_reminder'),
            sql`${job.payload} ->> 'packageId' = ${made?.id ?? ''}`,
            eq(job.status, 'queued'),
          ),
        );
      expect(queued.map((row) => row.key)).toEqual([`package_expiry:${made?.id ?? ''}:${later}`]);
    });
  });

  it('refuse anyone but the Super Admin, closed entries, a physio elsewhere, a past expiry and a wrong episode', async () => {
    await rolledBack(async (tx) => {
      const { physio, entry } = await setUp(tx);
      const waiting = await setUp(tx, 'plan_proposed');
      const elsewhere = await testPhysio(tx, {
        centreIds: [centreIds.koramangala],
        createdBy: superAdmin.id,
      });
      const add = (sp: Tx, overrides = {}) => insertOpeningEntry(sp, entry(overrides));

      await becomeStaff(tx, physio);
      expect(await failure(tx, (sp) => add(sp, { by: physio.id })), 'a physio').toBe('42501');
      await asOwner(tx);
      await becomeStaff(tx, deskHsr);
      expect(await failure(tx, (sp) => add(sp, { by: deskHsr.id })), 'the desk').toBe('42501');
      await asOwner(tx);
      await becomeStaff(tx, superAdmin);
      expect(await failure(tx, (sp) => add(sp, { physioId: elsewhere.id })), 'elsewhere').toBe(
        '23514',
      );
      expect(
        await failure(tx, (sp) => add(sp, { validUntil: addDays(istDate(new Date()), -1) })),
        'past expiry',
      ).toBe('23514');
      expect(await failure(tx, (sp) => insertOpeningEntry(sp, waiting.entry())), 'not Active').toBe(
        '23514',
      );

      await asOwner(tx);
      await tx
        .update(setting)
        .set({ value: false })
        .where(eq(setting.key, 'launch.opening_entries_open'));
      await becomeStaff(tx, superAdmin);
      expect(await failure(tx, (sp) => add(sp)), 'closed').toBe('23514');
      await asOwner(tx);
      await tx
        .update(setting)
        .set({ value: true })
        .where(eq(setting.key, 'launch.opening_entries_open'));

      await becomeStaff(tx, superAdmin);
      const entryId = await add(tx);
      expect(
        await failure(tx, (sp) =>
          sp
            .update(openingEntry)
            .set({ patientId: waiting.patientId })
            .where(eq(openingEntry.id, entryId)),
        ),
        'another patient',
      ).toBe('23514');
      expect(
        await failure(tx, (sp) => sp.delete(openingEntry).where(eq(openingEntry.id, entryId))),
        'never removed',
      ).toBe('42501');
    });
  });

  it('join a booked Session to the patient’s only open episode', async () => {
    await rolledBack(async (tx) => {
      const { physio, patientId, episodeId } = await setUp(tx);
      const book = async (patient: string, type: string, minutes: number) => {
        const [row] = await tx
          .insert(appointment)
          .values({
            number: '',
            patientId: patient,
            centreId: centreIds.hsrLayout,
            physioId: physio.id,
            appointmentTypeId: await typeId(tx, type),
            startsAt: on(minutes, addDays(testDate, 1)),
            endsAt: on(minutes + 45, addDays(testDate, 1)),
            channel: 'front_desk',
            bookedBy: deskHsr.id,
          })
          .returning({ episodeId: appointment.episodeId });
        return row?.episodeId;
      };
      expect(await book(patientId, 'session', 540), 'one open episode').toBe(episodeId);
      expect(await book(patientId, 'consultation', 600), 'not a session').toBeNull();
      const none = await testPatient(tx);
      expect(await book(none, 'session', 660), 'no episode').toBeNull();
      // A second open episode: which one is not guessed.
      const second = await insertEpisode(tx, { patientId, centreId: centreIds.hsrLayout });
      for (let step = 1; step < toActive.length; step++) {
        await updateEpisodeState(tx, second, toActive[step - 1] as EpisodeStatus, {
          status: toActive[step] as EpisodeStatus,
          pausedFrom: null,
        });
      }
      expect(await book(patientId, 'session', 720), 'two open episodes').toBeNull();
      const [joined] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(appointment)
        .where(and(eq(appointment.patientId, patientId), eq(appointment.episodeId, episodeId)));
      expect(joined?.n).toBe(1);
    });
  });
});
