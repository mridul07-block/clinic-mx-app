import { sql } from 'drizzle-orm';
import type { DbOrTransaction } from './versioned';

/**
 * My plan (PAT-01): what the page shows for the link it runs under, read inside
 * `withPatientAccess` through `internal.my_plan()`, which reaches only that link's episode; null
 * when the link is not a working My plan link. Parsed by `myPlanSchema`.
 */
export async function myPlanView(db: DbOrTransaction): Promise<unknown> {
  const [row] = await db.execute<{ plan: unknown }>(sql`select internal.my_plan() as plan`);
  return row?.plan ?? null;
}
