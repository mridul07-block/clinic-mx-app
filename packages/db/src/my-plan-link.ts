import { and, desc, eq, gt, isNull, sql } from 'drizzle-orm';
import { patientLink } from './schema';
import type { DbOrTransaction } from './versioned';

/**
 * The episode's working My plan link (PAT-01): not revoked and not expired, the newest; read by
 * those who check patients in, at the episode's centre. Undefined when there is none.
 */
export async function liveMyPlanLink(
  db: DbOrTransaction,
  episodeId: string,
): Promise<{ id: string; expiresAt: Date } | undefined> {
  const [row] = await db
    .select({ id: patientLink.id, expiresAt: patientLink.expiresAt })
    .from(patientLink)
    .where(
      and(
        eq(patientLink.episodeId, episodeId),
        eq(patientLink.purpose, 'my_plan'),
        isNull(patientLink.revokedAt),
        gt(patientLink.expiresAt, sql`now()`),
      ),
    )
    .orderBy(desc(patientLink.createdAt))
    .limit(1);
  return row;
}

/**
 * Whether the episode has a plan of care (a My plan link has something to show), through
 * `internal.episode_has_plan`: the desk reads no plan of care itself, only this yes or no for
 * episodes at its centres. False for anyone who does not check patients in.
 */
export async function episodeHasPlan(db: DbOrTransaction, episodeId: string): Promise<boolean> {
  const [row] = await db.execute<{ has: boolean }>(
    sql`select internal.episode_has_plan(${episodeId}::uuid) as has`,
  );
  return row?.has === true;
}
