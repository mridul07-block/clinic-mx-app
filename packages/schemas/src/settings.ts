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
/** A share in per cent, 0 to 100. */
const percent = z.number().min(0).max(100);
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
  'billing.session_price_items': {
    schema: z.array(priceItemKey).min(1),
    source:
      'User decision, 25 October 2026 (BIL-01): the front desk picks the session type on the plan sheet',
    description:
      'The price items a treatment session can be on the plan and payment sheet, for example Rehabilitation session.',
  },
  'billing.think_about_it_follow_up_days': {
    schema: days,
    source: 'TAD section 8: the "I’ll think about it" nudge and call task 2 days later (BIL-02)',
    description:
      'Days after "I’ll think about it" is recorded that the patient is nudged and the front desk gets a call task.',
  },
  'billing.think_about_it_follow_up_time': {
    schema: timeOfDay,
    source: 'User decision, 25 October 2026 (BIL-02): in working hours, 10:00 AM IST',
    description: 'Time of day (IST) of the "I’ll think about it" nudge and call task.',
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
  'assessment.irritability_high_above': {
    schema: z.int().min(0).max(10),
    source:
      'Consultation SOP v2 §10.2 (placeholder: HIGH is pain >5/10) and user decision 24 October 2026 (CLN-06)',
    description:
      'Worst pain (0 to 10) above this suggests High irritability in the consultation (CLN-06).',
  },
  'assessment.irritability_low_below': {
    schema: z.int().min(0).max(10),
    source:
      'Consultation SOP v2 §10.2 (placeholder: LOW is pain <3/10) and user decision 24 October 2026 (CLN-06)',
    description:
      'Worst pain (0 to 10) below this suggests Low irritability; between the two is Moderate (CLN-06).',
  },
  'assessment.acute_weeks_below': {
    schema: z.int().positive(),
    source: 'Consultation SOP v2 §10.1 (placeholder: Acute is <3 weeks) (CLN-06)',
    description: 'A duration under this many weeks suggests the Acute stage (CLN-06).',
  },
  'assessment.chronic_weeks_above': {
    schema: z.int().positive(),
    source: 'Consultation SOP v2 §10.1 (placeholder: Chronic is >12 weeks) (CLN-06)',
    description:
      'A duration over this many weeks suggests the Chronic stage; between the two is Subacute (CLN-06).',
  },
  'patients.adult_age_years': {
    schema: z.int().positive(),
    source: 'PRD J2.7: under 18 opens a guardian section',
    description:
      'Patients younger than this many years need a guardian, who signs and attends (SCH-02).',
  },
  'intake.carry_over_months': {
    schema: z.int().positive().max(120),
    source:
      'PRD J2.8 (INT-08); recommended default chosen under the user’s standing approval, 28 October 2026: 24 months',
    description:
      'A health form submitted within this many months makes the patient a returning one: its details are carried over with "Has anything changed?".',
  },
  'booking.plan_clash_alternatives': {
    schema: z.int().positive(),
    source: 'User decision 26 October 2026 (SCH-11): the 3 nearest free times that day',
    description:
      'Book plan sessions: how many of the nearest free times that day are offered for a date that is not free.',
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
  'packages.session_appointment_types': {
    schema: z.array(priceItemKey).min(1),
    source:
      'SCH-10 and SES-01 (user decisions, 25 October 2026): Session and Zero Gravity Treadmill appointments',
    description:
      'Appointment types that are treatment sessions: numbered at check in (Session n of N) and, in an episode with an active package, package sessions for the reschedule allowance.',
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
  'launch.opening_entries_open': {
    schema: z.boolean(),
    source:
      'PRD section 3 (phase 5) and section 10; user decision 27 October 2026 (SCH-13): open until the clinic closes them after go live',
    description:
      'Whether the Super Admin can still enter or correct opening entries for patients already in treatment.',
  },
  'kpi.target_red_flag_documentation_percent': {
    schema: percent,
    source: 'PRD section 9: Red flag documentation (SOP target; DSH-01)',
    description:
      'The target for the share of initial assessments with the red flag screening documented.',
  },
  'kpi.target_conversion_percent': {
    schema: percent,
    source: 'PRD section 9: Consultation to treatment conversion (SOP target; DSH-01)',
    description:
      'The target for the share of consultations that proposed a plan whose episode became Active.',
  },
  'kpi.target_completion_percent': {
    schema: percent,
    source: 'PRD section 9: Treatment completion (SOP target; DSH-01)',
    description:
      'The target for the share of treated episodes discharged with goals achieved or independent management.',
  },
  'kpi.target_meaningful_change_percent': {
    schema: percent,
    source: 'PRD section 9: Meaningful change by 6 week review (SOP target; DSH-01)',
    description:
      'The target for the share of patients with a meaningful change by the 6 week review.',
  },
  'kpi.target_return_to_sport_percent': {
    schema: percent,
    source:
      'PRD section 9: Return to sport at or above pre injury level by 12 months (SOP target; DSH-01)',
    description:
      'The target for the share of athletes back at or above their pre injury level by 12 months.',
  },
  'kpi.target_reinjury_percent': {
    schema: percent,
    source: 'PRD section 9: Reinjury within 12 months (SOP target; DSH-01)',
    description:
      'The target for the highest acceptable share of patients injured again within 12 months.',
  },
  'kpi.target_satisfaction_score': {
    schema: z.number().min(0).max(5),
    source: 'PRD section 9: Patient satisfaction (SOP target; DSH-01)',
    description: 'The target for the average satisfaction score, out of 5.',
  },
  'kpi.target_nps': {
    schema: z.number().min(-100).max(100),
    source: 'PRD section 9: Net Promoter Score (SOP target; DSH-01)',
    description: 'The target for the Net Promoter Score, -100 to 100.',
  },
  'kpi.target_notes_same_day_percent': {
    schema: percent,
    source: 'PRD section 9: Notes signed same day (SOP target; DSH-01)',
    description: 'The target for the share of notes signed on the day of the visit.',
  },
  'kpi.target_booking_flow_percent': {
    schema: percent,
    source: 'PRD section 9: Booking Flow completion (SOP target; DSH-01)',
    description: 'The target for the share of started WhatsApp Booking Flows completed.',
  },
  'kpi.target_health_form_percent': {
    schema: percent,
    source: 'PRD section 9: Health form completion before consultation (SOP target; DSH-01)',
    description:
      'The target for the share of consultations whose health form was submitted by the booked start.',
  },
  'kpi.target_session_note_minutes': {
    schema: z.number().positive(),
    source: 'PRD section 9: Session note time (SOP target; DSH-01)',
    description: 'The target for the median minutes to write a session note.',
  },
  'kpi.max_range_days': {
    schema: days,
    source: 'DSH-01 (user decision 28 October 2026: figures computed live from the records)',
    description: 'The longest period, in days, the figures are computed for in one request.',
  },
  'dashboard.busy_hours_days': {
    schema: days,
    source:
      'DSH-03, recommended default chosen under the user’s standing approval, 28 October 2026',
    description: 'How many days back the busy hours heatmap counts visits.',
  },
  'dashboard.channel_days': {
    schema: days,
    source:
      'DSH-03, recommended default chosen under the user’s standing approval, 28 October 2026',
    description: 'How many days back the booking channel donut counts new bookings.',
  },
  'kpi.min_outcome_episodes': {
    schema: z.int().positive(),
    source:
      'DSH-03, recommended default chosen under the user’s standing approval, 28 October 2026',
    description:
      'The fewest discharged episodes a diagnosis needs before its baseline to discharge outcome is drawn.',
  },
  'documents.summary_prints_category': {
    schema: z.boolean(),
    source: 'PRD decision 18, Blueprint decision 6: default off (user decision, 25 October 2026)',
    description:
      'Whether the consultation summary prints the coded physiotherapy diagnosis category.',
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
  'packages.expiry_reminder_time': {
    schema: timeOfDay,
    source: 'BIL-08: in working hours, 10:00 AM IST, as the "I’ll think about it" nudge',
    description: 'Time of day (IST) of the package expiry reminder.',
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
  'scheduling.review_search_days': {
    schema: days,
    source:
      'User decision 26 October 2026 (OUT-06): the review goes to the first free time from its date, within 7 days',
    description:
      'Days from the plan’s review date searched for the consultant’s first free time when the 6 week review is booked automatically.',
  },
  'clinical.no_show_review_after': {
    schema: z.int().positive().max(10),
    source: 'PRD J5.12: two missed in a row add a clinical review task (ALT-04)',
    description:
      'No shows in a row (since the last attended appointment) that give the physio a clinical review task.',
  },
  'billing.unpaid_sessions_flag_above': {
    schema: count,
    source: 'PRD section 7: Unpaid balance flag',
    description: 'A patient is flagged when more than this many sessions are unpaid.',
  },
  // DECISION #19: the lost to follow up period is the client's; 30 days is a placeholder.
  'clinical.lost_to_follow_up_days': {
    schema: days,
    source:
      'PRD decision 19 (open, client); user decision 27 October 2026 (OUT-10): a placeholder of 30 days since the last attended visit, with nothing booked ahead',
    description:
      'Days since the last attended visit (or the episode opening), with nothing booked ahead, after which the daily check marks an episode Lost to follow up and asks the consultant to call.',
  },
  // DECISION #4: acceptable exercise pain is the client's (4/10 in the SOP, 5/10 in the
  // workbooks); 5 is a placeholder.
  'clinical.acceptable_exercise_pain': {
    schema: z.int().min(0).max(10),
    source:
      'PRD decision 4 (open, client); user decision 27 October 2026 (OUT-04): a placeholder of 5/10, as the workbooks',
    description:
      'Highest pain during activity (0 to 10) acceptable on loading; the phase stepper shows the latest session’s pain against it beside an exit criterion that names acceptable pain.',
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
