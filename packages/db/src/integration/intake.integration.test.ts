import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { patientActor, setAuditContext, systemActor, withActor } from '../audit';
import { createDb } from '../client';
import {
  insertConsentRecords,
  ownConsentDecisions,
  ownGuardians,
  partAConsentDeclined,
} from '../consent';
import { insertGuardian, removeGuardian } from '../patients';
import { insertPatientReport } from '../check-in';
import {
  enqueueIntakeSubmitted,
  insertNotifications,
  insertPrecautions,
  insertRedFlagAlerts,
  markNotificationsRead,
  myNotifications,
  unreadNotificationCount,
} from '../clinical';
import { insertEpisode } from '../episodes';
import { latestKnowledgeVersion } from '../knowledge';
import {
  healthFormVisit,
  ownIntakeResponse,
  ownReports,
  saveIntakeResponse,
  submitIntakeResponse,
} from '../intake';
import { completePatientLinkRow, insertPatientLink } from '../patient-links';
import {
  appointment,
  auditEvent,
  centre,
  consentRecord,
  guardian,
  intakeResponse,
  job,
  notification,
  patient,
  patientLink,
  patientReport,
  precaution,
  redFlagAlert,
  staffUser,
} from '../schema';
import { centreIds, seedStaff } from '../seed/data';
import { bookAppointment } from '../slots';
import type { StaffMember } from '../identity';
import { becomeStaff, on, testPatient, testPhysio, typeId } from './fake-schedule';

// INT-03: a health form link reaches the form for its own appointment only. Under the link's
// patient access the page reads that appointment, the patient's name, its centre and its physio,
// and nothing else: no other appointment (the same patient's included), no other patient, centre
// or staff member, no column beyond the grant, and no change. Rolled back. CI database only.
const url = process.env.DIRECT_DATABASE_URL;
if (!url) throw new Error('DIRECT_DATABASE_URL is not set.');
const { db, close } = createDb(url, { max: 1 });
afterAll(close);

const superAdminId = seedStaff.find((s) => s.email === 'super.admin@clinicmx.test')?.id ?? '';

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
class Rollback extends Error {}

/** Runs `work` as the test system (the owner, audited), in a transaction always rolled back. */
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

/** From here on, read as the patient behind `link`, the way `withPatientAccess` does. */
async function becomePatient(
  tx: Tx,
  link: { id: string; patientId: string; purpose: string },
): Promise<void> {
  await setAuditContext(tx, { actor: patientActor(link.patientId) });
  const claims = JSON.stringify({
    role: 'clinic_patient',
    patient_link: { id: link.id, patient_id: link.patientId, purpose: link.purpose },
  });
  await tx.execute(sql`select set_config('request.jwt.claims', ${claims}, true)`);
  await tx.execute(sql`set local role clinic_patient`);
}

/** Two patients, three visits with a test physio at HSR, and a health form link for the first. */
async function visits(tx: Tx) {
  const physio = await testPhysio(tx, {
    centreIds: [centreIds.hsrLayout],
    createdBy: superAdminId,
  });
  const session = await typeId(tx, 'session');
  const patientId = await testPatient(tx);
  const otherPatientId = await testPatient(tx);
  const book = (forPatient: string, minutes: number) =>
    bookAppointment(tx, {
      centreId: centreIds.hsrLayout,
      physioId: physio.id,
      appointmentTypeId: session,
      patientId: forPatient,
      channel: 'front_desk',
      bookedBy: superAdminId,
      holder: 'test:intake',
      startsAt: on(minutes),
      step: 15,
      now: new Date(),
    });
  const mine = await book(patientId, 600);
  const later = await book(patientId, 720);
  const theirs = await book(otherPatientId, 660);
  const link = await insertPatientLink(tx, {
    patientId,
    purpose: 'health_form',
    appointmentId: mine.id,
    expiresAt: new Date(Date.now() + 3_600_000),
  });
  const [names] = await tx
    .select({ patientName: patient.name, centreName: centre.name })
    .from(patient)
    .innerJoin(centre, eq(centre.id, centreIds.hsrLayout))
    .where(eq(patient.id, patientId));
  return { physio, patientId, mine, later, theirs, link, names };
}

