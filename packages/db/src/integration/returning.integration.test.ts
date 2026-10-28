import { randomUUID } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { patientActor, setAuditContext, systemActor, withActor } from '../audit';
import { createDb } from '../client';
import { consultationIntake } from '../consultations';
import { healthFormCarrySource, ownIntakeResponse, saveDetailsReview } from '../intake';
import { insertPatientLink } from '../patient-links';
import { appointment, auditEvent, intakeResponse } from '../schema';
import { centreIds, seedStaff } from '../seed/data';
import { becomeStaff, on, testPatient, testPhysio, typeId } from './fake-schedule';

// INT-08: a returning patient's health form carries over the details of their latest submitted
// form. Under the link's patient access the page gets only the carried keys of the same patient's
// submitted form for another visit, within the months, while its own visit is on; the review is
// recorded on its own form only, naming the same patient's submitted form. Staff never run the
// function; the consultant reads the review with the answers. Rolled back. CI database only.
const url = process.env.DIRECT_DATABASE_URL;
if (!url) throw new Error('DIRECT_DATABASE_URL is not set.');
const { db, close } = createDb(url, { max: 1 });
afterAll(close);

const superAdminId = seedStaff.find((s) => s.email === 'super.admin@clinicmx.test')?.id ?? '';
const keys = ['dominant_side', 'injuries', 'activities'];
const hsr = centreIds.hsrLayout;

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

async function becomePatient(tx: Tx, link: { id: string; patientId: string }): Promise<void> {
  await setAuditContext(tx, { actor: patientActor(link.patientId) });
  const claims = JSON.stringify({
    role: 'clinic_patient',
    patient_link: { id: link.id, patient_id: link.patientId, purpose: 'health_form' },
  });
  await tx.execute(sql`select set_config('request.jwt.claims', ${claims}, true)`);
  await tx.execute(sql`set local role clinic_patient`);
}

async function asOwner(tx: Tx): Promise<void> {
  await tx.execute(sql`reset role`);
  await tx.execute(sql`select set_config('request.jwt.claims', '', true)`);
  await setAuditContext(tx, { actor: systemActor('tests') });
}

/** A visit as the owner inserts it (the status guard checks updates only). */
async function visitOf(
  tx: Tx,
  physioId: string,
  patientId: string,
  minutes: number,
  status: 'checked_in' | 'completed' | 'booked',
) {
  const startsAt = on(minutes);
  const [row] = await tx
    .insert(appointment)
    .values({
      number: '',
      patientId,
      centreId: hsr,
      physioId,
      appointmentTypeId: await typeId(tx, 'consultation'),
      startsAt,
      endsAt: new Date(startsAt.getTime() + 45 * 60_000),
      channel: 'front_desk',
      bookedBy: superAdminId,
      status,
      ...(status === 'booked' ? {} : { arrivedAt: startsAt, checkedInBy: superAdminId }),
    })
    .returning({ id: appointment.id });
  if (!row) throw new Error('no appointment');
  return row.id;
}

/** A health form for a visit, as the owner: submitted at `submittedAt`, or still open. */
async function formOf(
  tx: Tx,
  patientId: string,
  appointmentId: string,
  answers: Record<string, unknown>,
  submittedAt: Date | null,
) {
  const [row] = await tx
    .insert(intakeResponse)
    .values({
      appointmentId,
      patientId,
      patientLinkId: randomUUID(),
      formVersion: 'hf-3',
      answers: answers as never,
      doneScreens: ['consent'],
      submittedAt,
    })
    .returning({ id: intakeResponse.id });
  if (!row) throw new Error('no form');
  return row.id;
}

const monthsAgo = (months: number) => new Date(Date.now() - months * 30.5 * 86_400_000);

/**
 * A returning patient: a submitted form three months ago, an older one, today's visit checked in
 * with its link and a form started (Part A done); another patient's submitted form too.
 */
async function returning(tx: Tx) {
  const physio = await testPhysio(tx, { centreIds: [hsr], createdBy: superAdminId });
  const patientId = await testPatient(tx);
  const otherId = await testPatient(tx);
  const earlierVisit = await visitOf(tx, physio.id, patientId, 540, 'completed');
  const earlier = await formOf(
    tx,
    patientId,
    earlierVisit,
    { dominant_side: 'left', injuries: 'Ankle sprain', region: 'knee', night_pain: true },
    monthsAgo(3),
  );
  const older = await formOf(
    tx,
    patientId,
    await visitOf(tx, physio.id, patientId, 480, 'completed'),
    { dominant_side: 'right' },
    monthsAgo(30),
  );
  const theirs = await formOf(
    tx,
    otherId,
    await visitOf(tx, physio.id, otherId, 600, 'completed'),
    { dominant_side: 'right' },
    monthsAgo(1),
  );
  const today = await visitOf(tx, physio.id, patientId, 660, 'checked_in');
  const link = await insertPatientLink(tx, {
    patientId,
    purpose: 'health_form',
    appointmentId: today,
    expiresAt: new Date(Date.now() + 3_600_000),
  });
  const current = await formOf(tx, patientId, today, {}, null);
  return { physio, patientId, otherId, earlier, older, theirs, today, link, current };
}

