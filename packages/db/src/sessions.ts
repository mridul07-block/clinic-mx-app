import type { EpisodeStatus, InterventionKind, SessionStatus } from '@clinic-mx/schemas';
import { and, desc, eq, sql } from 'drizzle-orm';
import {
  consultation,
  kbModality,
  planModality,
  planOfCare,
  staffUser,
  treatmentSession,
} from './schema';
import { updateVersioned, type DbOrTransaction, type VersionedResult } from './versioned';

/**
 * Treatment sessions at check in (SES-01; docs/runbooks/sessions.md): for each appointment of a
 * session type, its number in the episode once checked in, the plan's planned sessions and the
 * episode's status, from `internal.session_progress` (answers only for centres the reader sees).
 */

export interface SessionProgress {
  /** Null until the appointment is checked in, or outside an episode. */
  number: number | null;
  /** Sessions per week x weeks of the newest plan; null without a frequency. */
  planned: number | null;
  /** Null for an appointment outside an episode. */
  episodeStatus: EpisodeStatus | null;
}

/** Session progress by appointment id; appointments of other types are absent. */
export async function sessionProgress(
  db: DbOrTransaction,
  appointmentIds: readonly string[],
): Promise<Map<string, SessionProgress>> {
  if (appointmentIds.length === 0) return new Map();
  const rows = await db.execute<{
    appointment_id: string;
    session_number: number | null;
    planned: number | null;
    episode_status: EpisodeStatus | null;
  }>(sql`select * from internal.session_progress(${`{${appointmentIds.join(',')}}`}::uuid[])`);
  return new Map(
    rows.map((row) => [
      row.appointment_id,
      { number: row.session_number, planned: row.planned, episodeStatus: row.episode_status },
    ]),
  );
}

/** A session and its note, as the session screen reads it (SES-03). */
export interface SessionNoteEntry {
  id: string;
  appointmentId: string;
  episodeId: string;
  physioId: string;
  number: number;
  planOfCareId: string | null;
  /** As `sessionNoteSchema` reads it. */
  note: Record<string, unknown>;
  status: SessionStatus;
  signedAt: Date | null;
  signedByName: string | null;
  packageId: string | null;
  version: number;
}

const noteColumns = {
  id: treatmentSession.id,
  appointmentId: treatmentSession.appointmentId,
  episodeId: treatmentSession.episodeId,
  physioId: treatmentSession.physioId,
  number: treatmentSession.number,
  planOfCareId: treatmentSession.planOfCareId,
  note: treatmentSession.note,
  status: treatmentSession.status,
  signedAt: treatmentSession.signedAt,
  signedByName: staffUser.name,
  packageId: treatmentSession.packageId,
  version: treatmentSession.version,
};

/**
 * Opens the session of a started visit, once (SES-03): its number, episode and plan come from the
 * appointment (`internal.session_open`); the caller gives the knowledge base version and the
 * prefilled note. Returns the session's id, the existing one when already open.
 */
export async function openSession(
  tx: DbOrTransaction,
  open: { appointmentId: string; physioId: string; kbVersionId: string; note: object },
): Promise<string> {
  const [created] = await tx
    .insert(treatmentSession)
    .values({
      appointmentId: open.appointmentId,
      physioId: open.physioId,
      kbVersionId: open.kbVersionId,
      note: open.note as Record<string, unknown>,
      // Filled from the appointment by the database.
      episodeId: sql`null`,
      patientId: sql`null`,
      centreId: sql`null`,
      number: 1,
    })
    .onConflictDoNothing({ target: treatmentSession.appointmentId })
    .returning({ id: treatmentSession.id });
  if (created) return created.id;
  const [existing] = await tx
    .select({ id: treatmentSession.id })
    .from(treatmentSession)
    .where(eq(treatmentSession.appointmentId, open.appointmentId));
  if (!existing) throw new Error('The session was not recorded.');
  return existing.id;
}