describe('a health form link under row level security', () => {
  it('reads its own visit: the appointment, the patient name, the centre and the physio', async () => {
    await rolledBack(async (tx) => {
      const { physio, patientId, mine, link, names } = await visits(tx);
      await becomePatient(tx, { id: link.id, patientId, purpose: 'health_form' });
      expect(await healthFormVisit(tx)).toEqual({
        appointmentId: mine.id,
        status: 'booked',
        startsAt: on(600),
        patientName: names?.patientName,
        dateOfBirth: null,
        sex: null,
        occupation: null,
        centreName: names?.centreName,
        physioName: physio.name,
      });
      expect(await tx.select({ id: patient.id }).from(patient)).toEqual([{ id: patientId }]);
      expect(await tx.select({ id: centre.id }).from(centre)).toEqual([
        { id: centreIds.hsrLayout },
      ]);
      expect(await tx.select({ id: staffUser.id }).from(staffUser)).toEqual([{ id: physio.id }]);
    });
  });

  it('reads no other appointment, not even the same patient’s next visit', async () => {
    await rolledBack(async (tx) => {
      const { patientId, mine, link } = await visits(tx);
      await becomePatient(tx, { id: link.id, patientId, purpose: 'health_form' });
      expect(await tx.select({ id: appointment.id }).from(appointment)).toEqual([{ id: mine.id }]);
    });
  });

  it('reads no column beyond the grant and changes nothing', async () => {
    await rolledBack(async (tx) => {
      const { patientId, mine, link } = await visits(tx);
      await becomePatient(tx, { id: link.id, patientId, purpose: 'health_form' });
      expect(await failure(tx, (sp) => sp.select({ phone: patient.phone }).from(patient))).toBe(
        '42501',
      );
      expect(await failure(tx, (sp) => sp.select({ email: staffUser.email }).from(staffUser))).toBe(
        '42501',
      );
      expect(
        await failure(tx, (sp) =>
          sp.update(appointment).set({ status: 'cancelled' }).where(eq(appointment.id, mine.id)),
        ),
      ).toBe('42501');
    });
  });

  it('reaches no visit through a link without an appointment', async () => {
    await rolledBack(async (tx) => {
      const { patientId } = await visits(tx);
      const plan = await insertPatientLink(tx, {
        patientId,
        purpose: 'my_plan',
        episodeId: crypto.randomUUID(),
        expiresAt: new Date(Date.now() + 3_600_000),
      });
      await becomePatient(tx, { id: plan.id, patientId, purpose: 'my_plan' });
      expect(await healthFormVisit(tx)).toBeUndefined();
      expect(await tx.select({ id: appointment.id }).from(appointment)).toEqual([]);
      expect(await tx.select({ id: staffUser.id }).from(staffUser)).toEqual([]);
    });
  });
});

/** A visit already checked in (inserted as the owner: the status guard checks updates only). */
async function checkedIn(tx: Tx, physioId: string, patientId: string, minutes: number) {
  const startsAt = on(minutes);
  const [row] = await tx
    .insert(appointment)
    .values({
      number: '',
      patientId,
      centreId: centreIds.hsrLayout,
      physioId,
      appointmentTypeId: await typeId(tx, 'session'),
      startsAt,
      endsAt: new Date(startsAt.getTime() + 45 * 60_000),
      channel: 'front_desk',
      bookedBy: superAdminId,
      status: 'checked_in',
      arrivedAt: new Date(),
      checkedInBy: superAdminId,
    })
    .returning({ id: appointment.id });
  if (!row) throw new Error('no appointment');
  return row.id;
}

const form = (link: { id: string }, appointmentId: string, patientId: string) => ({
  appointmentId,
  patientId,
  patientLinkId: link.id,
  formVersion: 'hf-1',
  answers: { region: 'back' },
  doneScreens: ['problem'],
});

