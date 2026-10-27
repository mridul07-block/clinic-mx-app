import { measuredKpiKeys, type KpiDailyRow, type MeasuredKpiKey } from '@clinic-mx/schemas';
import { sql } from 'drizzle-orm';
import type { DbOrTransaction } from './versioned';

/**
 * The figures behind the dashboards (DSH-01, docs/runbooks/kpis.md): `internal.kpi_daily` counts
 * them live from the records, by centre and IST day (active patients also across all centres,
 * with no centre), for the figures and centres the signed in person may see. Run it under their access (`withStaffAccess`); anyone else is refused (42501).
 */
export async function kpiDaily(
  db: DbOrTransaction,
  from: string,
  to: string,
): Promise<KpiDailyRow[]> {
  const rows = await db.execute<{
    centre_id: string | null;
    day: string;
    metric: string;
    numerator: string | number;
    denominator: string | number | null;
  }>(sql`select centre_id, day::text as day, metric, numerator, denominator
    from internal.kpi_daily(${from}::date, ${to}::date)`);
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
