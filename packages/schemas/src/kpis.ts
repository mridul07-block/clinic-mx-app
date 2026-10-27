import { addDays } from './ist';
import { formatRupees } from './money';
import type { SettingKey } from './settings';

/**
 * The figures the dashboards show (DSH-01, PRD section 9, Frontend Specification section 8). Each
 * measured figure is computed live from the records by `internal.kpi_daily`, one row per centre,
 * IST day and figure: a numerator, and for a share its denominator (user decisions, 28 October
 * 2026). The figures PRD section 9 lists whose data no ticket has built yet stay in the catalogue
 * as "Not measured yet", naming the ticket that brings the data. Targets are settings (rule 6);
 * how a target is compared ("over", "under", "100%") is the PRD's wording.
 */

/** The figures `internal.kpi_daily` returns, in its `metric` column. */
export const measuredKpiKeys = [
  'red_flag_documentation',
  'consultation_conversion',
  'plan_acceptance',
  'treatment_completion',
  'notes_signed_same_day',
  'no_show_rate',
  'health_form_before_consultation',
  'consultations',
  'active_patients',
  'revenue',
] as const;

export type MeasuredKpiKey = (typeof measuredKpiKeys)[number];

/** A share in per cent, a number of things, money in paise, a score or minutes. */
export type KpiUnit = 'percent' | 'count' | 'paise' | 'score' | 'nps' | 'minutes';

/**
 * Who may read a figure: clinical and operational figures go to the Super Admin and Centre
 * Managers (their centres); money goes to the Super Admin and Finance (PRD section 4).
 */
export type KpiAudience = 'clinical' | 'finance';

/** "Over 75%" is above, "100%" is at least, "Under 15%" is below. */
export type KpiComparison = 'above' | 'at_least' | 'below';

export interface KpiDefinition {
  key: string;
  label: string;
  unit: KpiUnit;
  audience: KpiAudience;
  /** A share or count over a period adds its days; a count at the end of a day takes the last. */
  over: 'sum' | 'last';
  target: { setting: SettingKey; comparison: KpiComparison } | null;
  /** Shown instead of a target when there is none yet. */
  targetNote?: string;
  /** Measured now, or the ticket(s) that will bring its data. */
  measured: true | { needs: string };
  /** What is counted, in plain words, for the table view. */
  definition: string;
  /** Listed in PRD section 9. */
  prd: boolean;
}

const target = (setting: SettingKey, comparison: KpiComparison) => ({ setting, comparison });

