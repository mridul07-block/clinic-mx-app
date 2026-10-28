import { earlierToday, type EpisodeStatus } from '@clinic-mx/schemas';
import { and, asc, eq, sql } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { systemActor, withActor } from '../audit';
import { createDb } from '../client';
import {
  latestConfirmedDiagnosis,
  latestSignedDiagnosis,
  recordConfirmedDiagnosis,
} from '../confirmed-diagnosis';
import { insertEpisode, updateEpisodeState } from '../episodes';
import { insertPatientLink } from '../patient-links';
import type { StaffMember } from '../identity';
import { latestKnowledgeVersion } from '../knowledge';
import {
  appointment,
  auditEvent,
  confirmedDiagnosis,
  consultation,
  diagnosis,
  intakeResponse,
  kbCondition,
} from '../schema';
import { centreIds, seedStaff, seedStaffCentres } from '../seed/data';
import { similarCasePool } from '../similar-cases';
import { becomeStaff, testPatient, testPhysio, typeId } from './fake-schedule';

// AI-05: the diagnosis confirmed at review or discharge, the learning label (PRD section 6). An
// active consultant with the Treats patients tick confirms the latest signed diagnosis or changes it
// within its knowledge base version; the database stamps the stage, who and when; nothing changes
// after. Every test runs in a transaction that is rolled back. CI database only.
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
const desk = member('desk.hsr@clinicmx.test');

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

/** The Postgres error code a statement failed with, inside a savepoint; undefined if none. */
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

async function asSystem(tx: Tx) {
  await tx.execute(sql`reset role`);
  await tx.execute(sql`select set_config('request.jwt.claims', '', true)`);
  await tx.execute(sql`select set_config('audit.actor', 'system:tests', true)`);
}

const path: EpisodeStatus[] = [
  'intake_pending',
  'awaiting_consultation',
  'plan_proposed',
  'active',
];

/** A generated Active episode at HSR Layout with a signed consultation and its diagnosis. */
async function setUp(tx: Tx) {
  const version = await latestKnowledgeVersion(tx);
  if (!version) throw new Error('The knowledge base is not imported.');
  const knee = await tx
    .select({ conditionId: kbCondition.conditionId, name: kbCondition.name })
    .from(kbCondition)
    .where(and(eq(kbCondition.kbVersionId, version.id), eq(kbCondition.homeRegion, 'knee')))
    .orderBy(asc(kbCondition.conditionId))
    .limit(2);
  const [first, second] = knee;
  if (!first || !second) throw new Error('The knowledge base has too few knee conditions.');
  const consultant = await testPhysio(tx, {
    centreIds: [centreIds.hsrLayout, centreIds.whitefield],
    consultant: true,
    createdBy: superAdmin.id,
  });
  const notConsultant = await testPhysio(tx, {
    centreIds: [centreIds.hsrLayout],
    createdBy: superAdmin.id,
  });
  let visits = 0;
  /** A signed episode with its submitted health form; another patient's unless one is given. */
  const signedEpisode = async (
    options: {
      patientId?: string;
      centreId?: string;
      answers?: Record<string, unknown>;
      /** Moved on to Under review, so its diagnosis can be confirmed (the default). */
      reviewed?: boolean;
    } = {},
  ) => {
    const patientId = options.patientId ?? (await testPatient(tx));
    const centreId = options.centreId ?? centreIds.hsrLayout;
    const episodeId = await insertEpisode(tx, { patientId, centreId });
    for (let step = 1; step < path.length; step++) {
      await updateEpisodeState(tx, episodeId, path[step - 1] as EpisodeStatus, {
        status: path[step] as EpisodeStatus,
        pausedFrom: null,
      });
    }
    // Each two minutes apart, so the consultant's visits never overlap.
    visits += 1;
    const startsAt = earlierToday(-30 - 2 * visits);
    const [visit] = await tx
      .insert(appointment)
      .values({
        number: '',
        patientId,
        centreId,
        physioId: consultant.id,
        appointmentTypeId: await typeId(tx, 'consultation'),
        episodeId,
        startsAt,
        endsAt: new Date(startsAt.getTime() + 60000),
        channel: 'front_desk',
        bookedBy: superAdmin.id,
      })
      .returning({ id: appointment.id });
    if (!visit) throw new Error('no visit');
    const link = await insertPatientLink(tx, {
      patientId,
      purpose: 'health_form',
      appointmentId: visit.id,
      expiresAt: new Date(Date.now() + 3600_000),
    });
    await tx.insert(intakeResponse).values({
      appointmentId: visit.id,
      patientId,
      patientLinkId: link.id,
      formVersion: 'hf-3',
      answers: { region: 'knee', onset: 'gradual', ...options.answers },
      submittedAt: new Date(),
      episodeId,
    });
    const [signed] = await tx
      .insert(consultation)
      .values({
        appointmentId: visit.id,
        episodeId,
        physioId: consultant.id,
        kbVersionId: version.id,
        sections: {},
        status: 'signed',
        signedBy: consultant.id,
        signedAt: new Date(),
      })
      .returning({ id: consultation.id });
    if (!signed) throw new Error('no consultation');
    await tx.insert(diagnosis).values({
      consultationId: signed.id,
      episodeId,
      kbVersionId: version.id,
      conditionId: first.conditionId,
      movementDx: 'Generated movement diagnosis',
      irritability: 'moderate',
      stage: 'subacute',
      provisional: true,
    });
    const source = await latestSignedDiagnosis(tx, episodeId);
    if (!source) throw new Error('no signed diagnosis');
    if (options.reviewed ?? true) {
      await updateEpisodeState(tx, episodeId, 'active', {
        status: 'under_review',
        pausedFrom: null,
      });
    }
    return { episodeId, patientId, source };
  };
  return { version, first, second, consultant, notConsultant, signedEpisode };
}