// INT-04: the health form is saved by its patient, for its own visit, while the visit is on.
describe('the health form under row level security', () => {
  it('is saved by its patient while the visit is on, and audited as the patient', async () => {
    await rolledBack(async (tx) => {
      const { physio, patientId } = await visits(tx);
      const visit = await checkedIn(tx, physio.id, patientId, 800);
      const link = await insertPatientLink(tx, {
        patientId,
        purpose: 'health_form',
        appointmentId: visit,
        expiresAt: new Date(Date.now() + 3_600_000),
      });
      await becomePatient(tx, { id: link.id, patientId, purpose: 'health_form' });
      expect(await ownIntakeResponse(tx)).toBeUndefined();
      const saved = await saveIntakeResponse(tx, form(link, visit, patientId));
      await saveIntakeResponse(tx, {
        ...form(link, visit, patientId),
        answers: { region: 'back', fever_sweats: false },
        doneScreens: ['problem', 'warning_signs'],
      });
      expect(await ownIntakeResponse(tx)).toMatchObject({
        id: saved.id,
        formVersion: 'hf-1',
        answers: { region: 'back', fever_sweats: false },
        doneScreens: ['problem', 'warning_signs'],
        submittedAt: null,
      });
      expect(
        await failure(tx, (sp) => sp.delete(intakeResponse).where(eq(intakeResponse.id, saved.id))),
      ).toBe('42501');
      await tx.execute(sql`reset role`);
      const events = await tx
        .select({ action: auditEvent.action, actor: auditEvent.actor })
        .from(auditEvent)
        .where(eq(auditEvent.entityId, saved.id));
      expect(events).toEqual([
        { action: 'insert', actor: `patient:${patientId}` },
        { action: 'update', actor: `patient:${patientId}` },
      ]);
    });
  });

  it('is refused for another visit, a visit not on, and once submitted', async () => {
    await rolledBack(async (tx) => {
      const { physio, patientId, mine, theirs } = await visits(tx);
      const visit = await checkedIn(tx, physio.id, patientId, 800);
      const issue = (appointmentId: string) =>
        insertPatientLink(tx, {
          patientId,
          purpose: 'health_form',
          appointmentId,
          expiresAt: new Date(Date.now() + 3_600_000),
        });
      const onVisit = await issue(visit);
      const onBooked = await issue(mine.id);
      // Submitted already (set as the owner, as the submit will).
      const later = await checkedIn(tx, physio.id, patientId, 900);
      const onSubmitted = await issue(later);
      await tx.insert(intakeResponse).values({
        ...form(onSubmitted, later, patientId),
        submittedAt: new Date(),
      });

      await tx.execute(sql`savepoint as_patient`);
      await becomePatient(tx, { id: onVisit.id, patientId, purpose: 'health_form' });
      expect(
        await failure(tx, (sp) => saveIntakeResponse(sp, form(onVisit, theirs.id, patientId))),
      ).toBe('42501');
      expect(
        await failure(tx, (sp) => saveIntakeResponse(sp, form(onVisit, visit, patientId))),
      ).toBeUndefined();
      await tx.execute(sql`rollback to savepoint as_patient`);

      await tx.execute(sql`savepoint booked`);
      await becomePatient(tx, { id: onBooked.id, patientId, purpose: 'health_form' });
      expect(
        await failure(tx, (sp) => saveIntakeResponse(sp, form(onBooked, mine.id, patientId))),
      ).toBe('42501');
      await tx.execute(sql`rollback to savepoint booked`);

      await becomePatient(tx, { id: onSubmitted.id, patientId, purpose: 'health_form' });
      expect((await ownIntakeResponse(tx))?.submittedAt).toBeInstanceOf(Date);
      expect(
        await failure(tx, (sp) => saveIntakeResponse(sp, form(onSubmitted, later, patientId))),
      ).toBe('42501');
    });
  });

  it('is seen by no staff member yet', async () => {
    await rolledBack(async (tx) => {
      const { physio, patientId } = await visits(tx);
      const visit = await checkedIn(tx, physio.id, patientId, 800);
      const link = await insertPatientLink(tx, {
        patientId,
        purpose: 'health_form',
        appointmentId: visit,
        expiresAt: new Date(Date.now() + 3_600_000),
      });
      await tx.insert(intakeResponse).values(form(link, visit, patientId));
      const desk = seedStaff.find((s) => s.email === 'desk.hsr@clinicmx.test');
      if (!desk?.id) throw new Error('no seed desk');
      const actor: StaffMember = {
        id: desk.id,
        email: desk.email,
        name: desk.name,
        role: desk.role,
        treatsPatients: false,
        consultant: false,
        centreIds: [centreIds.hsrLayout],
        support: false,
      };
      await becomeStaff(tx, actor);
      expect(await tx.select({ id: intakeResponse.id }).from(intakeResponse)).toEqual([]);
    });
  });
});

/** A seed staff member as the access helpers take them. */
function seedMember(email: string): StaffMember {
  const row = seedStaff.find((s) => s.email === email);
  if (!row?.id) throw new Error(`no seed ${email}`);
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    role: row.role,
    treatsPatients: row.treatsPatients ?? false,
    consultant: false,
    centreIds: [centreIds.hsrLayout],
    support: false,
  };
}