export const kpiCatalogue: readonly KpiDefinition[] = [
  {
    key: 'red_flag_documentation',
    label: 'Red flag documentation',
    unit: 'percent',
    audience: 'clinical',
    over: 'sum',
    target: target('kpi.target_red_flag_documentation_percent', 'at_least'),
    measured: true,
    definition:
      'Of the first consultations of each episode the patient came to, the share signed: signing needs the red flag screening complete. On the day of the visit.',
    prd: true,
  },
  {
    key: 'consultation_conversion',
    label: 'Consultation to treatment conversion',
    unit: 'percent',
    audience: 'clinical',
    over: 'sum',
    target: target('kpi.target_conversion_percent', 'above'),
    measured: true,
    definition:
      'Of the episodes whose signed consultation proposed a plan, the share that became Active (paid). On the day the plan was proposed; red flag referrals and opening entries are left out.',
    prd: true,
  },
  {
    key: 'plan_acceptance',
    label: 'Plan acceptance',
    unit: 'percent',
    audience: 'clinical',
    over: 'sum',
    target: null,
    measured: true,
    definition:
      'Of the same episodes, the share whose latest choice is Package or Pay per session. On the day the plan was proposed.',
    prd: false,
  },
  {
    key: 'treatment_completion',
    label: 'Treatment completion',
    unit: 'percent',
    audience: 'clinical',
    over: 'sum',
    target: target('kpi.target_completion_percent', 'above'),
    measured: true,
    definition:
      'Of the episodes discharged after treatment began, the share discharged with Goals achieved or Independent management. On the day of discharge.',
    prd: true,
  },
  {
    key: 'meaningful_change',
    label: 'Meaningful change by 6 week review',
    unit: 'percent',
    audience: 'clinical',
    over: 'sum',
    target: target('kpi.target_meaningful_change_percent', 'above'),
    measured: { needs: 'OUT-02 and SET-08 (questionnaires and their meaningful change)' },
    definition: 'Of the patients at their 6 week review, the share with a meaningful change.',
    prd: true,
  },
  {
    key: 'return_to_sport',
    label: 'Return to sport by 12 months',
    unit: 'percent',
    audience: 'clinical',
    over: 'sum',
    target: target('kpi.target_return_to_sport_percent', 'above'),
    measured: { needs: 'PAT-10 (12 month follow up), and a decision on recording the level' },
    definition: 'Of the athletes, the share back at or above their pre injury level by 12 months.',
    prd: true,
  },
  {
    key: 'reinjury',
    label: 'Reinjury within 12 months',
    unit: 'percent',
    audience: 'clinical',
    over: 'sum',
    target: target('kpi.target_reinjury_percent', 'below'),
    measured: { needs: 'PAT-10 and SCH-14 (follow ups and recurrences)' },
    definition: 'Of the patients discharged, the share injured again within 12 months.',
    prd: true,
  },
  {
    key: 'patient_satisfaction',
    label: 'Patient satisfaction',
    unit: 'score',
    audience: 'clinical',
    over: 'sum',
    target: target('kpi.target_satisfaction_score', 'above'),
    measured: { needs: 'PAT-04 (feedback after the consultation)' },
    definition: 'The average satisfaction score, out of 5.',
    prd: true,
  },
  {
    key: 'nps',
    label: 'Net Promoter Score',
    unit: 'nps',
    audience: 'clinical',
    over: 'sum',
    target: target('kpi.target_nps', 'above'),
    measured: { needs: 'PAT-07 (feedback at discharge, 0 to 10)' },
    definition: 'Promoters less detractors, as a share of the answers to the 0 to 10 question.',
    prd: true,
  },
  {
    key: 'ai_top3',
    label: 'Right diagnosis in AI top 3',
    unit: 'percent',
    audience: 'clinical',
    over: 'sum',
    target: null,
    targetNote: 'Set after the first 3 months',
    measured: { needs: 'AI-03 (AI suggestions kept or dismissed)' },
    definition: 'Of the signed diagnoses, the share among the AI’s top 3 suggestions, by month.',
    prd: true,
  },
  {
    key: 'notes_signed_same_day',
    label: 'Notes signed same day',
    unit: 'percent',
    audience: 'clinical',
    over: 'sum',
    target: target('kpi.target_notes_same_day_percent', 'above'),
    measured: true,
    definition:
      'Of the consultation and session notes started, the share signed on the day of the visit (IST). A day counts once it has ended.',
    prd: true,
  },
  {
    key: 'no_show_rate',
    label: 'No show rate',
    unit: 'percent',
    audience: 'clinical',
    over: 'sum',
    target: null,
    targetNote: 'Tracked monthly; falls after reminders go live',
    measured: true,
    definition:
      'Of the visits that came or were marked a no show, the share marked a no show. Past visits nobody marked are left out.',
    prd: true,
  },
  {
    key: 'booking_flow_completion',
    label: 'Booking Flow completion',
    unit: 'percent',
    audience: 'clinical',
    over: 'sum',
    target: target('kpi.target_booking_flow_percent', 'above'),
    measured: { needs: 'WA-04 (the WhatsApp Booking Flow)' },
    definition: 'Of the WhatsApp Booking Flows started, the share completed.',
    prd: true,
  },
  {
    key: 'health_form_before_consultation',
    label: 'Health form completion before consultation',
    unit: 'percent',
    audience: 'clinical',
    over: 'sum',
    target: target('kpi.target_health_form_percent', 'above'),
    measured: true,
    definition:
      'Of the consultations the patient came to, the share whose health form was submitted (alone or helped) by the booked start time.',
    prd: true,
  },
  {
    key: 'session_note_time',
    label: 'Session note time',
    unit: 'minutes',
    audience: 'clinical',
    over: 'sum',
    target: target('kpi.target_session_note_minutes', 'below'),
    measured: {
      needs: 'A decision on recording how long a note takes to write (DECISION register, DSH-01)',
    },
    definition: 'The median minutes to write a session note.',
    prd: true,
  },
  {
    key: 'consultations',
    label: 'Consultations',
    unit: 'count',
    audience: 'clinical',
    over: 'sum',
    target: null,
    measured: true,
    definition: 'Consultations held and signed, on the day of the visit.',
    prd: false,
  },
  {
    key: 'active_patients',
    label: 'Active patients',
    unit: 'count',
    audience: 'clinical',
    over: 'last',
    target: null,
    measured: true,
    definition:
      'Patients with an Active or Under review episode at the end of the day (now, for today); a patient treated at two centres counts at each, and once in all.',
    prd: false,
  },
  {
    key: 'revenue',
    label: 'Revenue',
    unit: 'paise',
    audience: 'finance',
    over: 'sum',
    target: null,
    measured: true,
    definition: 'Payments received and not undone, on the day they were recorded.',
    prd: false,
  },
];

/** A figure's numerator and denominator over some days; the denominator is null for a count. */
export interface KpiTally {
  numerator: number;
  denominator: number | null;
}

