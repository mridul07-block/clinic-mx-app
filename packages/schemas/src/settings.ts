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

export const consultationFeeTimings = ['after_consultation', 'at_check_in'] as const;

interface SettingDefinition {
  schema: z.ZodType;
  source: string;
  description: string;
}

export const settingDefinitions = {
  // DECISION #2: 45 minutes until the client confirms; SET-03 adds per physio lengths.
  'scheduling.consultation_minutes': {
    schema: minutes,
    source: 'PRD section 7: Consultation length',
    description: 'Length of a consultation appointment, in minutes.',
  },
  'scheduling.session_minutes': {
    schema: z
      .strictObject({ shortest: minutes, longest: minutes })
      .refine((range) => range.shortest <= range.longest, 'shortest is longer than longest'),
    source: 'PRD section 7: Session length',
    description:
      'Range of treatment session lengths, in minutes; SET-03 sets the length per appointment type and physio within it.',
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