/** A Part A record for the link's visit, as the consent screen adds it. */
const partA = (
  link: { id: string },
  appointmentId: string,
  patientId: string,
  values: Partial<typeof consentRecord.$inferInsert> = {},
): typeof consentRecord.$inferInsert => ({
  patientId,
  appointmentId,
  patientLinkId: link.id,
  stage: 'A',
  signer: 'patient',
  statementKey: 'part_a.contact',
  statementVersion: 1,
  accepted: false,
  ...values,
});

// INT-06: Part A consent records are added by the patient for their own visit while it is on,
// never changed, and read by those who check in, so reception sees a decline.
describe('Part A consent under row level security', () => {
  it('is added by its patient while the visit is on, and read back', async () => {
    await rolledBack(async (tx) => {
      const { physio, patientId } = await visits(tx);
      const visit = await checkedIn(tx, physio.id, patientId, 800);
      const link = await insertPatientLink(tx, {
        patientId,
        purpose: 'health_form',
        appointmentId: visit,
        expiresAt: new Date(Date.now() + 3_600_000),
      });
      await becomePatient(tx, { id: link.id, patientId, purpose: 'health_form' });
      await insertConsentRecords(tx, [partA(link, visit, patientId)]);
      await insertConsentRecords(tx, [
        partA(link, visit, patientId, {
          statementKey: 'part_a.screening',
          accepted: true,
          signatureKind: 'typed',
          typedName: 'Test Patient',
        }),
      ]);
      expect((await ownConsentDecisions(tx)).map((d) => [d.statementKey, d.accepted])).toEqual([
        ['part_a.contact', false],
        ['part_a.screening', true],
      ]);
      const [mine] = await tx.select({ id: consentRecord.id }).from(consentRecord).limit(1);
      expect(
        await failure(tx, (sp) =>
          sp
            .update(consentRecord)
            .set({ accepted: true })
            .where(eq(consentRecord.id, mine?.id ?? '')),
        ),
      ).toBe('42501');
      expect(
        await failure(tx, (sp) =>
          sp.delete(consentRecord).where(eq(consentRecord.id, mine?.id ?? '')),
        ),
      ).toBe('42501');
      await tx.execute(sql`reset role`);
      const actors = await tx
        .select({ actor: auditEvent.actor })
        .from(auditEvent)
        .where(eq(auditEvent.entity, 'consent_record'));
      expect(new Set(actors.map((a) => a.actor))).toContain(`patient:${patientId}`);
    });
  });

  it('is refused for another visit, Part B, a guardian, a visit not on, and unsigned acceptance', async () => {
    await rolledBack(async (tx) => {
      const { physio, patientId, mine, theirs } = await visits(tx);
      const visit = await checkedIn(tx, physio.id, patientId, 800);
      const issue = (appointmentId: string) =>
        insertPatientLink(tx, {
          patientId,
          purpose: 'health_form',
          appointmentId,
          expiresAt: new Date(Date.now() + 3_600_000),
        });
      const onVisit = await issue(visit);
      const onBooked = await issue(mine.id);
      // The check holds for everyone: an acceptance is signed, a decline is not.
      expect(
        await failure(tx, (sp) =>
          insertConsentRecords(sp, [partA(onVisit, visit, patientId, { accepted: true })]),
        ),
      ).toBe('23514');
      expect(
        await failure(tx, (sp) =>
          insertConsentRecords(sp, [
            partA(onVisit, visit, patientId, { signatureKind: 'typed', typedName: 'X Y' }),
          ]),
        ),
      ).toBe('23514');

      await tx.execute(sql`savepoint as_patient`);
      await becomePatient(tx, { id: onVisit.id, patientId, purpose: 'health_form' });
      for (const values of [
        { appointmentId: theirs.id },
        { stage: 'B' as const },
        { signer: 'guardian' as const },
      ]) {
        expect(
          await failure(tx, (sp) =>
            insertConsentRecords(sp, [{ ...partA(onVisit, visit, patientId), ...values }]),
          ),
        ).toBe('42501');
      }
      await tx.execute(sql`rollback to savepoint as_patient`);

      await becomePatient(tx, { id: onBooked.id, patientId, purpose: 'health_form' });
      expect(
        await failure(tx, (sp) => insertConsentRecords(sp, [partA(onBooked, mine.id, patientId)])),
      ).toBe('42501');
    });
  });

  it('is read by those who check in, so reception sees a decline; a physio reads none', async () => {
    await rolledBack(async (tx) => {
      const { physio, patientId } = await visits(tx);
      const visit = await checkedIn(tx, physio.id, patientId, 800);
      const link = await insertPatientLink(tx, {
        patientId,
        purpose: 'health_form',
        appointmentId: visit,
        expiresAt: new Date(Date.now() + 3_600_000),
      });
      await insertConsentRecords(tx, [partA(link, visit, patientId)]);
      const declined = async () =>
        (
          await tx
            .select({ declined: partAConsentDeclined(visit) })
            .from(appointment)
            .limit(1)
        )[0]?.declined;

      await tx.execute(sql`savepoint as_desk`);
      await becomeStaff(tx, seedMember('desk.hsr@clinicmx.test'));
      const visitRecords = () =>
        tx
          .select({ id: consentRecord.id })
          .from(consentRecord)
          .where(eq(consentRecord.appointmentId, visit));
      expect(await visitRecords()).toHaveLength(1);
      expect(await declined()).toBe(true);
      await tx.execute(sql`rollback to savepoint as_desk`);

      // Changed their mind: a newer acceptance counts.
      await tx.execute(sql`savepoint later`);
      await tx.insert(consentRecord).values(
        partA(link, visit, patientId, {
          accepted: true,
          signatureKind: 'typed',
          typedName: 'Test Patient',
          createdAt: new Date(Date.now() + 60_000),
        }),
      );
      expect(await declined()).toBe(false);
      await tx.execute(sql`rollback to savepoint later`);

      await becomeStaff(tx, seedMember('physio.hsr@clinicmx.test'));
      expect(await visitRecords()).toEqual([]);
    });
  });
});

