import 'server-only';
import { centreList, kpiDaily, type StaffMember } from '@clinic-mx/db';
import {
  can,
  formatIstDateTime,
  istDate,
  kpiCatalogue,
  kpiPeriodDays,
  kpiPeriods,
  kpiStatus,
  kpiTally,
  kpiTargetText,
  kpiText,
  kpiValue,
  type KpiPeriod,
  type KpiStatus,
  type SettingKey,
} from '@clinic-mx/schemas';
import { NotAllowedError } from '../access/guard';
import { asStaff } from '../access/staff-db';
import { getSetting } from '../settings/settings';

/**
 * The figures (DSH-01, PRD section 9; docs/runbooks/kpis.md): every figure in the catalogue for
 * today, the last 7 days and the last 30 days, overall and by centre, counted live from the
 * records by `internal.kpi_daily` under the reader's own access. The figures not measured yet
 * name what brings their data. The Super Admin's plain table; the dashboards (DSH-03 to DSH-05)
 * draw the same figures as charts.
 */

export interface FigureValue {
  text: string;
  status: KpiStatus | null;
}

export interface Figure {
  key: string;
  label: string;
  definition: string;
  /** "Over 75%", the PRD's note when it sets none, or null. */
  target: string | null;
  /** The tickets or decision that bring its data; null when measured. */
  needs: string | null;
  periods: Record<KpiPeriod, FigureValue>;
  centres: { id: string; name: string; periods: Record<KpiPeriod, string> }[];
}

export interface FiguresView {
  /** When the figures were counted, IST. */
  countedAt: string;
  figures: Figure[];
}

export async function figuresView(actor: StaffMember, now = new Date()): Promise<FiguresView> {
  if (!can(actor, 'dashboard.overview')) throw new NotAllowedError();
  const today = istDate(now);
  const days = Object.fromEntries(
    kpiPeriods.map((period) => [period, kpiPeriodDays(period, today)]),
  ) as Record<KpiPeriod, { from: string; to: string }>;
  const { rows, centres } = await asStaff(actor, async (tx) => ({
    rows: await kpiDaily(tx, days.month.from, today),
    centres: (await centreList(tx)).filter((entry) => entry.active),
  }));

  const figures: Figure[] = [];
  for (const definition of kpiCatalogue) {
    const goal = definition.target
      ? {
          value: await targetValue(definition.target.setting),
          comparison: definition.target.comparison,
        }
      : null;
    const value = (period: KpiPeriod, centreId?: string) =>
      kpiValue(
        kpiTally(rows, definition, days[period].from, days[period].to, centreId),
        definition.unit,
      );
    const measured = definition.measured === true;
    figures.push({
      key: definition.key,
      label: definition.label,
      definition: definition.definition,
      target: goal
        ? kpiTargetText(goal.value, goal.comparison, definition.unit)
        : (definition.targetNote ?? null),
      needs: definition.measured === true ? null : definition.measured.needs,
      periods: periodsOf((period) => {
        if (!measured) return { text: 'Not measured yet', status: null };
        const shown = value(period);
        return { text: kpiText(shown, definition.unit, goal), status: kpiStatus(shown, goal) };
      }),
      centres: measured
        ? centres.map((entry) => ({
            id: entry.id,
            name: entry.name,
            periods: periodsOf((period) => kpiText(value(period, entry.id), definition.unit, goal)),
          }))
        : [],
    });
  }
  return { countedAt: formatIstDateTime(now), figures };
}

/** A target setting's number (rule 6). */
async function targetValue(key: SettingKey): Promise<number> {
  const value = await getSetting(key);
  if (typeof value !== 'number') throw new Error(`The setting ${key} is not a number.`);
  return value;
}

function periodsOf<T>(make: (period: KpiPeriod) => T): Record<KpiPeriod, T> {
  return Object.fromEntries(kpiPeriods.map((period) => [period, make(period)])) as Record<
    KpiPeriod,
    T
  >;
}
