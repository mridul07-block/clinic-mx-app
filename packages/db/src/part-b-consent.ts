import { and, desc, eq, gt, isNull, sql } from 'drizzle-orm';
import { patientLink } from './schema';
import type { DbOrTransaction } from './versioned';

/**
 * Part B consent (BIL-03; docs/runbooks/consent.md): what an episode's Part B asks about and where
 * it stands, read through the database's own functions (`internal.part_b_core`) for the patient's
 * consent link or for staff who see the episode's centre. Decisions are added with
 * `insertConsentRecords`.
 */

export interface PartBContext {
  episodeId: string;
  /** A signed consultation has a plan of care. */
  planned: boolean;
  /** The plan's modalities, by name. */
  modalities: { key: string; name: string }[];
  /** The patient's latest choice is a package. */
  package: boolean;
  /** The signed diagnosis's name: for the patient's own link only. */
  diagnosis: string | null;
  /** The latest Part B decision on each statement asked so far: key to accepted. */
  latest: Record<string, boolean>;
}

interface Row extends Record<string, unknown> {
  part_b: {
    episode_id: string;
    planned: boolean;
    modalities: { key: string; name: string }[];
    package: boolean;
    diagnosis: string | null;
    latest: Record<string, boolean>;
  } | null;
}

function context(row: Row | undefined): PartBContext | undefined {
  const found = row?.part_b;
  if (!found) return undefined;
  return {
    episodeId: found.episode_id,
    planned: found.planned,
    modalities: found.modalities,
    package: found.package,
    diagnosis: found.diagnosis,
    latest: found.latest,
  };
}

/** The Part B of the patient's own consent link, inside `withPatientAccess`. */
export async function partBForLink(db: DbOrTransaction): Promise<PartBContext | undefined> {
  const [row] = await db.execute<Row>(sql`select internal.part_b_for_link() as part_b`);
  return context(row);
}

/** An episode's Part B, for staff who see its centre; undefined otherwise. */
export async function partBForEpisode(
  db: DbOrTransaction,
  episodeId: string,
): Promise<PartBContext | undefined> {
  const [row] = await db.execute<Row>(
    sql`select internal.part_b_for_episode(${episodeId}::uuid) as part_b`,
  );
  return context(row);
}

/** The episode's consent link still open (not used, revoked or expired), newest first. */
export async function liveConsentLink(
  db: DbOrTransaction,
  episodeId: string,
): Promise<{ id: string; expiresAt: Date } | undefined> {
  const [row] = await db
    .select({ id: patientLink.id, expiresAt: patientLink.expiresAt })
    .from(patientLink)
    .where(
      and(
        eq(patientLink.episodeId, episodeId),
        eq(patientLink.purpose, 'consent'),
        isNull(patientLink.revokedAt),
        isNull(patientLink.completedAt),
        gt(patientLink.expiresAt, sql`now()`),
      ),
    )
    .orderBy(desc(patientLink.createdAt))
    .limit(1);
  return row;
}
