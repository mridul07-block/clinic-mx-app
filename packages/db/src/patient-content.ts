import type { PatientContentDraft, PatientContentSource } from '@clinic-mx/schemas';
import { and, desc, eq, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { kbPatientContent, staffUser } from './schema';
import type { DbOrTransaction } from './versioned';

/**
 * Patient content per condition (AI-07; docs/runbooks/patient-content.md): the conditions of the
 * live knowledge base version with where their content stands, a condition's draft and approved
 * text, and the consultant's draft, discard and approval. Under the reader's own access.
 */

/** A condition of the live version and whether it has a draft and approved content. */
export interface PatientContentListEntry {
  conditionId: string;
  name: string;
  draft: boolean;
  approved: boolean;
}

/** The live version's conditions, by name, with their content's state. */
export async function patientContentList(db: DbOrTransaction): Promise<PatientContentListEntry[]> {
  const rows = await db.execute<{
    condition_id: string;
    name: string;
    draft: boolean;
    approved: boolean;
  }>(sql`
    select c.condition_id, min(c.name) as name,
      exists (select 1 from kb_patient_content p
        where p.condition_id = c.condition_id and p.status = 'draft') as draft,
      exists (select 1 from kb_patient_content p
        where p.condition_id = c.condition_id and p.status = 'approved') as approved
    from kb_condition c
    where c.kb_version_id = internal.live_kb_version()
    group by c.condition_id
    order by min(c.name), c.condition_id`);
  return rows.map((row) => ({
    conditionId: row.condition_id,
    name: row.name,
    draft: row.draft,
    approved: row.approved,
  }));
}

/** A condition's name in the live version; undefined when it is not there. */
export async function liveConditionName(
  db: DbOrTransaction,
  conditionId: string,
): Promise<string | undefined> {
  const [row] = await db.execute<{ name: string }>(sql`
    select c.name from kb_condition c
    where c.kb_version_id = internal.live_kb_version() and c.condition_id = ${conditionId}
    limit 1`);
  return row?.name;
}

/** One text of a condition's content, with who wrote and approved it. */
export interface PatientContentEntry extends PatientContentDraft {
  id: string;
  source: PatientContentSource;
  writtenByName: string | null;
  approvedByName: string | null;
  approvedAt: Date | null;
  updatedAt: Date;
  /** Counts the draft's saves; a decision or a save names the one read. */
  revision: number;
  /** The knowledge base version it was written against. */
  kbVersionId: string;
}

const writer = alias(staffUser, 'patient_content_writer');
const approver = alias(staffUser, 'patient_content_approver');

/** A condition's draft and approved text (each undefined when there is none). */
export async function patientContentOf(
  db: DbOrTransaction,
  conditionId: string,
): Promise<{ draft?: PatientContentEntry; approved?: PatientContentEntry }> {
  const rows = await db
    .select({
      id: kbPatientContent.id,
      conditionId: kbPatientContent.conditionId,
      status: kbPatientContent.status,
      explanation: kbPatientContent.explanation,
      roadmap: kbPatientContent.roadmap,
      homeAdvice: kbPatientContent.homeAdvice,
      warningSigns: kbPatientContent.warningSigns,
      source: kbPatientContent.source,
      writtenByName: writer.name,
      approvedByName: approver.name,
      approvedAt: kbPatientContent.approvedAt,
      updatedAt: kbPatientContent.updatedAt,
      revision: kbPatientContent.revision,
      kbVersionId: kbPatientContent.kbVersionId,
    })
    .from(kbPatientContent)
    .leftJoin(writer, eq(writer.id, kbPatientContent.writtenBy))
    .leftJoin(approver, eq(approver.id, kbPatientContent.approvedBy))
    .where(
      and(
        eq(kbPatientContent.conditionId, conditionId),
        sql`${kbPatientContent.status} in ('draft', 'approved')`,
      ),
    )
    .orderBy(desc(kbPatientContent.createdAt));
  const entry = (status: 'draft' | 'approved') => {
    const row = rows.find((each) => each.status === status);
    if (!row) return undefined;
    return {
      id: row.id,
      conditionId: row.conditionId,
      explanation: row.explanation,
      roadmap: row.roadmap,
      homeAdvice: row.homeAdvice,
      warningSigns: row.warningSigns,
      source: row.source,
      writtenByName: row.writtenByName,
      approvedByName: row.approvedByName,
      approvedAt: row.approvedAt,
      updatedAt: row.updatedAt,
      revision: row.revision,
      kbVersionId: row.kbVersionId,
    };
  };
  return { draft: entry('draft'), approved: entry('approved') };
}

/** The live knowledge base version's id; undefined before the first import. */
export async function liveKbVersionId(db: DbOrTransaction): Promise<string | undefined> {
  const [row] = await db.execute<{ id: string | null }>(
    sql`select internal.live_kb_version() as id`,
  );
  return row?.id ?? undefined;
}

/**
 * Saves the condition's draft as the consultant signed in, against the live version: the draft and
 * revision read, changed only if it is still that revision; or, with none read, a new draft. The
 * draft's id, or undefined when the draft read has changed or gone.
 */
export async function savePatientContentDraft(
  db: DbOrTransaction,
  draft: PatientContentDraft,
  read?: { draftId: string; revision: number },
): Promise<string | undefined> {
  const text = {
    explanation: draft.explanation,
    roadmap: draft.roadmap,
    homeAdvice: draft.homeAdvice,
    warningSigns: draft.warningSigns,
    kbVersionId: sql<string>`internal.live_kb_version()`,
  };
  if (read) {
    const [changed] = await db
      .update(kbPatientContent)
      .set(text)
      .where(
        and(
          eq(kbPatientContent.id, read.draftId),
          eq(kbPatientContent.conditionId, draft.conditionId),
          eq(kbPatientContent.status, 'draft'),
          eq(kbPatientContent.revision, read.revision),
        ),
      )
      .returning({ id: kbPatientContent.id });
    return changed?.id;
  }
  const [made] = await db
    .insert(kbPatientContent)
    .values({ ...text, conditionId: draft.conditionId, source: 'clinician' })
    .returning({ id: kbPatientContent.id });
  if (!made) throw new Error('The draft was not saved.');
  return made.id;
}

/** Discards the condition's draft; whether there was one to discard. */
export async function discardPatientContentDraft(
  db: DbOrTransaction,
  draftId: string,
): Promise<boolean> {
  const gone = await db
    .delete(kbPatientContent)
    .where(and(eq(kbPatientContent.id, draftId), eq(kbPatientContent.status, 'draft')))
    .returning({ id: kbPatientContent.id });
  return gone.length > 0;
}

/**
 * Approves the revision of a draft the consultant read, as them; it supersedes the condition's
 * approved text. The database refuses another revision or a draft on an older version.
 */
export async function approvePatientContent(
  db: DbOrTransaction,
  draftId: string,
  revision: number,
): Promise<void> {
  await db.execute(
    sql`select internal.approve_patient_content(${draftId}::uuid, ${revision}::int)`,
  );
}