// INT-07: for a patient under the adult age a guardian on file signs. The patient page reads its
// patient's guardians who are not removed, without phones, and the date of birth; a guardian's
// record names one of them.
describe('the guardian section under row level security', () => {
  async function family(tx: Tx) {
    const { physio, patientId, theirs } = await visits(tx);
    const [other] = await tx
      .select({ patientId: appointment.patientId })
      .from(appointment)
      .where(eq(appointment.id, theirs.id));
    const details = (name: string) => ({
      name,
      relationship: 'mother' as const,
      phone: '+919800000001',
    });
    const mother = await insertGuardian(tx, patientId, details('Test Guardian Kept'));
    const removed = await insertGuardian(tx, patientId, details('Test Guardian Removed'));
    await removeGuardian(tx, removed);
    const someoneElse = await insertGuardian(
      tx,
      other?.patientId ?? '',
      details('Test Guardian Other'),
    );
    const visit = await checkedIn(tx, physio.id, patientId, 800);
    const link = await insertPatientLink(tx, {
      patientId,
      purpose: 'health_form',
      appointmentId: visit,
      expiresAt: new Date(Date.now() + 3_600_000),
    });
    return { patientId, mother, removed, someoneElse, visit, link };
  }

  it('reads the patient’s own guardians on file, never phones, and the date of birth', async () => {
    await rolledBack(async (tx) => {
      const { patientId, mother, link } = await family(tx);
      await tx.update(patient).set({ dateOfBirth: '2014-05-04' }).where(eq(patient.id, patientId));
      await becomePatient(tx, { id: link.id, patientId, purpose: 'health_form' });
      expect((await ownGuardians(tx)).map((g) => g.id)).toEqual([mother]);
      expect(await failure(tx, (sp) => sp.select({ phone: guardian.phone }).from(guardian))).toBe(
        '42501',
      );
      expect((await healthFormVisit(tx))?.dateOfBirth).toBe('2014-05-04');
    });
  });

  it('records a guardian’s signature with a guardian on file, and refuses any other', async () => {
    await rolledBack(async (tx) => {
      const { patientId, mother, removed, someoneElse, visit, link } = await family(tx);
      const signed = {
        accepted: true,
        signatureKind: 'typed' as const,
        typedName: 'Test Guardian',
      };
      // The check holds for everyone: a guardian's record names one, the patient's none.
      for (const values of [
        { signer: 'guardian' as const },
        { signer: 'patient' as const, guardianId: mother },
      ]) {
        expect(
          await failure(tx, (sp) =>
            insertConsentRecords(sp, [partA(link, visit, patientId, { ...signed, ...values })]),
          ),
        ).toBe('23514');
      }
      await becomePatient(tx, { id: link.id, patientId, purpose: 'health_form' });
      for (const guardianId of [someoneElse, removed]) {
        expect(
          await failure(tx, (sp) =>
            insertConsentRecords(sp, [
              partA(link, visit, patientId, { ...signed, signer: 'guardian', guardianId }),
            ]),
          ),
        ).toBe('42501');
      }
      await insertConsentRecords(tx, [
        partA(link, visit, patientId, { ...signed, signer: 'guardian', guardianId: mother }),
      ]);
      expect(await ownConsentDecisions(tx)).toHaveLength(1);
    });
  });
});

