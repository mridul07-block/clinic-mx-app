import { randomUUID } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
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
import { insertPatientReport, patientReports, reportFileOf } from '../check-in';
import {
  enqueueIntakeSubmitted,
  insertNotifications,
  insertPrecautions,
  insertRedFlagAlerts,
  markNotificationsRead,
  myNotifications,
  unreadNotificationCount,
} from '../clinical';
import { episodeRecord, insertEpisode } from '../episodes';
import { moveRedFlagAlert, openEmergencies, openRedFlagAlerts } from '../red-flag-alerts';
import {
  healthFormVisit,
  markIntakeAssisted,
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

  it('shows staff only who helped and whether it was sent, never the answers (INT-09)', async () => {
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
      const [seen] = await tx
        .select({ assistedBy: intakeResponse.assistedBy, submittedAt: intakeResponse.submittedAt })
        .from(intakeResponse)
        .where(eq(intakeResponse.appointmentId, visit));
      expect(seen).toEqual({ assistedBy: null, submittedAt: null });
      expect(
        await failure(tx, (sp) =>
          sp.select({ answers: intakeResponse.answers }).from(intakeResponse),
        ),
      ).toBe('42501');
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

  it('shows alerts to staff who treat patients at the centre, precautions to clinicians', async () => {
    await rolledBack(async (tx) => {
      const { physio, patientId, mine } = await visits(tx);
      // A draft version of its own: the CI database has no imported knowledge base here.
      const [version] = await tx.execute<{ id: string }>(
        sql`insert into kb_version (number, source, report, created_by)
          select coalesce(max(number), 0) + 1, '{}'::jsonb, '{}'::jsonb, 'tests' from kb_version
          returning id`,
      );
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
        // CLN-12: precautions are part of the patient record, read by clinicians at any centre;
        // the alert itself stays with its centre's list.
      ).toEqual({ alerts: 0, precautions: 1 });
      // No skipping the lifecycle (ALT-01): raised cannot close before a review.
      await becomeStaff(tx, physio);
      expect(
        await failure(tx, (sp) =>
          sp
            .update(redFlagAlert)
            .set({ status: 'closed' })
            .where(eq(redFlagAlert.episodeId, episodeId)),
        ),
      ).toBe('23514');
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

/** An emergency alert raised on a new episode for the first visit, on a draft version of its own. */
async function raisedEmergency(tx: Tx) {
  const fixture = await visits(tx);
  const [version] = await tx.execute<{ id: string }>(
    sql`insert into kb_version (number, source, report, created_by)
      select coalesce(max(number), 0) + 1, '{}'::jsonb, '{}'::jsonb, 'tests' from kb_version
      returning id`,
  );
  if (!version) throw new Error('no knowledge base version');
  const episodeId = await insertEpisode(tx, {
    patientId: fixture.patientId,
    centreId: centreIds.hsrLayout,
    bodyRegion: 'back',
  });
  await insertRedFlagAlerts(tx, [
    {
      episodeId,
      appointmentId: fixture.mine.id,
      kbVersionId: version.id,
      ruleKey: 'back.cauda_equina',
      name: 'Cauda equina',
      triage: 'immediate_emergency',
      display: 'emergency',
      action: 'Emergency department now.',
      signedOff: false,
    },
  ]);
  const [alert] = await tx
    .select({ id: redFlagAlert.id })
    .from(redFlagAlert)
    .where(eq(redFlagAlert.episodeId, episodeId));
  if (!alert) throw new Error('no alert');
  return { ...fixture, episodeId, alertId: alert.id };
}

// ALT-01: alerts are read by clinicians and by the Super Admin and Centre Managers without the tick;
// the banner function tells anyone at the centre but Finance only that a patient needs a clinician;
// only clinicians move an alert, by the lifecycle's moves, as themselves.
describe('red flag alerts after they are raised', () => {
  const manager = () => ({ ...seedMember('manager@clinicmx.test'), treatsPatients: false });
  const desk = () => seedMember('desk.hsr@clinicmx.test');
  const finance = () => ({ ...seedMember('finance@clinicmx.test'), centreIds: [] });
  const support = () => ({
    ...seedMember('support.velyx@clinicmx.test'),
    treatsPatients: false,
    support: true,
  });
  const deskElsewhere = () => ({
    ...seedMember('desk.koramangala@clinicmx.test'),
    centreIds: [centreIds.koramangala],
  });

  it('is read by clinicians and managers; the banner tells the desk only who', async () => {
    await rolledBack(async (tx) => {
      const { physio, alertId, episodeId, mine, patientId } = await raisedEmergency(tx);
      const look = async (actor: StaffMember) => {
        await tx.execute(sql`savepoint looking`);
        await becomeStaff(tx, actor);
        const seen = {
          alerts: (await openRedFlagAlerts(tx)).filter((a) => a.id === alertId).length,
          banners: (await openEmergencies(tx)).filter((e) => e.alertId === alertId).length,
        };
        await tx.execute(sql`rollback to savepoint looking`);
        return seen;
      };
      expect(await look(physio)).toEqual({ alerts: 1, banners: 1 });
      expect(await look(manager())).toEqual({ alerts: 1, banners: 1 });
      expect(await look(desk())).toEqual({ alerts: 0, banners: 1 });
      for (const actor of [finance(), support(), deskElsewhere()]) {
        expect(await look(actor), actor.email).toEqual({ alerts: 0, banners: 0 });
      }
      // The desk's banner row: who and which visit, no rule.
      await becomeStaff(tx, desk());
      const rows = await tx.execute(sql`select * from internal.open_emergencies()`);
      expect(rows.find((r) => r.alert_id === alertId)).toEqual({
        alert_id: alertId,
        episode_id: episodeId,
        appointment_id: mine.id,
        patient_id: patientId,
        centre_id: centreIds.hsrLayout,
        raised_at: expect.anything() as unknown,
      });
    });
  });

  it('is reviewed, referred and closed by a clinician, stamped and audited', async () => {
    await rolledBack(async (tx) => {
      const { physio, alertId } = await raisedEmergency(tx);
      await becomeStaff(tx, physio);
      expect(
        await moveRedFlagAlert(tx, alertId, 'raised', {
          status: 'reviewed',
          reviewedBy: physio.id,
        }),
      ).toBe(true);
      expect((await openEmergencies(tx)).filter((e) => e.alertId === alertId)).toEqual([]);
      expect(
        await moveRedFlagAlert(tx, alertId, 'reviewed', {
          status: 'referred',
          referredBy: physio.id,
          referredTo: 'Emergency department',
        }),
      ).toBe(true);
      expect(
        await moveRedFlagAlert(tx, alertId, 'referred', {
          status: 'closed',
          closedBy: physio.id,
          decision: 'Sent to the emergency department.',
        }),
      ).toBe(true);
      await tx.execute(sql`reset role`);
      const [done] = await tx.select().from(redFlagAlert).where(eq(redFlagAlert.id, alertId));
      expect(done).toMatchObject({
        status: 'closed',
        reviewedBy: physio.id,
        referredBy: physio.id,
        referredTo: 'Emergency department',
        closedBy: physio.id,
        decision: 'Sent to the emergency department.',
      });
      expect(done?.reviewedAt).toBeInstanceOf(Date);
      expect(done?.referredAt).toBeInstanceOf(Date);
      expect(done?.closedAt).toBeInstanceOf(Date);
      const audits = await tx
        .select({ action: auditEvent.action, actor: auditEvent.actor })
        .from(auditEvent)
        .where(and(eq(auditEvent.entity, 'red_flag_alert'), eq(auditEvent.entityId, alertId)));
      expect(audits.filter((a) => a.action === 'update')).toEqual([
        { action: 'update', actor: `staff:${physio.id}` },
        { action: 'update', actor: `staff:${physio.id}` },
        { action: 'update', actor: `staff:${physio.id}` },
      ]);
    });
  });

  it('refuses skipped moves, another name, empty reasons, rule changes and closed alerts', async () => {
    await rolledBack(async (tx) => {
      const { physio, alertId } = await raisedEmergency(tx);
      const other = seedMember('physio.hsr@clinicmx.test');
      await becomeStaff(tx, physio);
      const set = (values: Partial<typeof redFlagAlert.$inferInsert>) =>
        failure(tx, (sp) =>
          sp.update(redFlagAlert).set(values).where(eq(redFlagAlert.id, alertId)),
        );
      expect(await set({ status: 'closed', closedBy: physio.id, decision: 'x' })).toBe('23514');
      expect(await set({ status: 'reviewed', reviewedBy: other.id })).toBe('23514');
      expect(await set({ name: 'Something milder' })).toBe('42501');
      expect(await set({ triage: 'monitor_with_caution' })).toBe('42501');
      expect(await set({ status: 'reviewed', reviewedBy: physio.id })).toBeUndefined();
      expect(await set({ status: 'referred', referredBy: physio.id, referredTo: '  ' })).toBe(
        '23514',
      );
      expect(await set({ status: 'closed', closedBy: physio.id, decision: '' })).toBe('23514');
      expect(
        await set({ status: 'closed', closedBy: physio.id, decision: 'Seen; safe.' }),
      ).toBeUndefined();
      expect(await set({ decision: 'Changed my mind.' })).toBe('23514');
    });
  });

  it('is moved by no one but a clinician at the centre', async () => {
    await rolledBack(async (tx) => {
      const { alertId, episodeId } = await raisedEmergency(tx);
      const elsewhere = {
        ...seedMember('physio.koramangala@clinicmx.test'),
        centreIds: [centreIds.koramangala],
      };
      for (const actor of [manager(), desk(), support(), elsewhere]) {
        await tx.execute(sql`savepoint trying`);
        await becomeStaff(tx, actor);
        expect(
          await moveRedFlagAlert(tx, alertId, 'raised', {
            status: 'reviewed',
            reviewedBy: actor.id,
          }),
          actor.email,
        ).toBe(false);
        await tx.execute(sql`rollback to savepoint trying`);
      }
      const [still] = await tx
        .select({ status: redFlagAlert.status })
        .from(redFlagAlert)
        .where(eq(redFlagAlert.id, alertId));
      expect(still?.status).toBe('raised');
      expect((await episodeRecord(tx, episodeId))?.status).toBe('intake_pending');
    });
  });
});

// ALT-08: clinicians (the Super Admin, and the Treats patients tick) read report rows at any
// centre, to open the file through our server; the desk still reads the rows to list them; a
// manager without the tick, Finance and support read none.
describe('opening report photos under row level security', () => {
  it('gives clinicians anywhere the file, lets those who check in list it, and nobody else', async () => {
    await rolledBack(async (tx) => {
      const { patientId, mine } = await visits(tx);
      const id = randomUUID();
      await insertPatientReport(tx, {
        id,
        patientId,
        appointmentId: mine.id,
        filePath: `${patientId}/${id}.jpg`,
        contentType: 'image/jpeg',
        sizeBytes: 90_000,
        uploadedBy: superAdminId,
      });
      const reads = async (actor: StaffMember) => {
        await tx.execute(sql`savepoint looking`);
        await becomeStaff(tx, actor);
        const found = await reportFileOf(tx, id);
        const listed = (await patientReports(tx, patientId)).some((r) => r.id === id);
        const path = await failure(tx, (sp) =>
          sp.select({ path: patientReport.filePath }).from(patientReport),
        );
        await tx.execute(sql`rollback to savepoint looking`);
        return { file: found?.filePath ?? null, listed, path };
      };
      const elsewhere = {
        ...seedMember('physio.koramangala@clinicmx.test'),
        treatsPatients: true,
        centreIds: [centreIds.koramangala],
      };
      const file = `${patientId}/${id}.jpg`;
      // No staff member reads where the file is from the table (42501).
      expect(await reads(elsewhere)).toEqual({ file, listed: true, path: '42501' });
      expect(await reads({ ...seedMember('super.admin@clinicmx.test'), centreIds: [] })).toEqual({
        file,
        listed: true,
        path: '42501',
      });
      // Those who check in list it, without the file.
      for (const actor of [
        seedMember('desk.hsr@clinicmx.test'),
        { ...seedMember('manager@clinicmx.test'), treatsPatients: false },
      ]) {
        expect(await reads(actor), actor.email).toEqual({
          file: null,
          listed: true,
          path: '42501',
        });
      }
      // Velyx support lists what the desk lists (INT-02), never the file.
      expect(
        await reads({
          ...seedMember('support.velyx@clinicmx.test'),
          treatsPatients: false,
          support: true,
        }),
      ).toEqual({ file: null, listed: true, path: '42501' });
      for (const actor of [{ ...seedMember('finance@clinicmx.test'), centreIds: [] }]) {
        expect(await reads(actor), actor.email).toEqual({
          file: null,
          listed: false,
          path: '42501',
        });
      }
    });
  });
});

// INT-09: those who check in record themselves as helping with a checked in visit's form at their
// centre, before it is sent; they and clinicians read who helped, never the answers; the patient
// saves and submits as before, and cannot change who helped.
describe('assisted mode under row level security', () => {
  it('records who helped, as themselves, and nobody else may', async () => {
    await rolledBack(async (tx) => {
      const { physio, patientId, mine } = await visits(tx);
      const visit = await checkedIn(tx, physio.id, patientId, 800);
      const link = await insertPatientLink(tx, {
        patientId,
        purpose: 'health_form',
        appointmentId: visit,
        expiresAt: new Date(Date.now() + 3_600_000),
      });
      const desk = seedMember('desk.hsr@clinicmx.test');
      const mark = async (actor: StaffMember, values: { appointmentId?: string } = {}) => {
        await tx.execute(sql`savepoint marking`);
        await becomeStaff(tx, actor);
        const marked = await markIntakeAssisted(tx, {
          appointmentId: values.appointmentId ?? visit,
          patientLinkId: link.id,
          formVersion: 'hf-3',
        });
        if (marked) await tx.execute(sql`release savepoint marking`);
        else await tx.execute(sql`rollback to savepoint marking`);
        await tx.execute(sql`reset role`);
        return marked;
      };
      const elsewhere = {
        ...seedMember('desk.koramangala@clinicmx.test'),
        centreIds: [centreIds.koramangala],
      };
      const support = {
        ...seedMember('support.velyx@clinicmx.test'),
        treatsPatients: false,
        support: true,
      };
      for (const actor of [elsewhere, physio, support]) {
        expect(await mark(actor), actor.email).toBe(false);
      }
      // A visit not checked in (and not the link's).
      expect(await mark(desk, { appointmentId: mine.id })).toBe(false);
      // Staff have no write right on the table at all.
      await becomeStaff(tx, desk);
      expect(
        await failure(tx, (sp) =>
          sp
            .update(intakeResponse)
            .set({ assistedBy: desk.id })
            .where(eq(intakeResponse.appointmentId, visit)),
        ),
      ).toBe('42501');
      await tx.execute(sql`reset role`);
      // The patient starts first; the desk then helps.
      await tx.execute(sql`savepoint patient`);
      await becomePatient(tx, { ...link, patientId, purpose: 'health_form' });
      await saveIntakeResponse(tx, {
        appointmentId: visit,
        patientId,
        patientLinkId: link.id,
        formVersion: 'hf-3',
        answers: { region: 'back' },
        doneScreens: ['consent'],
      });
      await tx.execute(sql`release savepoint patient`);
      await tx.execute(sql`reset role`);
      expect(await mark(desk)).toBe(true);

      // Who helped, for the desk and the physio; never the answers.
      const helper = async (actor: StaffMember) => {
        await tx.execute(sql`savepoint looking`);
        await becomeStaff(tx, actor);
        const [row] = await tx
          .select({ assistedBy: intakeResponse.assistedBy })
          .from(intakeResponse)
          .where(eq(intakeResponse.appointmentId, visit));
        const answers = await failure(tx, (sp) =>
          sp.select({ answers: intakeResponse.answers }).from(intakeResponse),
        );
        await tx.execute(sql`rollback to savepoint looking`);
        return { helper: row?.assistedBy ?? null, answers };
      };
      expect(await helper(desk)).toEqual({ helper: desk.id, answers: '42501' });
      expect(await helper(physio)).toEqual({ helper: desk.id, answers: '42501' });

      // The patient keeps saving and submits; who helped is not theirs to change.
      await becomePatient(tx, { ...link, patientId, purpose: 'health_form' });
      expect(
        await failure(tx, (sp) =>
          sp
            .update(intakeResponse)
            .set({ assistedBy: null })
            .where(eq(intakeResponse.appointmentId, visit)),
        ),
      ).toBe('42501');
      await saveIntakeResponse(tx, {
        appointmentId: visit,
        patientId,
        patientLinkId: link.id,
        formVersion: 'hf-3',
        answers: { region: 'back', pain_now: 4 },
        doneScreens: ['consent', 'problem'],
      });
      expect(await submitIntakeResponse(tx)).toBe(true);
      await tx.execute(sql`reset role`);
      const [sent] = await tx
        .select({ assistedBy: intakeResponse.assistedBy, answers: intakeResponse.answers })
        .from(intakeResponse)
        .where(eq(intakeResponse.appointmentId, visit));
      expect(sent).toEqual({ assistedBy: desk.id, answers: { region: 'back', pain_now: 4 } });
      // Once sent, nobody changes who helped.
      expect(await mark(seedMember('manager@clinicmx.test'))).toBe(false);
    });
  });
});