/**
 * One row of `internal.kpi_daily`. Active patients also has a row with no centre: the patients
 * across all the reader's centres, each once.
 */
export interface KpiDailyRow extends KpiTally {
  centreId: string | null;
  day: string;
  metric: MeasuredKpiKey;
}

/** The value a tally shows, or null when there is nothing to divide. */
export function kpiValue(tally: KpiTally, unit: KpiUnit): number | null {
  if (unit !== 'percent') return tally.numerator;
  if (!tally.denominator) return null;
  return (tally.numerator / tally.denominator) * 100;
}

const LAKH_PAISE = 100_000 * 100;

/**
 * A value as the table shows it: a whole per cent, rupees (in lakhs from 1 lakh, as dashboards show
 * money), a plain count. A per cent rounded across its target shows one decimal instead, rounded
 * the way that keeps it on its own side ("99.9%" under a 100% target, never "100%").
 */
export function kpiText(
  value: number | null,
  unit: KpiUnit,
  goal: { value: number; comparison: KpiComparison } | null = null,
): string {
  if (value === null) return 'No data yet';
  if (unit === 'percent') {
    const whole = Math.round(value);
    const status = kpiStatus(value, goal);
    if (status === kpiStatus(whole, goal)) return `${String(whole)}%`;
    const better = goal?.comparison === 'below' ? Math.floor : Math.ceil;
    const worse = goal?.comparison === 'below' ? Math.ceil : Math.floor;
    const tenths = (status === 'on_target' ? better : worse)(value * 10) / 10;
    return `${tenths.toFixed(1)}%`;
  }
  if (unit === 'paise') {
    if (Math.abs(value) < LAKH_PAISE) return formatRupees(value);
    return `₹${(value / LAKH_PAISE).toFixed(1)} L`;
  }
  return String(value);
}

export const kpiStatusLabels = {
  on_target: 'On target',
  off_target: 'Off target',
  no_data: 'No data yet',
} as const;

export type KpiStatus = keyof typeof kpiStatusLabels;

/** Whether a value meets its target; null when the figure has no target. */
export function kpiStatus(
  value: number | null,
  goal: { value: number; comparison: KpiComparison } | null,
): KpiStatus | null {
  if (!goal) return null;
  if (value === null) return 'no_data';
  const met =
    goal.comparison === 'above'
      ? value > goal.value
      : goal.comparison === 'at_least'
        ? value >= goal.value
        : value < goal.value;
  return met ? 'on_target' : 'off_target';
}

/** How a target reads: "Over 75%", "100%", "Under 3 minutes". */
export function kpiTargetText(goal: number, comparison: KpiComparison, unit: KpiUnit): string {
  const amount =
    unit === 'percent'
      ? `${String(goal)}%`
      : unit === 'minutes'
        ? `${String(goal)} minutes`
        : unit === 'score'
          ? `${String(goal)} out of 5`
          : String(goal);
  if (comparison === 'at_least') return amount;
  return `${comparison === 'above' ? 'Over' : 'Under'} ${amount}`;
}

export const kpiPeriods = ['today', 'week', 'month'] as const;

export type KpiPeriod = (typeof kpiPeriods)[number];

export const kpiPeriodLabels: Record<KpiPeriod, string> = {
  today: 'Today',
  week: 'Last 7 days',
  month: 'Last 30 days',
};

/** The first and last IST day of a period ending today. */
export function kpiPeriodDays(period: KpiPeriod, today: string): { from: string; to: string } {
  const length = period === 'today' ? 1 : period === 'week' ? 7 : 30;
  return { from: addDays(today, 1 - length), to: today };
}

/**
 * A figure over the days from `from` to `to`, at one centre or all of those in `rows`: summed, or
 * for a count at the end of a day, the last day's (across all centres, the row with no centre, so
 * a patient at two centres counts once).
 */
export function kpiTally(
  rows: readonly KpiDailyRow[],
  definition: Pick<KpiDefinition, 'key' | 'over'>,
  from: string,
  to: string,
  centreId?: string,
): KpiTally {
  const picked = rows.filter(
    (row) =>
      row.metric === definition.key &&
      row.day >= from &&
      row.day <= to &&
      (centreId !== undefined
        ? row.centreId === centreId
        : definition.over === 'last'
          ? row.centreId === null
          : row.centreId !== null),
  );
  const days = definition.over === 'last' ? picked.filter((row) => row.day === to) : picked;
  let numerator = 0;
  let denominator: number | null = null;
  for (const row of days) {
    numerator += row.numerator;
    if (row.denominator !== null) denominator = (denominator ?? 0) + row.denominator;
  }
  return { numerator, denominator };
}