// INT-05: the patient adds report photos to their own visit while the form is open, reads back
// only those, starts About you from the record, and submits once: the submit time is now and the
// link completes only after the form is submitted.
describe('report photos and submitting under row level security', () => {
  async function open(tx: Tx) {
    const { physio, patientId, mine, theirs } = await visits(tx);
    await tx
      .update(patient)
      .set({ sex: 'female', occupation: 'Teacher' })
      .where(eq(patient.id, patientId));
    const visit = await checkedIn(tx, physio.id, patientId, 800);
    const link = await insertPatientLink(tx, {
      patientId,
      purpose: 'health_form',
      appointmentId: visit,
      expiresAt: new Date(Date.now() + 3_600_000),
    });
    const report = (appointmentId = visit) => {
      const id = randomUUID();
      return {
        id,
        patientId,
        appointmentId,
        filePath: `${patientId}/${id}.png`,
        contentType: 'image/png' as const,
        sizeBytes: 1200,
      };
    };
    return { patientId, mine, theirs, visit, link, report };
  }

  it('adds a report to its own visit, reads back only its own, and reads sex and occupation', async () => {
    await rolledBack(async (tx) => {
      const { patientId, link, report } = await open(tx);
      // One the desk added already: the patient page does not see it.
      await insertPatientReport(tx, { ...report(), uploadedBy: superAdminId });
      await becomePatient(tx, { id: link.id, patientId, purpose: 'health_form' });
      expect(await healthFormVisit(tx)).toMatchObject({ sex: 'female', occupation: 'Teacher' });
      const added = await insertPatientReport(tx, { ...report(), patientLinkId: link.id });
      expect((await ownReports(tx)).map((r) => r.id)).toEqual([added.id]);
      expect(
        await failure(tx, (sp) => sp.select({ size: patientReport.sizeBytes }).from(patientReport)),
      ).toBe('42501');
      await tx.execute(sql`reset role`);
      const [row] = await tx
        .select({ uploadedBy: patientReport.uploadedBy, link: patientReport.patientLinkId })
        .from(patientReport)
        .where(eq(patientReport.id, added.id));
      expect(row).toEqual({ uploadedBy: null, link: link.id });
      const events = await tx
        .select({ actor: auditEvent.actor })
        .from(auditEvent)
        .where(eq(auditEvent.entityId, added.id));
      expect(events).toEqual([{ actor: `patient:${patientId}` }]);
    });
  });

  it('refuses a report for another visit, as a staff member, with the visit not on, or after submit', async () => {
    await rolledBack(async (tx) => {
      const { patientId, theirs, mine, visit, link, report } = await open(tx);
      const add = (sp: Tx, appointmentId?: string) =>
        insertPatientReport(sp, { ...report(appointmentId), patientLinkId: link.id });
      await tx.execute(sql`savepoint as_patient`);
      await becomePatient(tx, { id: link.id, patientId, purpose: 'health_form' });
      expect(await failure(tx, (sp) => add(sp, theirs.id))).toBe('42501');
      expect(await failure(tx, (sp) => add(sp, mine.id))).toBe('42501');
      expect(
        await failure(tx, (sp) =>
          insertPatientReport(sp, { ...report(), uploadedBy: superAdminId }),
        ),
      ).toBe('42501');
      expect(await failure(tx, (sp) => add(sp))).toBeUndefined();
      await tx.execute(sql`rollback to savepoint as_patient`);

      await tx.execute(sql`savepoint not_on`);
      await tx.update(appointment).set({ status: 'completed' }).where(eq(appointment.id, visit));
      await becomePatient(tx, { id: link.id, patientId, purpose: 'health_form' });
      expect(await failure(tx, (sp) => add(sp))).toBe('42501');
      await tx.execute(sql`rollback to savepoint not_on`);

      await tx
        .insert(intakeResponse)
        .values({ ...form(link, visit, patientId), submittedAt: new Date() });
      await becomePatient(tx, { id: link.id, patientId, purpose: 'health_form' });
      expect(await failure(tx, (sp) => add(sp))).toBe('42501');
    });
  });

  it('submits once, at now, then completes its own link; nothing changes after', async () => {
    await rolledBack(async (tx) => {
      const { patientId, mine, visit, link } = await open(tx);
      const other = await insertPatientLink(tx, {
        patientId,
        purpose: 'health_form',
        appointmentId: mine.id,
        expiresAt: new Date(Date.now() + 3_600_000),
      });
      await becomePatient(tx, { id: link.id, patientId, purpose: 'health_form' });
      await saveIntakeResponse(tx, form(link, visit, patientId));
      // The link completes only after the form is submitted, and never another link.
      expect(await failure(tx, (sp) => completePatientLinkRow(sp, link.id))).toBe('42501');
      expect(
        await failure(tx, (sp) =>
          sp.update(intakeResponse).set({ submittedAt: new Date(Date.now() - 3_600_000) }),
        ),
      ).toBe('42501');
      expect(await submitIntakeResponse(tx)).toBe(true);
      expect(await completePatientLinkRow(tx, link.id)).toBe(true);
      expect(await completePatientLinkRow(tx, other.id)).toBe(false);
      expect(await submitIntakeResponse(tx)).toBe(false);
      expect(await failure(tx, (sp) => saveIntakeResponse(sp, form(link, visit, patientId)))).toBe(
        '42501',
      );
      await tx.execute(sql`reset role`);
      const [done] = await tx
        .select({ completedAt: patientLink.completedAt })
        .from(patientLink)
        .where(eq(patientLink.id, link.id));
      expect(done?.completedAt).toBeInstanceOf(Date);
      const [submitted] = await tx
        .select({ at: intakeResponse.submittedAt })
        .from(intakeResponse)
        .where(eq(intakeResponse.appointmentId, visit));
      expect(submitted?.at).toBeInstanceOf(Date);
    });
  });
});

