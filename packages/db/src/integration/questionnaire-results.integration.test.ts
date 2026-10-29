import { addDays, istDate, questionnaireDefinitionSchema } from '@clinic-mx/schemas';
import { and, eq, sql } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { patientActor, setAuditContext, systemActor, withActor } from '../audit';
import { createDb } from '../client';
import type { StaffMember } from '../identity';
import { latestKnowledgeVersion } from '../knowledge';
import { completePatientLinkRow, insertPatientLink } from '../patient-links';
import {
  insertQuestionnaireResult,
  liveQuestionnaireLink,
  questionnaireResults,
  questionnaireTarget,
  questionnairesAnswered,
  questionnairesDue,
} from '../questionnaire-results';
import { auditEvent, episode, kbQuestionnaire, patientLink, planOfCare } from '../schema';
import { centreIds, seedStaff, seedStaffCentres } from '../seed/data';
import { asSystem, episodeThrough, knowledgeVersion, note, visit } from './fake-figures';
import { becomeStaff, testPhysio } from './fake-schedule';

// OUT-02 done when: opened by QR on the patient's phone; one question per screen; auto scored; raw
// answers and version stored. A questionnaire link for an open episode fills the plan's
// questionnaires that can be filled (SET-08), each once; the row keeps both versions; the link
// completes after the last; clinicians read results, nobody signed in writes them. Generated test
// instruments only. Rolled back. CI database only.
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
const deskKoramangala = member('desk.koramangala@clinicmx.test');
const physioKoramangala = member('physio.koramangala@clinicmx.test');
const finance = member('finance@clinicmx.test');

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

async function asLink(tx: Tx, link: { id: string; patientId: string }) {
  await setAuditContext(tx, { actor: patientActor(link.patientId) });
  const claims = JSON.stringify({
    role: 'clinic_patient',
    patient_link: { id: link.id, patient_id: link.patientId, purpose: 'questionnaire' },
  });
  await tx.execute(sql`select set_config('request.jwt.claims', ${claims}, true)`);
  await tx.execute(sql`set local role clinic_patient`);
}

// A generated instrument: two items scored 0 to 4, summed, none may be missing.
const definition = questionnaireDefinitionSchema.parse({
  version: 'test-2',
  items: ['a', 'b'].map((key) => ({
    kind: 'choice',
    key,
    text: `Test item ${key}`,
    options: [0, 1, 2, 3, 4].map((value) => ({ label: `Answer ${String(value)}`, value })),
  })),
  scoring: { method: 'sum', maxMissing: 0 },
  range: { min: 0, max: 8 },
  better: 'lower',
  meaningfulChange: 2,
  source: 'Generated test instrument',
});

/**
 * An Active episode at HSR Layout whose plan names three instruments: two signed off with items
 * and a licence in the live knowledge base version, one still awaiting them.
 */
async function setUp(tx: Tx) {
  await asSystem(tx);
  const physio = await testPhysio(tx, {
    centreIds: [centreIds.hsrLayout],
    consultant: true,
    createdBy: superAdmin.id,
  });
  const kb = await knowledgeVersion(tx);
  // The live version now (the newest approved; else this newest import).
  const live = await latestKnowledgeVersion(tx);
  if (!live) throw new Error('No knowledge base version.');
  for (const [key, ready] of [
    ['test_ready_one', true],
    ['test_ready_two', true],
    ['test_waiting', false],
  ] as const) {
    await tx.insert(kbQuestionnaire).values({
      kbVersionId: live.id,
      key,
      name: `Test ${key}`,
      useFor: 'Tests',
      sort: 900,
      ...(ready ? { definition, licence: 'free' as const, signedOff: true } : {}),
    });
  }
  const opened = await episodeThrough(tx, centreIds.hsrLayout, [
    'awaiting_consultation',
    'plan_proposed',
    'active',
  ]);
  const today = istDate(new Date());
  const seen = await visit(tx, {
    centreId: centreIds.hsrLayout,
    physio,
    type: 'consultation',
    day: addDays(today, -1),
    status: 'completed',
    episodeId: opened.id,
    patientId: opened.patientId,
  });
  const consultationId = await note(tx, {
    appointmentId: seen.id,
    episodeId: opened.id,
    physio,
    kbVersionId: kb,
    signedAt: new Date(Date.now() - 86_400_000),
  });
  await tx.execute(sql`set local session_replication_role = replica`);
  await tx.insert(planOfCare).values({
    episodeId: opened.id,
    consultationId,
    version: 1,
    goals: [{ text: 'Generated goal', patient: true }],
    interventions: ['exercise'],
    sessionsPerWeek: 2,
    weeks: 6,
    homeProgramme: [],
    reviewDate: addDays(today, 30),
    treatingPhysioId: physio.id,
    createdBy: physio.id,
    questionnaires: ['test_waiting', 'test_ready_two', 'test_ready_one'],
  });
  await tx.execute(sql`set local session_replication_role = origin`);
  const link = await insertPatientLink(tx, {
    patientId: opened.patientId,
    purpose: 'questionnaire',
    episodeId: opened.id,
    expiresAt: new Date(Date.now() + 86_400_000),
  });
  return { ...opened, liveId: live.id, link: { id: link.id, patientId: opened.patientId } };
}

