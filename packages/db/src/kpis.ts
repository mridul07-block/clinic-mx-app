import { measuredKpiKeys, type KpiDailyRow, type MeasuredKpiKey } from '@clinic-mx/schemas';
import { sql } from 'drizzle-orm';
import type { DbOrTransaction } from './versioned';

/**
 * Whose figures: the centres the signed in person sees (DSH-01, DSH-03), or a treating clinician's
 * own episodes, those whose newest plan names them (DSH-06: `internal.own_kpi_daily`,
 * `own_funnel`, `own_diagnosis_outcomes`, completion and conversion only).
 */
export type FigureScope = 'centres' | 'own';

/**
 * The figures behind the dashboards (DSH-01, docs/runbooks/kpis.md): `internal.kpi_daily` counts
 * them live from the records, by centre and IST day (active patients also across all centres,
 * with no centre), for the figures and centres the signed in person may see. Run it under their access (`withStaffAccess`); anyone else is refused (42501).
 */
export async function kpiDaily(
  db: DbOrTransaction,
  from: string,
  to: string,
  scope: FigureScope = 'centres',
): Promise<KpiDailyRow[]> {
  const rows = await db.execute<{
    centre_id: string | null;
    day: string;
    metric: string;
    numerator: string | number;
    denominator: string | number | null;
  }>(sql`select centre_id, day::text as day, metric, numerator, denominator
    from ${sql.raw(scope === 'own' ? 'internal.own_kpi_daily' : 'internal.kpi_daily')}(${from}::date, ${to}::date)`);
  return rows.map((row) => ({
    centreId: row.centre_id,
    day: row.day,
    metric: measuredKey(row.metric),
    numerator: Number(row.numerator),
    denominator: row.denominator === null ? null : Number(row.denominator),
  }));
}

function measuredKey(metric: string): MeasuredKpiKey {
  const key = measuredKpiKeys.find((known) => known === metric);
  if (!key) throw new Error(`internal.kpi_daily returned an unknown figure: ${metric}`);
  return key;
}
