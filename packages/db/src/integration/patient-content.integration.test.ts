import { and, eq, sql } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { systemActor, withActor } from '../audit';
import { createDb } from '../client';
import type { StaffMember } from '../identity';
import {
  approvePatientContent,
  discardPatientContentDraft,
  liveKbVersionId,
  patientContentList,
  patientContentOf,
  savePatientContentDraft,
} from '../patient-content';
import { auditEvent, kbCondition, kbPatientContent, staffUser } from '../schema';
import { centreIds, seedStaff, seedStaffCentres } from '../seed/data';
import { knowledgeVersion } from './fake-figures';
import { becomeStaff, testPhysio } from './fake-schedule';

// AI-07 done when: content generated once per condition; clinician approves before patients see
// it. A consultant who treats patients writes a condition's one draft against the live knowledge
// base version, edits, discards or approves it, each on the revision read; approving supersedes the
// approved text, which never changes. Everyone who reads the knowledge base reads it. Generated
// text only. Rolled back. CI database only.
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
const deskHsr = member('desk.hsr@clinicmx.test');
const finance = member('finance@clinicmx.test');
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
  await tx.execute(sql`select set_config('request.jwt.claims', '', true)`);
}

const text = (word: string) => ({
  explanation: `Test explanation ${word}`,
  roadmap: `Test roadmap ${word}`,
  homeAdvice: `Test home advice ${word}`,
  warningSigns: `Test warning signs ${word}`,
});

/** Two consultants who treat patients, a physio who does not consult, and a live condition. */
async function setUp(tx: Tx) {
  const consultant = await testPhysio(tx, {
    centreIds: [centreIds.hsrLayout],
    consultant: true,
    createdBy: superAdmin.id,
  });
  const second = await testPhysio(tx, {
    centreIds: [centreIds.hsrLayout],
    consultant: true,
    createdBy: superAdmin.id,
  });
  const physio = await testPhysio(tx, {
    centreIds: [centreIds.hsrLayout],
    createdBy: superAdmin.id,
  });
  await becomeStaff(tx, consultant);
  const [first] = await patientContentList(tx);
  if (!first) throw new Error('The live knowledge base has no conditions.');
  await asOwner(tx);
  return {
    consultant: { ...consultant, consultant: true },
    second: { ...second, consultant: true },
    physio,
    conditionId: first.conditionId,
  };
}

/** The condition's draft as read: its id and revision. */
async function draftOf(tx: Tx, conditionId: string) {
  const { draft } = await patientContentOf(tx, conditionId);
  if (!draft) throw new Error('No draft.');
  return { draftId: draft.id, revision: draft.revision };
}

