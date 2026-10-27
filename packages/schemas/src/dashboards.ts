import { addDays } from './ist';

/**
 * The Centre Manager's dashboards (DSH-03, Frontend Specification sections 6 and 8): alerts,
 * centres, outcomes, team and feedback. The figures come from count functions in the database
 * (never a patient); this module holds what is pure about them, tested without a database.
 * Recommended defaults chosen under the user's standing approval, 28 October 2026
 * (docs/runbooks/manager-dashboards.md).
 */

export const dashboardTabs = ['alerts', 'centres', 'outcomes', 'team', 'feedback'] as const;

export type DashboardTab = (typeof dashboardTabs)[number];

export const dashboardTabLabels: Record<DashboardTab, string> = {
  alerts: 'Alerts',
  centres: 'Centres',
  outcomes: 'Outcomes',
  team: 'Team',
  feedback: 'Feedback',
};

/** What `internal.manager_alert_counts` counts, per centre. */
export const alertItems = [
  'red_flags_emergency',
  'red_flags_raised',
  'red_flags_reviewed',
  'red_flags_referred',
  'unsigned_notes',
  'reassessments_awaiting',
  'reviews_open',
  'episodes_on_hold',
  'episodes_lost',
] as const;

export type AlertItem = (typeof alertItems)[number];

export const alertItemLabels: Record<AlertItem, string> = {
  red_flags_emergency: 'Emergency red flags not yet reviewed',
  red_flags_raised: 'Red flags waiting for review',
  red_flags_reviewed: 'Red flags reviewed, not yet closed',
  red_flags_referred: 'Red flags referred, not yet closed',
  unsigned_notes: 'Notes started and not signed',
  reassessments_awaiting: 'Reassessments waiting for the consultant’s decision',
  reviews_open: 'New symptoms and adverse events to review',
  episodes_on_hold: 'Episodes on hold',
  episodes_lost: 'Episodes lost to follow up',
};

/** Where each count's list is; null where no list exists yet, with where to look instead. */
export const alertItemLinks: Record<AlertItem, string | null> = {
  red_flags_emergency: '/app/alerts',
  red_flags_raised: '/app/alerts',
  red_flags_reviewed: '/app/alerts',
  red_flags_referred: '/app/alerts',
  unsigned_notes: '/app/tasks',
  reassessments_awaiting: '/app/tasks',
  reviews_open: '/app/tasks',
  episodes_on_hold: null,
  episodes_lost: '/app/tasks',
};

/** Where to find the items with no list of their own yet. */
export const alertItemWhere: Partial<Record<AlertItem, string>> = {
  episodes_on_hold: 'Each one shows on the patient’s record; a list of them is not built yet.',
};

/** The Frontend Specification's alert lines whose data no ticket has built yet. */
export const alertsComing = [
  { label: 'Stalled progress', needs: 'Comes with progress alerts (ALT-02)' },
  { label: 'Service recovery', needs: 'Comes with discharge feedback (PAT-08)' },
] as const;

/** The funnel from a consultation to a completed plan (`internal.kpi_funnel`), in order. */
export const funnelStages = [
  'consultation_held',
  'plan_proposed',
  'active',
  'discharged',
  'discharged_goals_met',
] as const;

export type FunnelStage = (typeof funnelStages)[number];

export const funnelStageLabels: Record<FunnelStage, string> = {
  consultation_held: 'Consultation held',
  plan_proposed: 'Plan proposed',
  active: 'Started treatment (paid)',
  discharged: 'Discharged',
  discharged_goals_met: 'Discharged with goals met',
};

export const outcomeWindows = ['30', '90', '365'] as const;

export type OutcomeWindow = (typeof outcomeWindows)[number];

export const outcomeWindowLabels: Record<OutcomeWindow, string> = {
  '30': 'Last 30 days',
  '90': 'Last 90 days',
  '365': 'Last 12 months',
};

export const DEFAULT_OUTCOME_WINDOW: OutcomeWindow = '90';

/** The window asked for, or the default. */
export function outcomeWindow(value: string | undefined): OutcomeWindow {
  return outcomeWindows.find((window) => window === value) ?? DEFAULT_OUTCOME_WINDOW;
}

/** A window of `days` ending today, and the equal window before it. */
export function windowDays(
  days: number,
  today: string,
): { current: { from: string; to: string }; previous: { from: string; to: string } } {
  const from = addDays(today, 1 - days);
  return {
    current: { from, to: today },
    previous: { from: addDays(from, -days), to: addDays(from, -1) },
  };
}

interface Span {
  startsAt: Date;
  endsAt: Date;
}

const minutesOf = (span: Span) => (span.endsAt.getTime() - span.startsAt.getTime()) / 60_000;

/**
 * Utilisation (Frontend Specification section 6, Centres): rostered minutes (the roster's windows
 * with approved leave already cut out) and the booked minutes inside them. A booking outside the
 * windows (another centre's hours) does not count.
 */
export function utilisationMinutes(
  windows: readonly Span[],
  bookings: readonly Span[],
): { booked: number; rostered: number } {
  let booked = 0;
  for (const window of windows) {
    for (const booking of bookings) {
      const startsAt = Math.max(window.startsAt.getTime(), booking.startsAt.getTime());
      const endsAt = Math.min(window.endsAt.getTime(), booking.endsAt.getTime());
      if (endsAt > startsAt) booked += (endsAt - startsAt) / 60_000;
    }
  }
  return { booked, rostered: windows.reduce((sum, window) => sum + minutesOf(window), 0) };
}

/**
 * How long a patient waited: from the later of their arrival and the booked start (arriving early
 * is not waiting) to the start of the visit, or to now while they still wait. Whole minutes.
 */
export function waitMinutes(
  visit: { startsAt: Date; arrivedAt: Date; startedAt: Date | null },
  now: Date,
): number {
  const from = Math.max(visit.arrivedAt.getTime(), visit.startsAt.getTime());
  const to = (visit.startedAt ?? now).getTime();
  return Math.max(0, Math.round((to - from) / 60_000));
}

/** The middle value (the mean of the two middle ones for an even count); null for none. */
export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? (sorted[middle] ?? null)
    : ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
}

/** A change between two periods in words: "+12 on the 7 days before", "same as …". */
export function changeWords(current: number, previous: number, unit = ''): string {
  const difference = Math.round((current - previous) * 10) / 10;
  if (difference === 0) return 'Same as the period before';
  const sign = difference > 0 ? '+' : '−';
  return `${sign}${String(Math.abs(difference))}${unit} on the period before`;
}

/** Booking channels shown on the donut (Frontend Specification section 8: WhatsApp, phone, walk in). */
export const channelParts = ['whatsapp', 'front_desk', 'walk_in'] as const;

export const channelPartLabels: Record<(typeof channelParts)[number], string> = {
  whatsapp: 'WhatsApp',
  front_desk: 'Front desk (phone)',
  walk_in: 'Walk in',
};
