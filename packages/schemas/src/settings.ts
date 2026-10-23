import { z } from 'zod';

/**
 * Business rules that the Super Admin changes without a code release (rule 6, PRD section 7).
 * This registry names each setting and the shape of its value; the values themselves live only
 * in the `setting` table, inserted by migration, so no rule is a number in the code. A CI
 * database test checks that every key here has a row whose value parses.
 *
 * `source` names the rule a setting implements: a PRD section 7 row ("PRD section 7: <Rule>"),
 * a TAD line or an agreed decision. A unit test checks every Setting row of PRD section 7 is
 * covered. Settings are global; per centre, per physio and per appointment type values belong to
 * those records (SET-01, SET-03).
 */

const minutes = z.int().positive();
const days = z.int().positive();
const hours = z.int().positive();
const count = z.int().nonnegative();
/** A price item key from the price master (SET-02), for example "zero_gravity_treadmill". */
const priceItemKey = z.string().regex(/^[a-z][a-z0-9_]*$/);
/** A time of day in IST, "HH:MM" on a 24 hour clock. */
const timeOfDay = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const interval = z.strictObject({ count: z.int().positive(), unit: z.enum(['week', 'month']) });
/** A rate limit (IAM-11): at most `count` in a window of `minutes`. */
const limit = z.strictObject({ count: z.int().positive(), minutes: z.int().positive() });

export const consultationFeeTimings = ['after_consultation', 'at_check_in'] as const;

/**
 * PRD section 7 Setting rows whose values live on records, not in the `setting` table: the Super
 * Admin still changes them without a code release (SET-03, user decision 22 October 2026).
 */
export const recordRules = {
  'Consultation length': 'The Consultation appointment type, and per physio lengths (SET-03)',
  'Session length': 'The Session appointment type, and per physio lengths (SET-03)',
} as const;

interface SettingDefinition {
  schema: z.ZodType;
  source: string;
  description: string;
}

