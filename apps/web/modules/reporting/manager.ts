import 'server-only';
import {
  appointmentsPerDay,
  arrivalsToday,
  bookingChannels,
  busyHours,
  centreList,
  kpiDaily,
  kpiDiagnosisOutcomes,
  kpiFunnel,
  managerAlertCounts,
  paymentPendingCounts,
  staffNames,
  teamDaily,
  utilisationOn,
  type StaffMember,
  type FigureScope,
} from '@clinic-mx/db';
import {
  addDays,
  alertItemLabels,
  alertItemLinks,
  alertItemWhere,
  alertItems,
  alertsComing,
  can,
  centreColourIndex,
  channelPartLabels,
  channelParts,
  formatIstDateTime,
  funnelStageLabels,
  funnelStages,
  istDate,
  kpiCatalogue,
  kpiStatus,
  kpiTally,
  kpiTargetText,
  kpiValue,
  median,
  seesAllCentres,
  waitMinutes,
  windowDays,
  type AlertItem,
  type FunnelStage,
  type KpiDailyRow,
  type KpiStatus,
  type OutcomeWindow,
  type SettingKey,
} from '@clinic-mx/schemas';
import { NotAllowedError } from '../access/guard';
import { asStaff } from '../access/staff-db';
import { getSetting } from '../settings/settings';

/**
 * The Centre Manager's dashboards (DSH-03, Frontend Specification sections 6 and 8;
 * docs/runbooks/manager-dashboards.md): one view per tab, for the Super Admin and Centre Managers
 * (`dashboard.clinical_operations`), counted under the reader's own access so a manager only ever
 * sees their centres, and never an amount of money.
 */

function assertReads(actor: StaffMember): void {
  if (!can(actor, 'dashboard.clinical_operations')) throw new NotAllowedError();
}

export interface DashboardCentre {
  id: string;
  name: string;
  /** Its colour's place among the reserved centre colours, 0 to 2, for the charts; -1 for none. */
  tone: number;
}