describe('patient content', () => {
  it('is drafted, edited and approved on the revision read, then superseded, never changed', async () => {
    await rolledBack(async (tx) => {
      const { consultant, second, conditionId } = await setUp(tx);
      await becomeStaff(tx, consultant);
      const draftId = await savePatientContentDraft(tx, { conditionId, ...text('one') });
      if (!draftId) throw new Error('not saved');
      expect(await patientContentList(tx)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ conditionId, draft: true, approved: false }),
        ]),
      );
      // Saved again on the revision read: the same draft, the next revision.
      expect(
        await savePatientContentDraft(
          tx,
          { conditionId, ...text('two') },
          { draftId, revision: 1 },
        ),
      ).toBe(draftId);
      const { draft } = await patientContentOf(tx, conditionId);
      expect(draft).toMatchObject({
        id: draftId,
        revision: 2,
        ...text('two'),
        source: 'clinician',
        writtenByName: consultant.name,
      });
      // A save or an approval on revision 1, read before the change, is refused.
      expect(
        await savePatientContentDraft(
          tx,
          { conditionId, ...text('old') },
          { draftId, revision: 1 },
        ),
      ).toBeUndefined();
      expect(await failure(tx, (sp) => approvePatientContent(sp, draftId, 1))).toBe('23514');
      // A second first draft for the condition is refused.
      expect(
        await failure(tx, (sp) => savePatientContentDraft(sp, { conditionId, ...text('x') })),
      ).toBe('23505');
      await approvePatientContent(tx, draftId, 2);
      const once = await patientContentOf(tx, conditionId);
      expect(once.draft).toBeUndefined();
      expect(once.approved).toMatchObject({
        id: draftId,
        ...text('two'),
        approvedByName: consultant.name,
      });

      // An approved text never changes, keeps its id, and is never removed or truncated, even by
      // the database owner.
      await asOwner(tx);
      for (const [name, statement] of [
        [
          'change',
          sql`update kb_patient_content set explanation = 'Changed' where id = ${draftId}`,
        ],
        ['new id', sql`update kb_patient_content set id = gen_random_uuid() where id = ${draftId}`],
        ['remove', sql`delete from kb_patient_content where id = ${draftId}`],
        ['truncate', sql`truncate kb_patient_content`],
      ] as const) {
        expect(await failure(tx, (sp) => sp.execute(statement)), name).toBe('23514');
      }

      // Another consultant's new draft, approved, supersedes it.
      await becomeStaff(tx, second);
      const next = await savePatientContentDraft(tx, { conditionId, ...text('three') });
      if (!next) throw new Error('not saved');
      await approvePatientContent(tx, next, 1);
      expect((await patientContentOf(tx, conditionId)).approved).toMatchObject({
        id: next,
        ...text('three'),
      });
      await asOwner(tx);
      const statuses = await tx
        .select({ id: kbPatientContent.id, status: kbPatientContent.status })
        .from(kbPatientContent)
        .where(eq(kbPatientContent.conditionId, conditionId));
      expect(statuses).toEqual(
        expect.arrayContaining([
          { id: draftId, status: 'superseded' },
          { id: next, status: 'approved' },
        ]),
      );
      const audited = await tx
        .select({ actor: auditEvent.actor })
        .from(auditEvent)
        .where(and(eq(auditEvent.entity, 'kb_patient_content'), eq(auditEvent.entityId, next)));
      expect(audited.map((row) => row.actor)).toContain(`staff:${second.id}`);
    });
  });

  it('is written and approved by nobody else, and a draft is discarded', async () => {
    await rolledBack(async (tx) => {
      const { consultant, physio, conditionId } = await setUp(tx);
      // A desk login given both ticks still writes nothing: the role reads no knowledge base.
      await tx
        .update(staffUser)
        .set({ consultant: true, treatsPatients: true })
        .where(eq(staffUser.id, deskHsr.id));
      for (const outsider of [physio, deskHsr, finance, support]) {
        await asOwner(tx);
        await becomeStaff(tx, outsider);
        expect(
          await failure(tx, (sp) => savePatientContentDraft(sp, { conditionId, ...text('x') })),
          outsider.email,
        ).toBe('42501');
      }
      await asOwner(tx);
      await becomeStaff(tx, consultant);
      const read = await (async () => {
        await savePatientContentDraft(tx, { conditionId, ...text('one') });
        return draftOf(tx, conditionId);
      })();
      // The seeded Super Admin consults and treats patients, so may approve; others never do.
      for (const outsider of [physio, deskHsr, support]) {
        await asOwner(tx);
        await becomeStaff(tx, outsider);
        expect(
          await failure(tx, (sp) => approvePatientContent(sp, read.draftId, read.revision)),
          outsider.email,
        ).toBe('42501');
      }
      await asOwner(tx);
      await becomeStaff(tx, consultant);
      expect(await discardPatientContentDraft(tx, read.draftId)).toBe(true);
      expect((await patientContentOf(tx, conditionId)).draft).toBeUndefined();
    });
  });

  it('is written against the live version, and a draft on an older one is not approved', async () => {
    await rolledBack(async (tx) => {
      const { consultant, conditionId } = await setUp(tx);
      await becomeStaff(tx, consultant);
      expect(
        await failure(tx, (sp) =>
          savePatientContentDraft(sp, { conditionId: 'ZZZ-999', ...text('x') }),
        ),
        'no such condition',
      ).toBe('23503');
      await savePatientContentDraft(tx, { conditionId, ...text('one') });
      const read = await draftOf(tx, conditionId);
      const before = await liveKbVersionId(tx);
      // A newer import goes live (no version approved here) without that condition.
      await asOwner(tx);
      await knowledgeVersion(tx);
      await becomeStaff(tx, consultant);
      const after = await liveKbVersionId(tx);
      if (after === before) return; // An approved version keeps this database's live one.
      expect(
        await failure(tx, (sp) => approvePatientContent(sp, read.draftId, read.revision)),
        'an older version',
      ).toBe('23514');
      // Nor is a new draft written against the old version.
      expect(
        await failure(tx, (sp) =>
          sp.insert(kbPatientContent).values({
            conditionId: 'ZZZ-998',
            kbVersionId: before ?? '',
            source: 'clinician',
            ...text('x'),
          }),
        ),
      ).toBeDefined();
      // And saving it again needs the condition in the live version.
      expect(
        await failure(tx, (sp) =>
          savePatientContentDraft(sp, { conditionId, ...text('two') }, read),
        ),
      ).toBe('23503');
      await asOwner(tx);
      const [inLive] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(kbCondition)
        .where(
          and(eq(kbCondition.kbVersionId, after ?? ''), eq(kbCondition.conditionId, conditionId)),
        );
      expect(inLive?.n).toBe(0);
    });
  });

  it('is read by those who read the knowledge base, not the desk or Finance', async () => {
    await rolledBack(async (tx) => {
      const { consultant, physio, conditionId } = await setUp(tx);
      await becomeStaff(tx, consultant);
      await savePatientContentDraft(tx, { conditionId, ...text('one') });
      const reads = async (actor: StaffMember) => {
        await asOwner(tx);
        await becomeStaff(tx, actor);
        return (await patientContentOf(tx, conditionId)).draft !== undefined;
      };
      for (const reader of [physio, manager, superAdmin]) {
        expect(await reads(reader), reader.email).toBe(true);
      }
      for (const outsider of [deskHsr, finance]) {
        expect(await reads(outsider), outsider.email).toBe(false);
      }
    });
  });
});
