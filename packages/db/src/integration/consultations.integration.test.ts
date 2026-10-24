import { and, eq, sql } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { systemActor, withActor } from '../audit';
import { createDb } from '../client';
import {
  consultationIntake,
  consultationRecord,
  openConsultation,
  saveConsultationSections,
  treatingPhysios,
} from '../consultations';
import { insertEpisode } from '../episodes';
import type { StaffMember } from '../identity';
import { startVisit } from '../my-patients';
import { insertPatientLink } from '../patient-links';
import { appointment, auditEvent, consultation, intakeResponse, staffUser } from '../schema';
import { centreIds, seedStaff, seedStaffCentres } from '../seed/data';
import { becomeStaff, testPatient, testPhysio, typeId } from './fake-schedule';

// CLN-02 done when: Start consultation opens one consultation per visit, on the episode the
// health form opened, with the knowledge base version; only its own consultant saves it, at the
// version the draft started from; who, where and which version never change, and a signed one
// never changes at all. Under row level security, in transactions rolled back. CI only.
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
const support = member('support.velyx@clinicmx.test');

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

const sections = (notes: string) => ({
  subjective: { notes, confirmed: {} },
  screening: { notes: '', confirmed: {} },
  objective: { notes: '', region: '' as const, side: '' as const, measures: {}, tests: [] },
  assessment: {
    notes: '',
    conditionId: '',
    movement: '',
    irritability: '' as const,
    stage: '' as const,
    categoryCode: '',
    provisional: true,
  },
  plan: {
    notes: '',
    goals: [],
    interventions: [],
    modalities: [],
    sessionsPerWeek: null,
    weeks: null,
    homeProgramme: [],
    reviewDate: '',
    questionnaires: null,
    treatingPhysioId: '',
    investigations: '',
    referral: '',
  },
});

/** Consultants at HSR Layout, a knowledge base version, and checked in consultations with a form. */
async function setUp(tx: Tx) {
  const consultationType = await typeId(tx, 'consultation');
  const consultant = await testPhysio(tx, {
    centreIds: [centreIds.hsrLayout],
    consultant: true,
    createdBy: superAdmin.id,
  });
  const other = await testPhysio(tx, {
    centreIds: [centreIds.hsrLayout],
    consultant: true,
    createdBy: superAdmin.id,
  });
  const [version] = await tx.execute<{ id: string }>(
    sql`insert into kb_version (number, source, report, created_by)
      select coalesce(max(number), 0) + 1, '{}'::jsonb, '{}'::jsonb, 'tests' from kb_version
      returning id`,
  );
  let minutes = -30;
  /** A checked in consultation whose form opened its episode. */
  const visit = async (physioId: string, values: Partial<typeof appointment.$inferInsert> = {}) => {
    const patientId = await testPatient(tx);
    const episodeId = await insertEpisode(tx, { patientId, centreId: centreIds.hsrLayout });
    const startsAt = new Date(Date.now() + (minutes += 2) * 60000);
    const [row] = await tx
      .insert(appointment)
      .values({
        number: '',
        patientId,
        centreId: centreIds.hsrLayout,
        physioId,
        appointmentTypeId: consultationType,
        episodeId,
        startsAt,
        endsAt: new Date(startsAt.getTime() + 60000),
        channel: 'front_desk',
        bookedBy: superAdmin.id,
        status: 'checked_in',
        arrivedAt: new Date(),
        checkedInBy: deskHsr.id,
        ...values,
      })
      .returning({ id: appointment.id });
    if (!row) throw new Error('The appointment was not recorded.');
    return { appointmentId: row.id, episodeId, patientId };
  };
  return { consultant, other, visit, versionId: version?.id ?? '' };
}