/** The session of an appointment, or undefined when none is open (or readable). */
export async function sessionNoteOf(
  db: DbOrTransaction,
  appointmentId: string,
): Promise<SessionNoteEntry | undefined> {
  const [row] = await db
    .select(noteColumns)
    .from(treatmentSession)
    .leftJoin(staffUser, eq(staffUser.id, treatmentSession.signedBy))
    .where(eq(treatmentSession.appointmentId, appointmentId));
  return row;
}

/** The episode's newest signed note, for the next note's treatment (SES-03). */
export async function lastSignedSessionNote(
  db: DbOrTransaction,
  episodeId: string,
): Promise<Record<string, unknown> | undefined> {
  const [row] = await db
    .select({ note: treatmentSession.note })
    .from(treatmentSession)
    .where(and(eq(treatmentSession.episodeId, episodeId), eq(treatmentSession.status, 'signed')))
    .orderBy(desc(treatmentSession.signedAt))
    .limit(1);
  return row?.note;
}

/** A plan's interventions, modalities (with names) and home programme, for the note. */
export async function planForSession(
  db: DbOrTransaction,
  planOfCareId: string,
): Promise<
  | {
      interventions: InterventionKind[];
      modalities: { key: string; name: string }[];
      homeProgramme: { exercise: string; dose: string; note: string }[];
    }
  | undefined
> {
  const [plan] = await db
    .select({
      interventions: planOfCare.interventions,
      homeProgramme: planOfCare.homeProgramme,
      kbVersionId: consultation.kbVersionId,
    })
    .from(planOfCare)
    .innerJoin(consultation, eq(consultation.id, planOfCare.consultationId))
    .where(eq(planOfCare.id, planOfCareId));
  if (!plan) return undefined;
  const modalities = await db
    .select({ key: planModality.modalityKey, name: kbModality.name })
    .from(planModality)
    .leftJoin(
      kbModality,
      and(
        eq(kbModality.key, planModality.modalityKey),
        eq(kbModality.kbVersionId, plan.kbVersionId),
      ),
    )
    .where(eq(planModality.planOfCareId, planOfCareId))
    .orderBy(planModality.modalityKey);
  return {
    interventions: plan.interventions,
    modalities: modalities.map((row) => ({ key: row.key, name: row.name ?? row.key })),
    homeProgramme: plan.homeProgramme,
  };
}

/** Saves a draft note at the version the physio saw (FND-08). */
export function saveSessionNote(
  tx: DbOrTransaction,
  sessionId: string,
  baseVersion: number,
  note: object,
): Promise<VersionedResult<typeof treatmentSession.$inferSelect>> {
  return updateVersioned(tx, treatmentSession, sessionId, baseVersion, {
    note: note as Record<string, unknown>,
    updatedAt: new Date(),
  });
}

/**
 * Signs the note at the version the physio saw, with its pain readings (SES-03 Close session);
 * the database then uses a package session, completes the visit and raises any new symptoms
 * task. 'stale' when the note changed since.
 */
export async function signSession(
  tx: DbOrTransaction,
  sign: {
    sessionId: string;
    baseVersion: number;
    by: string;
    pain: { rest: number; activity: number; after: number };
  },
): Promise<'signed' | 'stale'> {
  const now = new Date();
  const [row] = await tx
    .update(treatmentSession)
    .set({
      status: 'signed',
      signedBy: sign.by,
      signedAt: sql`now()`,
      painRest: sign.pain.rest,
      painActivity: sign.pain.activity,
      painAfter: sign.pain.after,
      version: sql`${treatmentSession.version} + 1`,
      updatedAt: now,
    })
    .where(
      and(
        eq(treatmentSession.id, sign.sessionId),
        eq(treatmentSession.version, sign.baseVersion),
        eq(treatmentSession.status, 'draft'),
      ),
    )
    .returning({ id: treatmentSession.id });
  return row ? 'signed' : 'stale';
}

/** The id of the episode's newest plan of care, the one a session opened now follows. */
export async function newestPlanOfCareId(
  db: DbOrTransaction,
  episodeId: string,
): Promise<string | undefined> {
  const [row] = await db
    .select({ id: planOfCare.id })
    .from(planOfCare)
    .where(eq(planOfCare.episodeId, episodeId))
    .orderBy(desc(planOfCare.version))
    .limit(1);
  return row?.id;
}