/** The active centres the reader sees, by name. */
async function centresOf(
  actor: StaffMember,
  tx: Parameters<Parameters<typeof asStaff>[1]>[0],
): Promise<DashboardCentre[]> {
  const all = seesAllCentres(actor.role);
  return (await centreList(tx))
    .filter((entry) => entry.active && (all || actor.centreIds.includes(entry.id)))
    .map((entry) => ({ id: entry.id, name: entry.name, tone: centreColourIndex(entry.colour) }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

async function settingNumber(key: SettingKey): Promise<number> {
  const value = await getSetting(key);
  if (typeof value !== 'number') throw new Error(`The setting ${key} is not a number.`);
  return value;
}

// Alerts ---------------------------------------------------------------------------------------

export interface AlertsDashboard {
  centres: DashboardCentre[];
  items: {
    item: AlertItem;
    label: string;
    link: string | null;
    where: string | null;
    total: number;
    byCentre: { name: string; n: number }[];
  }[];
  coming: readonly { label: string; needs: string }[];
}

export async function alertsDashboard(actor: StaffMember): Promise<AlertsDashboard> {
  assertReads(actor);
  return asStaff(actor, async (tx) => {
    const centres = await centresOf(actor, tx);
    const counts = await managerAlertCounts(tx);
    return {
      centres,
      items: alertItems.map((item) => {
        const byCentre = centres.map((entry) => ({
          name: entry.name,
          n: counts
            .filter((row) => row.item === item && row.centreId === entry.id)
            .reduce((sum, row) => sum + row.n, 0),
        }));
        return {
          item,
          label: alertItemLabels[item],
          link: alertItemLinks[item],
          where: alertItemWhere[item] ?? null,
          total: byCentre.reduce((sum, row) => sum + row.n, 0),
          byCentre,
        };
      }),
      coming: alertsComing,
    };
  });
}

// Centres --------------------------------------------------------------------------------------

export interface CentreToday {
  id: string;
  name: string;
  /** Booked minutes of the rostered minutes, as a whole per cent; null with no hours today. */
  utilisation: number | null;
  booked: number;
  rostered: number;
  noShows: number;
  waiting: {
    median: number | null;
    longest: number | null;
    now: number;
    longestNow: number | null;
  };
  paymentPending: { sinceToday: number; earlier: number };
}

export interface KpiCell {
  key: string;
  label: string;
  value: string;
  change: string;
  status: KpiStatus | null;
}

export interface CentresDashboard {
  countedAt: string;
  centres: CentreToday[];
  cells: KpiCell[];
  perCentre: { categories: string[]; series: { name: string; tone: number; values: number[] }[] };
  channels: {
    parts: { key: string; label: string; value: number }[];
    automatic: number;
    days: number;
  };
  busy: { days: number; columns: string[]; rows: { label: string; values: (number | null)[] }[] };
  runningLateMinutes: number;
}

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

const dayLabel = (date: string) =>
  new Intl.DateTimeFormat('en-IN', { weekday: 'short', timeZone: 'UTC' }).format(
    new Date(`${date}T00:00:00Z`),
  );

/** The KPI cells: the last 7 days against the 7 before. */
function kpiCells(rows: readonly KpiDailyRow[], today: string): KpiCell[] {
  const { current, previous } = windowDays(7, today);
  const keys = ['consultations', 'plan_acceptance', 'no_show_rate', 'active_patients'];
  return keys.flatMap((key) => {
    const definition = kpiCatalogue.find((figure) => figure.key === key);
    if (!definition) return [];
    const now = kpiTally(rows, definition, current.from, current.to);
    const before = kpiTally(rows, definition, previous.from, previous.to);
    // No shows are a count on the card (Frontend Specification section 8), the rate's numerator.
    if (key === 'no_show_rate') {
      return [
        {
          key: 'no_shows',
          label: 'No shows',
          value: String(now.numerator),
          change: changeText(now.numerator, before.numerator, ''),
          status: null,
        },
      ];
    }
    const value = kpiValue(now, definition.unit);
    const was = kpiValue(before, definition.unit);
    const percent = definition.unit === 'percent';
    return [
      {
        key,
        label: definition.label,
        value:
          value === null
            ? 'No data yet'
            : percent
              ? `${String(Math.round(value))}%`
              : String(value),
        change:
          value === null || was === null
            ? 'Nothing to compare yet'
            : changeText(value, was, percent ? '%' : ''),
        status: null,
      },
    ];
  });
}

function changeText(current: number, previous: number, unit: string): string {
  const difference = Math.round(current - previous);
  if (difference === 0) return 'Same as the 7 days before';
  return `${difference > 0 ? '+' : '−'}${String(Math.abs(difference))}${unit} on the 7 days before`;
}

export async function centresDashboard(
  actor: StaffMember,
  now = new Date(),
): Promise<CentresDashboard> {
  assertReads(actor);
  const today = istDate(now);
  const busyDays = await settingNumber('dashboard.busy_hours_days');
  const channelDays = await settingNumber('dashboard.channel_days');
  const runningLateMinutes = await settingNumber('day.running_late_minutes');
  return asStaff(actor, async (tx) => {
    const centres = await centresOf(actor, tx);
    const week = addDays(today, -6);
    const [kpis, pending, arrivals, perDay, channels, busy] = [
      await kpiDaily(tx, addDays(today, -13), today),
      await paymentPendingCounts(tx),
      await arrivalsToday(tx, today),
      await appointmentsPerDay(tx, week, today),
      await bookingChannels(tx, addDays(today, 1 - channelDays)),
      await busyHours(tx, addDays(today, 1 - busyDays), today),
    ];
    const rows: CentreToday[] = [];
    for (const entry of centres) {
      const used = await utilisationOn(tx, entry.id, today);
      const waits = arrivals
        .filter((row) => row.centreId === entry.id && row.arrivedAt)
        .map((row) => ({
          started: row.startedAt !== null,
          minutes: waitMinutes(
            {
              startsAt: row.startsAt,
              arrivedAt: row.arrivedAt ?? row.startsAt,
              startedAt: row.startedAt,
            },
            now,
          ),
        }));
      const done = waits.filter((wait) => wait.started).map((wait) => wait.minutes);
      const still = waits.filter((wait) => !wait.started).map((wait) => wait.minutes);
      const centrePending = pending.find((row) => row.centreId === entry.id);
      rows.push({
        id: entry.id,
        name: entry.name,
        booked: Math.round(used.booked),
        rostered: Math.round(used.rostered),
        utilisation: used.rostered > 0 ? Math.round((used.booked / used.rostered) * 100) : null,
        noShows: kpis
          .filter(
            (row) =>
              row.centreId === entry.id && row.day === today && row.metric === 'no_show_rate',
          )
          .reduce((sum, row) => sum + row.numerator, 0),
        waiting: {
          median: median(done),
          longest: done.length ? Math.max(...done) : null,
          now: still.length,
          longestNow: still.length ? Math.max(...still) : null,
        },
        paymentPending: {
          sinceToday: centrePending?.sinceToday ?? 0,
          earlier: centrePending?.earlier ?? 0,
        },
      });
    }
    const days = Array.from({ length: 7 }, (_, index) => addDays(week, index));
    const hours = busy.map((row) => row.hour);
    const firstHour = hours.length ? Math.min(...hours) : 8;
    const lastHour = hours.length ? Math.max(...hours) : 19;
    const columns = Array.from({ length: lastHour - firstHour + 1 }, (_, index) =>
      String(firstHour + index).padStart(2, '0'),
    );
    return {
      countedAt: formatIstDateTime(now),
      centres: rows,
      cells: kpiCells(kpis, today),
      perCentre: {
        categories: days.map(dayLabel),
        series: centres.map((entry) => ({
          name: entry.name,
          tone: entry.tone,
          values: days.map(
            (day) => perDay.find((row) => row.centreId === entry.id && row.day === day)?.n ?? 0,
          ),
        })),
      },
      channels: {
        parts: channelParts.map((key) => ({
          key,
          label: channelPartLabels[key],
          value: channels.find((row) => row.channel === key)?.n ?? 0,
        })),
        automatic: channels.find((row) => row.channel === 'automatic')?.n ?? 0,
        days: channelDays,
      },
      busy: {
        days: busyDays,
        columns,
        rows: WEEKDAYS.map((label, index) => ({
          label,
          values: columns.map((_, column) => {
            const found = busy.find(
              (row) => row.weekday === index + 1 && row.hour === firstHour + column,
            );
            return found?.n ?? 0;
          }),
        })),
      },
      runningLateMinutes,
    };
  });
}

// Outcomes -------------------------------------------------------------------------------------

export interface OutcomeBullet {
  key: string;
  label: string;
  value: number | null;
  earlier: number | null;
  target: number;
  targetText: string;
  lowerIsBetter: boolean;
  status: KpiStatus | null;
  /** The tickets that bring its data, when not measured yet. */
  needs: string | null;
  counted: string;
}

export interface OutcomesDashboard {
  window: OutcomeWindow;
  bullets: OutcomeBullet[];
  funnel: { stage: FunnelStage; label: string; episodes: number }[];
  inTreatment: number;
  topDiagnoses: { label: string; value: number }[];
  outcomes: { label: string; from: number; to: number; episodes: number }[];
  tooFew: { label: string; episodes: number }[];
  minimumEpisodes: number;
}

export async function outcomesDashboard(
  actor: StaffMember,
  window: OutcomeWindow,
  now = new Date(),
): Promise<OutcomesDashboard> {
  assertReads(actor);
  return outcomesFor(actor, window, now, 'centres');
}

/**
 * The Outcomes tab's figures over the centres the reader sees (DSH-03), or a treating
 * clinician's own episodes (DSH-06): the same definitions, read under the reader's own access.
 * Callers check who may read them first.
 */
export async function outcomesFor(
  actor: StaffMember,
  window: OutcomeWindow,
  now: Date,
  scope: FigureScope,
): Promise<OutcomesDashboard> {
  const today = istDate(now);
  const days = Number(window);
  const { current, previous } = windowDays(days, today);
  const minimumEpisodes = await settingNumber('kpi.min_outcome_episodes');
  const bulletKeys = [
    'treatment_completion',
    'consultation_conversion',
    'meaningful_change',
    'reinjury',
  ];
  const goals = new Map<string, number>();
  for (const key of bulletKeys) {
    const setting = kpiCatalogue.find((figure) => figure.key === key)?.target?.setting;
    if (setting) goals.set(key, await settingNumber(setting));
  }
  return asStaff(actor, async (tx) => {
    // Each window on its own: together a year and the year before would pass the longest period.
    const rows = [
      ...(await kpiDaily(tx, previous.from, previous.to, scope)),
      ...(await kpiDaily(tx, current.from, current.to, scope)),
    ];
    const funnel = await kpiFunnel(tx, current.from, current.to, scope);
    const diagnoses = await kpiDiagnosisOutcomes(tx, current.from, current.to, scope);
    const bullets = bulletKeys.flatMap((key): OutcomeBullet[] => {
      const definition = kpiCatalogue.find((figure) => figure.key === key);
      if (!definition?.target) return [];
      const target = goals.get(key) ?? 0;
      const goal = { value: target, comparison: definition.target.comparison };
      const measured = definition.measured === true;
      const tally = kpiTally(rows, definition, current.from, current.to);
      const value = measured ? kpiValue(tally, 'percent') : null;
      return [
        {
          key,
          label: definition.label,
          value,
          earlier: measured
            ? kpiValue(kpiTally(rows, definition, previous.from, previous.to), 'percent')
            : null,
          target,
          targetText: kpiTargetText(target, definition.target.comparison, definition.unit),
          lowerIsBetter: definition.target.comparison === 'below',
          status: measured ? kpiStatus(value, goal) : null,
          needs: definition.measured === true ? null : definition.measured.needs,
          counted: measured
            ? `${String(tally.numerator)} of ${String(tally.denominator ?? 0)}`
            : 'Not measured yet',
        },
      ];
    });
    const stageTotal = (stage: string) =>
      funnel.filter((row) => row.stage === stage).reduce((sum, row) => sum + row.episodes, 0);
    const byCondition = new Map<
      string,
      { label: string; diagnosed: number; paired: number; from: number; to: number }
    >();
    for (const row of diagnoses) {
      const entry = byCondition.get(row.conditionId) ?? {
        label: row.conditionName,
        diagnosed: 0,
        paired: 0,
        from: 0,
        to: 0,
      };
      entry.diagnosed += row.diagnosed;
      if (row.paired > 0 && row.baselinePain !== null && row.dischargePain !== null) {
        entry.from += row.baselinePain * row.paired;
        entry.to += row.dischargePain * row.paired;
        entry.paired += row.paired;
      }
      byCondition.set(row.conditionId, entry);
    }
    const conditions = [...byCondition.values()];
    const round = (value: number) => Math.round(value * 10) / 10;
    return {
      window,
      bullets,
      funnel: funnelStages.map((stage) => ({
        stage,
        label: funnelStageLabels[stage],
        episodes: stageTotal(stage),
      })),
      inTreatment: stageTotal('in_treatment'),
      topDiagnoses: conditions
        .filter((entry) => entry.diagnosed > 0)
        .map((entry) => ({ label: entry.label, value: entry.diagnosed })),
      outcomes: conditions
        .filter((entry) => entry.paired >= minimumEpisodes)
        .map((entry) => ({
          label: entry.label,
          from: round(entry.from / entry.paired),
          to: round(entry.to / entry.paired),
          episodes: entry.paired,
        })),
      tooFew: conditions
        .filter((entry) => entry.paired > 0 && entry.paired < minimumEpisodes)
        .map((entry) => ({ label: entry.label, episodes: entry.paired })),
      minimumEpisodes,
    };
  });
}

// Team -----------------------------------------------------------------------------------------

export interface TeamDashboard {
  notesTarget: number;
  notesOnTime: { label: string; value: number; counted: string }[];
  workload: { label: string; value: number }[];
}

export async function teamDashboard(actor: StaffMember, now = new Date()): Promise<TeamDashboard> {
  assertReads(actor);
  const today = istDate(now);
  const notesTarget = await settingNumber('kpi.target_notes_same_day_percent');
  return asStaff(actor, async (tx) => {
    const rows = await teamDaily(tx, addDays(today, -29), today);
    const names = await staffNames(tx, [...new Set(rows.map((row) => row.physioId))]);
    const nameOf = (id: string) => names.get(id) ?? 'A former colleague';
    const notes = new Map<string, { signed: number; started: number }>();
    const visits = new Map<string, number>();
    const weekFrom = addDays(today, -6);
    for (const row of rows) {
      if (row.metric === 'notes_signed_same_day') {
        const entry = notes.get(row.physioId) ?? { signed: 0, started: 0 };
        entry.signed += row.numerator;
        entry.started += row.denominator ?? 0;
        notes.set(row.physioId, entry);
      } else if (row.day >= weekFrom) {
        visits.set(row.physioId, (visits.get(row.physioId) ?? 0) + row.numerator);
      }
    }
    return {
      notesTarget,
      notesOnTime: [...notes.entries()]
        .filter(([, entry]) => entry.started > 0)
        .map(([id, entry]) => ({
          label: nameOf(id),
          value: Math.round((entry.signed / entry.started) * 100),
          counted: `${String(entry.signed)} of ${String(entry.started)}`,
        })),
      workload: [...visits.entries()].map(([id, value]) => ({ label: nameOf(id), value })),
    };
  });
}

// Feedback -------------------------------------------------------------------------------------

export interface FeedbackDashboard {
  figures: { label: string; target: string | null; needs: string }[];
}

export async function feedbackDashboard(actor: StaffMember): Promise<FeedbackDashboard> {
  assertReads(actor);
  const figures: FeedbackDashboard['figures'] = [];
  for (const key of ['nps', 'patient_satisfaction']) {
    const definition = kpiCatalogue.find((figure) => figure.key === key);
    if (!definition || definition.measured === true) continue;
    const target = definition.target
      ? kpiTargetText(
          await settingNumber(definition.target.setting),
          definition.target.comparison,
          definition.unit,
        )
      : null;
    figures.push({ label: definition.label, target, needs: definition.measured.needs });
  }
  return { figures };
}