describe('consultation', () => {
  it('opens once per visit with the knowledge version, and saves at the draft’s version', async () => {
    await rolledBack(async (tx) => {
      const { consultant, visit, versionId } = await setUp(tx);
      const here = await visit(consultant.id);
      await becomeStaff(tx, consultant);
      await startVisit(tx, {
        appointmentId: here.appointmentId,
        by: consultant.id,
        now: new Date(),
      });
      const open = { ...here, physioId: consultant.id };
      const id = await openConsultation(tx, open);
      expect(await openConsultation(tx, open)).toBe(id);

      const record = await consultationRecord(tx, id);
      expect(record).toMatchObject({ status: 'draft', version: 1, sections: {} });
      expect(await saveConsultationSections(tx, id, 1, sections('Pain on stairs'))).toEqual({
        status: 'saved',
        version: 2,
      });
      // A draft from version 1 meets version 2: nothing is overwritten.
      const stale = await saveConsultationSections(tx, id, 1, sections('Older'));
      expect(stale).toMatchObject({ status: 'conflict', version: 2 });
      expect(stale.status === 'conflict' && stale.row.sections).toEqual(sections('Pain on stairs'));

      await tx.execute(sql`reset role`);
      const [row] = await tx
        .select({ kbVersionId: consultation.kbVersionId, episodeId: consultation.episodeId })
        .from(consultation)
        .where(eq(consultation.id, id));
      expect(row).toEqual({ kbVersionId: versionId, episodeId: here.episodeId });
      const audited = await tx
        .select({ actor: auditEvent.actor })
        .from(auditEvent)
        .where(and(eq(auditEvent.entity, 'consultation'), eq(auditEvent.entityId, id)));
      expect(audited.map((a) => a.actor)).toEqual(
        expect.arrayContaining([`staff:${consultant.id}`]),
      );
      expect(audited.length).toBe(2);
    });
  });

  it('is opened only by the visit’s own consultant, on a checked in or started visit', async () => {
    await rolledBack(async (tx) => {
      const { consultant, other, visit } = await setUp(tx);
      const treating = await testPhysio(tx, {
        centreIds: [centreIds.hsrLayout],
        createdBy: superAdmin.id,
      });
      const mine = await visit(consultant.id);
      const booked = await visit(consultant.id, {
        status: 'booked',
        arrivedAt: null,
        checkedInBy: null,
      });
      const notConsultant = await visit(treating.id);

      await becomeStaff(tx, other);
      expect(await failure(tx, (sp) => openConsultation(sp, { ...mine, physioId: other.id }))).toBe(
        '42501',
      );
      await becomeStaff(tx, consultant);
      expect(
        await failure(tx, (sp) => openConsultation(sp, { ...booked, physioId: consultant.id })),
      ).toBe('42501');
      await becomeStaff(tx, treating);
      expect(
        await failure(tx, (sp) =>
          openConsultation(sp, { ...notConsultant, physioId: treating.id }),
        ),
      ).toBe('42501');
      await becomeStaff(tx, support);
      expect(
        await failure(tx, (sp) => openConsultation(sp, { ...mine, physioId: support.id })),
      ).toBe('42501');
    });
  });

  it('is read and saved by no one else, and keeps who, where and which version fixed', async () => {
    await rolledBack(async (tx) => {
      const { consultant, other, visit } = await setUp(tx);
      const here = await visit(consultant.id);
      const elsewhere = await visit(consultant.id);
      await becomeStaff(tx, consultant);
      const id = await openConsultation(tx, { ...here, physioId: consultant.id });

      await becomeStaff(tx, other);
      const saved = await tx
        .update(consultation)
        .set({ sections: sections('Not mine') })
        .where(eq(consultation.id, id))
        .returning({ id: consultation.id });
      expect(saved).toEqual([]);
      await becomeStaff(tx, deskHsr);
      expect(await consultationRecord(tx, id)).toBeUndefined();

      await becomeStaff(tx, consultant);
      expect(
        await failure(tx, (sp) =>
          sp.update(consultation).set({ physioId: other.id }).where(eq(consultation.id, id)),
        ),
      ).toBe('23514');
      expect(
        await failure(tx, (sp) =>
          sp
            .update(consultation)
            .set({ episodeId: elsewhere.episodeId })
            .where(eq(consultation.id, id)),
        ),
      ).toBe('23514');
    });
  });

  it('never changes once signed', async () => {
    await rolledBack(async (tx) => {
      const { consultant, visit, versionId } = await setUp(tx);
      const here = await visit(consultant.id);
      // CLN-09 signs; here the owner records a signed one directly.
      const [signed] = await tx
        .insert(consultation)
        .values({
          ...here,
          physioId: consultant.id,
          kbVersionId: versionId,
          status: 'signed',
          signedBy: consultant.id,
          signedAt: new Date(),
        })
        .returning({ id: consultation.id });
      const id = signed?.id ?? '';
      await becomeStaff(tx, consultant);
      const saved = await tx
        .update(consultation)
        .set({ sections: sections('Later') })
        .where(eq(consultation.id, id))
        .returning({ id: consultation.id });
      expect(saved).toEqual([]);
      await tx.execute(sql`reset role`);
      expect(
        await failure(tx, (sp) =>
          sp
            .update(consultation)
            .set({ sections: sections('Later') })
            .where(eq(consultation.id, id)),
        ),
      ).toBe('23514');
    });
  });

  // CLN-03: Subjective shows what the patient told us on the health form.
  it('lets the visit’s own consultant read its submitted health form, and nobody else', async () => {
    await rolledBack(async (tx) => {
      const { consultant, other, visit } = await setUp(tx);
      const here = await visit(consultant.id);
      const link = await insertPatientLink(tx, {
        patientId: here.patientId,
        purpose: 'health_form',
        appointmentId: here.appointmentId,
        expiresAt: new Date(Date.now() + 3600_000),
      });
      await tx.insert(intakeResponse).values({
        appointmentId: here.appointmentId,
        patientId: here.patientId,
        patientLinkId: link.id,
        formVersion: 'hf-3',
        answers: { complaint: 'Pain on stairs', pain_now: 4 },
        submittedAt: new Date(),
      });

      await becomeStaff(tx, consultant);
      expect(await consultationIntake(tx, here.appointmentId)).toEqual({
        formVersion: 'hf-3',
        answers: { complaint: 'Pain on stairs', pain_now: 4 },
      });
      await becomeStaff(tx, other);
      expect(await consultationIntake(tx, here.appointmentId)).toBeUndefined();
      await becomeStaff(tx, deskHsr);
      expect(await consultationIntake(tx, here.appointmentId)).toBeUndefined();
    });
  });

  // CLN-07: the plan's treating physio is someone who treats patients at the visit's centre.
  it('lists the active staff who treat patients at a centre, never support', async () => {
    await rolledBack(async (tx) => {
      const here = await testPhysio(tx, {
        centreIds: [centreIds.hsrLayout],
        createdBy: superAdmin.id,
      });
      const elsewhere = await testPhysio(tx, {
        centreIds: [centreIds.koramangala],
        createdBy: superAdmin.id,
      });
      const gone = await testPhysio(tx, {
        centreIds: [centreIds.hsrLayout],
        createdBy: superAdmin.id,
      });
      await tx.update(staffUser).set({ active: false }).where(eq(staffUser.id, gone.id));
      await becomeStaff(tx, here);
      const ids = (await treatingPhysios(tx, centreIds.hsrLayout)).map((p) => p.id);
      expect(ids).toContain(here.id);
      expect(ids).toContain(member('physio.hsr@clinicmx.test').id);
      expect(ids).not.toContain(elsewhere.id);
      expect(ids).not.toContain(gone.id);
      expect(ids).not.toContain(support.id);
      expect(ids).not.toContain(deskHsr.id);
    });
  });
});