describe('the confirmed diagnosis', () => {
  it('is confirmed or changed by a consultant who treats patients, stamped and audited', async () => {
    await rolledBack(async (tx) => {
      const s = await setUp(tx);
      const { episodeId, source } = await s.signedEpisode();
      await becomeStaff(tx, s.consultant);
      expect(
        await recordConfirmedDiagnosis(tx, {
          episodeId,
          source,
          conditionId: s.first.conditionId,
          by: s.consultant.id,
        }),
      ).toBe('review');
      expect(await latestConfirmedDiagnosis(tx, episodeId)).toMatchObject({
        conditionId: s.first.conditionId,
        stage: 'review',
        changed: false,
      });
      // Changed: the later confirmation is the label; the first stays as it was.
      await recordConfirmedDiagnosis(tx, {
        episodeId,
        source,
        conditionId: s.second.conditionId,
        by: s.consultant.id,
      });
      expect(await latestConfirmedDiagnosis(tx, episodeId)).toMatchObject({
        conditionId: s.second.conditionId,
        name: s.second.name,
        changed: true,
      });
      // Nobody changes or deletes one, nor writes it in another's name.
      expect(
        await failure(tx, (sp) =>
          sp
            .update(confirmedDiagnosis)
            .set({ conditionId: s.first.conditionId })
            .where(eq(confirmedDiagnosis.episodeId, episodeId)),
        ),
      ).toBe('42501');
      expect(
        await failure(tx, (sp) =>
          sp.delete(confirmedDiagnosis).where(eq(confirmedDiagnosis.episodeId, episodeId)),
        ),
      ).toBe('42501');
      await asSystem(tx);
      const rows = await tx
        .select({ by: confirmedDiagnosis.confirmedBy, at: confirmedDiagnosis.confirmedAt })
        .from(confirmedDiagnosis)
        .where(eq(confirmedDiagnosis.episodeId, episodeId));
      expect(rows).toHaveLength(2);
      expect(rows.every((r) => r.by === s.consultant.id)).toBe(true);
      const [audited] = await tx
        .select({ actor: auditEvent.actor, action: auditEvent.action })
        .from(auditEvent)
        .where(eq(auditEvent.entity, 'confirmed_diagnosis'))
        .orderBy(sql`${auditEvent.id} desc`)
        .limit(1);
      expect(audited).toMatchObject({ actor: `staff:${s.consultant.id}` });
    });
  });

  it('is At discharge once the episode is discharged', async () => {
    await rolledBack(async (tx) => {
      const s = await setUp(tx);
      const { episodeId, source } = await s.signedEpisode();
      await becomeStaff(tx, s.consultant);
      await updateEpisodeState(
        tx,
        episodeId,
        'under_review',
        { status: 'discharged', pausedFrom: null },
        { reason: 'goals_achieved' },
      );
      expect(
        await recordConfirmedDiagnosis(tx, {
          episodeId,
          source,
          conditionId: s.first.conditionId,
          by: s.consultant.id,
        }),
      ).toBe('discharge');
    });
  });

  it('is refused to others, and against anything but the latest signed diagnosis', async () => {
    await rolledBack(async (tx) => {
      const s = await setUp(tx);
      const { episodeId, source } = await s.signedEpisode();
      const other = await s.signedEpisode();
      const confirm = (sp: Tx, by: string, values: Partial<{ source: typeof source }> = {}) =>
        recordConfirmedDiagnosis(sp, {
          episodeId,
          source: values.source ?? source,
          conditionId: s.first.conditionId,
          by,
        });
      for (const someone of [s.notConsultant, desk]) {
        await becomeStaff(tx, someone);
        expect(await failure(tx, (sp) => confirm(sp, someone.id)), someone.email).toBe('42501');
        await asSystem(tx);
      }
      await becomeStaff(tx, s.consultant);
      // Not yet reviewed: never the first impression.
      const early = await (async () => {
        await asSystem(tx);
        const e = await s.signedEpisode({ reviewed: false });
        await becomeStaff(tx, s.consultant);
        return e;
      })();
      expect(
        await failure(tx, (sp) =>
          recordConfirmedDiagnosis(sp, {
            episodeId: early.episodeId,
            source: early.source,
            conditionId: s.first.conditionId,
            by: s.consultant.id,
          }),
        ),
      ).toBe('23514');
      // Another episode's diagnosis.
      expect(
        await failure(tx, (sp) => confirm(sp, s.consultant.id, { source: other.source })),
      ).toBe('23514');
      // A condition of the signed diagnosis's version only (the foreign key).
      expect(
        await failure(tx, (sp) =>
          recordConfirmedDiagnosis(sp, {
            episodeId,
            source,
            conditionId: 'NOT-A-CONDITION',
            by: s.consultant.id,
          }),
        ),
      ).toBe('23503');
      await asSystem(tx);
      // Nobody signed in: the system never confirms a diagnosis.
      expect(await failure(tx, (sp) => confirm(sp, s.consultant.id))).toBe('42501');
    });
  });
});