export const settingDefinitions = {
  'scheduling.slot_minutes': {
    schema: minutes,
    source: 'Decision G2 (kickoff review, 21 October 2026): 15 minute slot step, no buffer',
    description:
      'The calendar grid, in minutes; every appointment length is a whole number of slots (SET-03).',
  },
  'booking.slot_hold_minutes': {
    schema: minutes,
    source: 'TAD section 6 Booking Flow: a 5 minute hold when a slot is picked (SCH-04)',
    description:
      'How long a picked slot is held for the person booking it before others can take it.',
  },
  'live.refresh_seconds': {
    schema: z.int().positive(),
    source:
      'User decision 22 October 2026 (SCH-05): live screens check for changes every 3 seconds until the realtime relay (FND-09)',
    description: 'How often live screens, such as the calendar, check for changes, in seconds.',
  },
  'billing.consultation_price_items': {
    schema: z.array(priceItemKey).min(1),
    source:
      'Decision G4 (kickoff review, 21 October 2026): a consultation price per consultant, by their level (the PRD section 7 price master)',
    description:
      'The price items a consultant’s consultation fee can be, for example Consultation and Senior consultation.',
  },
  'screening.weight_loss_kg': {
    schema: z.int().positive(),
    source:
      'PRD section 10 decision 5 (placeholder: 5 kg, from the Red Flag Screening Framework §13)',
    description:
      'Unexplained weight loss of at least this many kilograms (within screening.weight_loss_months) raises a red flag (SET-10).',
  },
  'screening.weight_loss_months': {
    schema: z.int().positive(),
    source:
      'PRD section 10 decision 5 (placeholder: 6 months, from the Red Flag Screening Framework §13)',
    description: 'The period, in months, the weight loss red flag counts within (SET-10).',
  },
  'screening.morning_stiffness_minutes': {
    schema: minutes,
    source:
      'PRD section 10 decision 6 (placeholder: 60 minutes, from the Red Flag Screening Framework §12)',
    description: 'Morning stiffness lasting at least this many minutes raises a red flag (SET-10).',
  },
  'patients.adult_age_years': {
    schema: z.int().positive(),
    source: 'PRD J2.7: under 18 opens a guardian section',
    description:
      'Patients younger than this many years need a guardian, who signs and attends (SCH-02).',
  },
  'booking.self_booking_block_reschedules': {
    schema: z.int().positive(),
    source: 'PRD section 7: Self booking block',
    description: 'Reschedules after which a patient can no longer book themselves.',
  },
  'booking.self_booking_block_no_shows': {
    schema: z.int().positive(),
    source: 'PRD section 7: Self booking block',
    description: 'Verified no shows after which a patient can no longer book themselves.',
  },
  'packages.reschedules_per_10_sessions': {
    schema: count,
    source: 'PRD section 7: Package reschedules',
    description: 'Reschedules a package allows for every 10 booked sessions.',
  },
  'packages.never_reschedulable_items': {
    schema: z.array(priceItemKey),
    source: 'PRD section 7: Package reschedules',
    description: 'Price items whose package sessions can never be rescheduled.',
  },
  'day.running_late_minutes': {
    schema: minutes,
    source: 'PRD section 7: Running late',
    description:
      'Minutes after the start time when a patient not checked in shows as running late.',
  },
  'day.no_show_allowed_minutes': {
    schema: minutes,
    source: 'PRD section 7: No show allowed from',
    description: 'Minutes after the start time from which an appointment can be marked a no show.',
  },
  'reports.max_file_mb': {
    schema: z.int().positive().max(4),
    source: 'TAD section 9: reports bucket; at most 4 MB, the hosted request limit (INT-02)',
    description: 'Largest report photo or scan the front desk can add, in megabytes.',
  },
  'billing.consultation_fee_timing': {
    schema: z.enum(consultationFeeTimings),
    source: 'PRD section 7: Consultation fee timing',
    description: 'When the consultation fee is billed: after the consultation or at check in.',
  },
  'packages.validity_months': {
    schema: z.int().positive(),
    source: 'PRD section 7: Package validity',
    description: 'Months a package stays valid from its payment date.',
  },
  'packages.expiry_reminder_days': {
    schema: days,
    source: 'PRD section 7: Package validity',
    description: 'Days before a package expires that the patient is reminded.',
  },
  'clinical.baseline_reuse_days': {
    schema: days,
    source: 'PRD section 7: Baseline reuse',
    description: 'Consultation measures taken within this many days count as the baseline.',
  },
  'clinical.reassessment_session': {
    schema: z.int().positive(),
    source: 'PRD section 7: Reassessment',
    description: 'Treatment session number at which the patient is reassessed.',
  },
  'clinical.review_weeks': {
    schema: z.int().positive(),
    source: 'PRD section 7: Reassessment',
    description: 'Weeks into the plan of the review with the consultant.',
  },
  'billing.unpaid_sessions_flag_above': {
    schema: count,
    source: 'PRD section 7: Unpaid balance flag',
    description: 'A patient is flagged when more than this many sessions are unpaid.',
  },
  'engagement.follow_ups_after_discharge': {
    schema: z.array(interval).min(1),
    source: 'PRD section 7: Follow ups',
    description: 'When follow up messages are sent, counted from the discharge date.',
  },
  'security.desktop_idle_logout_minutes': {
    schema: minutes,
    source: 'PRD section 7: Auto logout',
    description: 'Minutes without activity after which a desktop session signs out.',
  },
  'security.phone_session_days': {
    schema: days,
    source: 'Kickoff decision G7',
    description: 'Days a phone session stays signed in.',
  },
  'security.support_grant_max_hours': {
    schema: hours,
    source: 'User decision, 22 October 2026 (IAM-08)',
    description: 'Longest Velyx support access the Super Admin can grant, in hours.',
  },
  'links.health_form_hours': {
    schema: hours,
    source: 'User decision, 22 October 2026 (IAM-09)',
    description: 'Hours a health form link stays valid (opened from a QR at check in).',
  },
  'links.consent_hours': {
    schema: hours,
    source: 'User decision, 22 October 2026 (IAM-09)',
    description: 'Hours a consent link stays valid (opened from a QR at the clinic).',
  },
  'links.questionnaire_days': {
    schema: days,
    source: 'User decision, 22 October 2026 (IAM-09)',
    description: 'Days a questionnaire link stays valid.',
  },
  'links.feedback_days': {
    schema: days,
    source: 'User decision, 22 October 2026 (IAM-09)',
    description: 'Days a feedback link stays valid.',
  },
  'links.my_plan_days': {
    schema: days,
    source: 'User decision, 22 October 2026 (IAM-09)',
    description: 'Days a My plan link stays valid; patients get a new one from WhatsApp.',
  },
  'kiosk.idle_seconds': {
    schema: z.int().positive(),
    source: 'Frontend Specification section 7: Kiosk mode',
    description:
      'Seconds without a touch after which the clinic tablet goes back to its welcome screen.',
  },
  'kiosk.thank_you_seconds': {
    schema: z.int().positive(),
    source: 'User decision, 22 October 2026 (IAM-10)',
    description: 'Seconds the thank you screen stays on the clinic tablet after a submit.',
  },
  'limits.sign_in_per_email': {
    schema: limit,
    source: 'User decision, 22 October 2026 (IAM-11)',
    description: 'Failed sign ins allowed for one email in the window.',
  },
  'limits.sign_in_per_network': {
    schema: limit,
    source: 'User decision, 22 October 2026 (IAM-11)',
    description: 'Failed sign ins allowed from one network (IP address) in the window.',
  },
  'limits.reset_email_per_email': {
    schema: limit,
    source: 'User decision, 22 October 2026 (IAM-11)',
    description: 'Password reset emails one email can ask for in the window.',
  },
  'limits.reset_email_per_network': {
    schema: limit,
    source: 'User decision, 22 October 2026 (IAM-11)',
    description: 'Password reset emails one network can ask for in the window.',
  },
  'limits.two_step_per_person': {
    schema: limit,
    source: 'User decision, 22 October 2026 (IAM-11)',
    description: 'Wrong two step codes allowed for one login in the window.',
  },
  'limits.bad_links_per_network': {
    schema: limit,
    source: 'User decision, 22 October 2026 (IAM-11)',
    description: 'Patient links that are not valid one network can open in the window.',
  },
  'limits.link_opens_per_network': {
    schema: limit,
    source: 'User decision, 22 October 2026 (IAM-11)',
    description: 'Patient links one network can open in the window.',
  },
  'limits.webhook_failures_per_network': {
    schema: limit,
    source: 'User decision, 22 October 2026 (IAM-11)',
    description: 'Webhook calls with a wrong secret allowed from one network in the window.',
  },
  'reminders.day_before_time': {
    schema: timeOfDay,
    source: 'TAD section 8: Day before reminder',
    description: 'Time of day (IST) the day before reminder is sent.',
  },
} as const satisfies Record<string, SettingDefinition>;

export type SettingKey = keyof typeof settingDefinitions;

export type SettingValue<K extends SettingKey> = z.infer<(typeof settingDefinitions)[K]['schema']>;

/** Every setting with its value, as the settings reader returns them. */
export type Settings = { [K in SettingKey]: SettingValue<K> };

export const settingKeys = Object.keys(settingDefinitions) as SettingKey[];

export function isSettingKey(key: string): key is SettingKey {
  return Object.hasOwn(settingDefinitions, key);
}

/** Validates a value for `key`; throws a ZodError naming what is wrong. */
export function parseSetting<K extends SettingKey>(key: K, value: unknown): SettingValue<K> {
  // The definition's own schema produces this key's value type.
  return settingDefinitions[key].schema.parse(value) as SettingValue<K>;
}