describe('a returning patient’s health form under row level security', () => {
  it('gets only the carried keys of their own latest submitted form for another visit', async () => {
    await rolledBack(async (tx) => {
      const { patientId, earlier, older, theirs, link } = await returning(tx);
      await becomePatient(tx, { id: link.id, patientId });
      const source = await healthFormCarrySource(tx, keys, 24);
      // The problem and warning sign answers never leave the database.
      expect(source).toEqual({
        id: earlier,
        submittedAt: expect.any(Date) as Date,
        answers: { dominant_side: 'left', injuries: 'Ankle sprain' },
      });
      // Within the months only: the three months old form is too old for two.
      expect(await healthFormCarrySource(tx, keys, 2)).toBeUndefined();
      // The one chosen, whatever its age; never another patient's.
      expect((await healthFormCarrySource(tx, keys, 2, older))?.id).toBe(older);
      expect(await healthFormCarrySource(tx, keys, 24, theirs)).toBeUndefined();
    });
  });

  it('gets nothing unsubmitted, from the same visit, or once the visit is not on', async () => {
    await rolledBack(async (tx) => {
      const { patientId, earlier, older, link, today, current } = await returning(tx);
      await tx
        .update(intakeResponse)
        .set({ submittedAt: null })
        .where(eq(intakeResponse.id, earlier));
      await tx
        .update(intakeResponse)
        .set({ submittedAt: null })
        .where(eq(intakeResponse.id, older));
      // Today's own form, submitted, is not an earlier one.
      await tx
        .update(intakeResponse)
        .set({ submittedAt: new Date() })
        .where(eq(intakeResponse.id, current));
      await becomePatient(tx, { id: link.id, patientId });
      expect(await healthFormCarrySource(tx, keys, 24)).toBeUndefined();
      await asOwner(tx);
      await tx
        .update(intakeResponse)
        .set({ submittedAt: monthsAgo(3) })
        .where(eq(intakeResponse.id, earlier));
      await tx.update(appointment).set({ status: 'completed' }).where(eq(appointment.id, today));
      await becomePatient(tx, { id: link.id, patientId });
      expect(await healthFormCarrySource(tx, keys, 24)).toBeUndefined();
    });
  });

  it('records the review on the patient’s own form, naming only their own submitted form', async () => {
    await rolledBack(async (tx) => {
      const { patientId, earlier, theirs, link, current } = await returning(tx);
      await becomePatient(tx, { id: link.id, patientId });
      const review = {
        detailsChanged: false,
        answers: { dominant_side: 'left' },
        doneScreens: ['consent', 'history'],
      };
      // Another patient's form, or the review without the form, is refused.
      expect(
        await failure(tx, (sp) => saveDetailsReview(sp, { ...review, carriedFromId: theirs })),
      ).toBe('23514');
      expect(
        await failure(tx, (sp) =>
          sp
            .update(intakeResponse)
            .set({ detailsChanged: true })
            .where(eq(intakeResponse.id, current)),
        ),
      ).toBe('23514');
      expect(await saveDetailsReview(tx, { ...review, carriedFromId: earlier })).toBe(true);
      expect(await ownIntakeResponse(tx)).toMatchObject({
        carriedFromId: earlier,
        detailsChanged: false,
        answers: { dominant_side: 'left' },
      });
      await asOwner(tx);
      const [audited] = await tx
        .select({ actor: auditEvent.actor })
        .from(auditEvent)
        .where(
          and(
            eq(auditEvent.entity, 'intake_response'),
            eq(auditEvent.entityId, current),
            sql`${auditEvent.after} ->> 'details_changed' = 'false'`,
          ),
        );
      expect(audited?.actor).toBe(patientActor(patientId));
      // Once submitted, the review stays as it is.
      await tx
        .update(intakeResponse)
        .set({ submittedAt: new Date() })
        .where(eq(intakeResponse.id, current));
      await becomePatient(tx, { id: link.id, patientId });
      expect(
        await saveDetailsReview(tx, { ...review, detailsChanged: true, carriedFromId: earlier }),
      ).toBe(false);
    });
  });

  it('is never run by staff; the consultant reads the review with the answers', async () => {
    await rolledBack(async (tx) => {
      const { physio, earlier, today, current } = await returning(tx);
      await tx
        .update(intakeResponse)
        .set({ carriedFromId: earlier, detailsChanged: true, submittedAt: new Date() })
        .where(eq(intakeResponse.id, current));
      await becomeStaff(tx, physio);
      expect(
        await failure(tx, (sp) =>
          sp.execute(
            sql`select * from internal.health_form_carry_source(${`{${keys.join(',')}}`}::text[], 24, null)`,
          ),
        ),
      ).toBe('42501');
      const read = await consultationIntake(tx, today);
      expect(read?.detailsReview).toEqual({
        changed: true,
        carriedFromAt: expect.any(Date) as Date,
      });
    });
  });
});