// AI-05: the pool similar confirmed cases are drawn from: confirmed episodes at any centre, never
// the patient's own, each with its latest confirmation and latest submitted form.
describe('the similar case pool', () => {
  it('holds confirmed episodes at every centre, but the patient’s own', async () => {
    await rolledBack(async (tx) => {
      const s = await setUp(tx);
      const current = await s.signedEpisode();
      const own = await s.signedEpisode({ patientId: current.patientId });
      const hsr = await s.signedEpisode({ answers: { sex: 'female' } });
      const whitefield = await s.signedEpisode({ centreId: centreIds.whitefield });
      const unconfirmed = await s.signedEpisode();
      await becomeStaff(tx, s.consultant);
      for (const e of [own, hsr, whitefield]) {
        await recordConfirmedDiagnosis(tx, {
          episodeId: e.episodeId,
          source: e.source,
          conditionId: s.first.conditionId,
          by: s.consultant.id,
        });
      }
      // Changed later: the latest confirmation is the one used.
      await recordConfirmedDiagnosis(tx, {
        episodeId: whitefield.episodeId,
        source: whitefield.source,
        conditionId: s.second.conditionId,
        by: s.consultant.id,
      });
      await asSystem(tx);
      const ours = new Set([own, hsr, whitefield, unconfirmed].map((e) => e.episodeId));
      const pool = (await similarCasePool(tx, current.patientId)).filter((row) =>
        ours.has(row.episodeId),
      );
      expect(pool.map((row) => [row.episodeId, row.conditionId]).sort()).toEqual(
        [
          [hsr.episodeId, s.first.conditionId],
          [whitefield.episodeId, s.second.conditionId],
        ].sort(),
      );
      expect(pool.find((row) => row.episodeId === hsr.episodeId)).toMatchObject({
        answers: { region: 'knee', sex: 'female' },
        conditionName: s.first.name,
      });
    });
  });
});