describe('patient filled questionnaires', () => {
  it('fills each signed off questionnaire of the plan once, keeping both versions, then completes', async () => {
    await rolledBack(async (tx) => {
      const fixture = await setUp(tx);
      await asLink(tx, fixture.link);
      const due = await questionnairesDue(tx);
      // The plan's order, without the one still awaiting its items.
      expect(due.map((d) => d.key)).toEqual(['test_ready_two', 'test_ready_one']);
      expect(due[0]).toMatchObject({
        patientId: fixture.patientId,
        episodeId: fixture.id,
        centreId: centreIds.hsrLayout,
        kbVersionId: fixture.liveId,
        definition,
      });
      const [first, second] = due;
      if (!first || !second) throw new Error('two due');
      const keep = (filling: typeof first, a: number, into: Tx = tx) =>
        insertQuestionnaireResult(into, {
          linkId: fixture.link.id,
          due: filling,
          rawAnswers: { a: { value: a }, b: { value: 1 } },
          score: a + 1,
          answered: 2,
          missing: 0,
        });
      await keep(first, 3);
      expect(await questionnairesAnswered(tx)).toBe(1);
      expect((await questionnairesDue(tx)).map((d) => d.key)).toEqual(['test_ready_one']);
      expect(await failure(tx, (sp) => keep(first, 2, sp)), 'the same one again').toBe('42501');
      // Not done yet: the link does not complete.
      expect(await failure(tx, (sp) => completePatientLinkRow(sp, fixture.link.id))).toBe('42501');
      await keep(second, 0);
      expect(await completePatientLinkRow(tx, fixture.link.id)).toBe(true);
      expect(await questionnairesDue(tx)).toEqual([]);

      await asSystem(tx);
      await becomeStaff(tx, physioKoramangala);
      const results = await questionnaireResults(tx, fixture.id);
      expect(results.map((r) => [r.instrumentKey, r.instrumentVersion, r.score])).toEqual([
        ['test_ready_two', 'test-2', 4],
        ['test_ready_one', 'test-2', 1],
      ]);
      expect(results.every((r) => r.kbVersionId === fixture.liveId)).toBe(true);
      await asSystem(tx);
      const audited = await tx
        .select({ actor: auditEvent.actor })
        .from(auditEvent)
        .where(and(eq(auditEvent.entity, 'questionnaire_result'), eq(auditEvent.action, 'insert')))
        .orderBy(auditEvent.id);
      expect(audited.slice(-2)).toEqual([
        { actor: `patient:${fixture.patientId}` },
        { actor: `patient:${fixture.patientId}` },
      ]);
    });
  });

  it('refuses a result for an instrument not due, another version, another episode, or a closed link', async () => {
    await rolledBack(async (tx) => {
      const fixture = await setUp(tx);
      await asLink(tx, fixture.link);
      const [due] = await questionnairesDue(tx);
      if (!due) throw new Error('due');
      const keep = (change: Partial<typeof due>) =>
        failure(tx, (sp) =>
          insertQuestionnaireResult(sp, {
            linkId: fixture.link.id,
            due: { ...due, ...change },
            rawAnswers: {},
            score: null,
            answered: 0,
            missing: 2,
          }),
        );
      expect(await keep({ key: 'test_waiting' }), 'awaiting items').toBe('42501');
      expect(
        await keep({ definition: { ...definition, version: 'other' } }),
        'another version',
      ).toBe('42501');
      expect(await keep({ centreId: centreIds.koramangala }), 'another centre').toBe('42501');
      // A stopped link fills nothing.
      await asSystem(tx);
      await tx
        .update(patientLink)
        .set({ revokedAt: new Date() })
        .where(eq(patientLink.id, fixture.link.id));
      await asLink(tx, fixture.link);
      expect(await questionnairesDue(tx)).toEqual([]);
      expect(await keep({}), 'stopped').toBe('42501');
    });
  });

  it('offers nothing once the episode is discharged, and nobody signed in writes a result', async () => {
    await rolledBack(async (tx) => {
      const fixture = await setUp(tx);
      await tx.execute(sql`set local session_replication_role = replica`);
      await tx
        .update(episode)
        .set({ status: 'discharged', closedAt: new Date(), dischargeReason: 'goals_achieved' })
        .where(eq(episode.id, fixture.id));
      await tx.execute(sql`set local session_replication_role = origin`);
      await asLink(tx, fixture.link);
      expect(await questionnairesDue(tx)).toEqual([]);
      await asSystem(tx);
      for (const actor of [superAdmin, deskHsr]) {
        await becomeStaff(tx, actor);
        expect(
          await failure(tx, (sp) =>
            sp.execute(sql`insert into questionnaire_result
              (patient_link_id, patient_id, episode_id, centre_id, kb_version_id, instrument_key,
               instrument_version, raw_answers, answered, missing)
              values (${fixture.link.id}, ${fixture.patientId}, ${fixture.id}, ${centreIds.hsrLayout},
               ${fixture.liveId}, 'test_ready_one', 'test-2', '{}'::jsonb, 0, 2)`),
          ),
          actor.email,
        ).toBe('42501');
        await asSystem(tx);
      }
    });
  });

  it('shows the desk at the centre what can be filled, and lets it issue a link only then', async () => {
    await rolledBack(async (tx) => {
      const fixture = await setUp(tx);
      const issue = (sp: Tx) =>
        insertPatientLink(sp, {
          patientId: fixture.patientId,
          purpose: 'questionnaire',
          episodeId: fixture.id,
          expiresAt: new Date(Date.now() + 86_400_000),
        });
      await becomeStaff(tx, deskHsr);
      expect(await questionnaireTarget(tx, fixture.id)).toEqual({
        patientId: fixture.patientId,
        assigned: 3,
        fillable: 2,
      });
      expect(await failure(tx, issue)).toBeUndefined();
      for (const outsider of [deskKoramangala, finance]) {
        await asSystem(tx);
        await becomeStaff(tx, outsider);
        expect(await questionnaireTarget(tx, fixture.id), outsider.email).toBeUndefined();
        expect(await failure(tx, issue), outsider.email).toBe('42501');
      }
      // Nothing to fill: no link.
      await asSystem(tx);
      await tx
        .update(kbQuestionnaire)
        .set({ signedOff: false })
        .where(eq(kbQuestionnaire.kbVersionId, fixture.liveId));
      await becomeStaff(tx, deskHsr);
      expect(await questionnaireTarget(tx, fixture.id)).toMatchObject({ fillable: 0 });
      expect(await failure(tx, issue)).toBe('42501');
    });
  });

  it('never shows the desk a link with everything filled, even before the page closes it', async () => {
    await rolledBack(async (tx) => {
      const fixture = await setUp(tx);
      await becomeStaff(tx, deskHsr);
      expect(await liveQuestionnaireLink(tx, fixture.id), 'a fresh link').toMatchObject({
        id: fixture.link.id,
      });
      await asSystem(tx);
      await asLink(tx, fixture.link);
      for (const filling of await questionnairesDue(tx)) {
        await insertQuestionnaireResult(tx, {
          linkId: fixture.link.id,
          due: filling,
          rawAnswers: { a: { value: 0 }, b: { value: 0 } },
          score: 0,
          answered: 2,
          missing: 0,
        });
      }
      await asSystem(tx);
      await becomeStaff(tx, deskHsr);
      expect(await liveQuestionnaireLink(tx, fixture.id), 'all filled').toBeUndefined();
    });
  });

  it('is read by clinicians, not the desk or Finance', async () => {
    await rolledBack(async (tx) => {
      const fixture = await setUp(tx);
      await asLink(tx, fixture.link);
      const [due] = await questionnairesDue(tx);
      if (!due) throw new Error('due');
      await insertQuestionnaireResult(tx, {
        linkId: fixture.link.id,
        due,
        rawAnswers: { a: { value: 1 }, b: { value: 1 } },
        score: 2,
        answered: 2,
        missing: 0,
      });
      const reads = async (actor: StaffMember) => {
        await asSystem(tx);
        await becomeStaff(tx, actor);
        return (await questionnaireResults(tx, fixture.id)).length;
      };
      expect(await reads(physioKoramangala)).toBe(1);
      expect(await reads(superAdmin)).toBe(1);
      for (const outsider of [deskHsr, finance]) {
        expect(await reads(outsider), outsider.email).toBe(0);
      }
    });
  });
});
