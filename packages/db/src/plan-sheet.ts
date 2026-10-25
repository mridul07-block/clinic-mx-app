import { sql } from 'drizzle-orm';
import type { DbOrTransaction } from './versioned';

/**
 * What the plan and payment sheet reads of an episode's newest plan of care (BIL-01): only what
 * pricing needs, through `internal.plan_for_pricing`, for those who see bill amounts. Nothing
 * clinical: no diagnosis, goals or findings.
 */
export interface PlanForPricing {
  planOfCareId: string;
  sessionsPerWeek: number | null;
  weeks: number | null;
  reviewDate: string;
  treatingPhysio: string | null;
  modalities: { key: string; name: string }[];
}

/** The episode's plan for pricing; undefined when there is none, or none the reader prices. */
export async function planForPricing(
  db: DbOrTransaction,
  episodeId: string,
): Promise<PlanForPricing | undefined> {
  const [row] = await db.execute<{
    plan_of_care_id: string;
    sessions_per_week: number | null;
    weeks: number | null;
    review_date: string;
    treating_physio: string | null;
    modalities: { key: string; name: string }[];
  }>(sql`select * from internal.plan_for_pricing(${episodeId}::uuid)`);
  if (!row) return undefined;
  return {
    planOfCareId: row.plan_of_care_id,
    sessionsPerWeek: row.sessions_per_week,
    weeks: row.weeks,
    reviewDate: row.review_date,
    treatingPhysio: row.treating_physio,
    modalities: row.modalities,
  };
}