// INT-10: the submit queues only its own pipeline job; alerts and precautions are read by staff who
// treat patients at the centre; a notification by the staff member it is for, who can only mark
// it read.
describe('the submit pipeline under row level security', () => {
  it('lets a submitted form queue its own pipeline job, and no other job', async () => {
    await rolledBack(async (tx) => {
      const { physio, patientId, theirs } = await visits(tx);
      const visit = await checkedIn(tx, physio.id, patientId, 800);
      const link = await insertPatientLink(tx, {
        patientId,
        purpose: 'health_form',
        appointmentId: visit,
        expiresAt: new Date(Date.now() + 3_600_000),
      });
      await becomePatient(tx, { id: link.id, patientId, purpose: 'health_form' });
      await saveIntakeResponse(tx, form(link, visit, patientId));
      // Not before the submit.
      expect(await failure(tx, (sp) => enqueueIntakeSubmitted(sp, visit))).toBe('42501');
      await submitIntakeResponse(tx);
      const queue = (values: Partial<typeof job.$inferInsert>) =>
        failure(tx, (sp) =>
          sp.insert(job).values({
            kind: 'intake.submitted',
            payload: { appointmentId: visit },
            idempotencyKey: `intake.submitted:${visit}`,
            ...values,
          }),
        );
      expect(await queue({ kind: 'system.ping' })).toBe('42501');
      expect(
        await queue({
          payload: { appointmentId: theirs.id },
          idempotencyKey: `intake.submitted:${theirs.id}`,
        }),
      ).toBe('42501');
      expect(await queue({ idempotencyKey: 'something.else' })).toBe('42501');
      expect(await queue({ attempts: 1 })).toBe('42501');
      expect(await queue({ status: 'done' })).toBe('42501');
      expect(await failure(tx, (sp) => enqueueIntakeSubmitted(sp, visit))).toBeUndefined();
      await tx.execute(sql`reset role`);
      const queued = await tx
        .select({ kind: job.kind, status: job.status })
        .from(job)
        .where(eq(job.idempotencyKey, `intake.submitted:${visit}`));
      expect(queued).toEqual([{ kind: 'intake.submitted', status: 'queued' }]);
    });
  });

  it('shows alerts and precautions to staff who treat patients at the centre only', async () => {
    await rolledBack(async (tx) => {
      const { physio, patientId, mine } = await visits(tx);
      const version = await latestKnowledgeVersion(tx);
      if (!version) throw new Error('no knowledge base version');
      const episodeId = await insertEpisode(tx, {
        patientId,
        centreId: centreIds.hsrLayout,
        bodyRegion: 'back',
      });
      await insertRedFlagAlerts(tx, [
        {
          episodeId,
          appointmentId: mine.id,
          kbVersionId: version.id,
          ruleKey: 'back.cauda_equina',
          name: 'Cauda equina',
          triage: 'immediate_emergency',
          display: 'emergency',
          action: 'Emergency department now.',
          signedOff: false,
        },
      ]);
      await insertPrecautions(tx, [
        {
          episodeId,
          key: 'implant',
          label: 'Any implant',
          intakeResponseId: null,
          formVersion: 'hf-3',
        },
      ]);
      const sees = async (actor: StaffMember) => {
        await tx.execute(sql`savepoint looking`);
        await becomeStaff(tx, actor);
        const seen = {
          alerts: (
            await tx
              .select({ id: redFlagAlert.id })
              .from(redFlagAlert)
              .where(eq(redFlagAlert.episodeId, episodeId))
          ).length,
          precautions: (
            await tx
              .select({ id: precaution.id })
              .from(precaution)
              .where(eq(precaution.episodeId, episodeId))
          ).length,
        };
        await tx.execute(sql`rollback to savepoint looking`);
        return seen;
      };
      expect(await sees(physio)).toEqual({ alerts: 1, precautions: 1 });
      expect(await sees(seedMember('desk.hsr@clinicmx.test'))).toEqual({
        alerts: 0,
        precautions: 0,
      });
      expect(
        await sees({
          ...seedMember('physio.koramangala@clinicmx.test'),
          centreIds: [centreIds.koramangala],
        }),
      ).toEqual({ alerts: 0, precautions: 0 });
      // Nobody on staff writes them.
      await becomeStaff(tx, physio);
      expect(
        await failure(tx, (sp) =>
          sp
            .update(redFlagAlert)
            .set({ status: 'closed' })
            .where(eq(redFlagAlert.episodeId, episodeId)),
        ),
      ).toBeUndefined();
      await tx.execute(sql`reset role`);
      const [still] = await tx
        .select({ status: redFlagAlert.status })
        .from(redFlagAlert)
        .where(eq(redFlagAlert.episodeId, episodeId));
      expect(still?.status).toBe('raised');
    });
  });

  it('shows a notification only to its staff member, who can only mark it read', async () => {
    await rolledBack(async (tx) => {
      const { physio, patientId, mine } = await visits(tx);
      const other = seedMember('physio.hsr@clinicmx.test');
      const episodeId = await insertEpisode(tx, { patientId, centreId: centreIds.hsrLayout });
      await insertNotifications(tx, [
        {
          staffUserId: physio.id,
          kind: 'health_form_submitted',
          appointmentId: mine.id,
          episodeId,
        },
        { staffUserId: physio.id, kind: 'red_flag_emergency', appointmentId: mine.id, episodeId },
        { staffUserId: other.id, kind: 'health_form_submitted', appointmentId: mine.id, episodeId },
      ]);
      const theirs = await tx
        .select({ id: notification.id })
        .from(notification)
        .where(eq(notification.staffUserId, other.id));
      await becomeStaff(tx, physio);
      const mineSeen = await myNotifications(tx);
      expect(mineSeen.map((n) => n.kind).sort()).toEqual([
        'health_form_submitted',
        'red_flag_emergency',
      ]);
      expect(mineSeen[0]?.patientName).toEqual(expect.any(String));
      expect(await unreadNotificationCount(tx)).toBe(2);
      expect(
        await markNotificationsRead(
          tx,
          theirs.map((n) => n.id),
        ),
      ).toBe(0);
      expect(
        await failure(tx, (sp) => sp.update(notification).set({ kind: 'red_flag_emergency' })),
      ).toBe('42501');
      expect(
        await markNotificationsRead(
          tx,
          mineSeen.map((n) => n.id),
        ),
      ).toBe(2);
      expect(await unreadNotificationCount(tx)).toBe(0);
      await tx.execute(sql`reset role`);
      const [left] = await tx
        .select({ readAt: notification.readAt })
        .from(notification)
        .where(eq(notification.staffUserId, other.id));
      expect(left?.readAt).toBeNull();
    });
  });
});
