/**
 * The WhatsApp template registry (SET-11, TAD section 6): every English template the platform
 * sends, with its key, category, variables and version. Messages store the key and version they
 * were sent with (TAD `message.template_key`).
 *
 * Decisions (user, 24 October 2026): the registry lives here, typed, so messaging code cannot
 * name an unknown template or leave out a variable; the Super Admin views it (/app/templates).
 * Variables and buttons are drafted from what the PRD says each message carries, cited in
 * `source`; every template stays a draft until WA-06 writes its text and submits it to Meta. No
 * wording is written here. Changing an approved template means a new version, approved again.
 */

export type TemplateCategory = 'utility';
export type TemplateHeader = 'none' | 'document';
/** Draft until WA-06 submits it; Approved once Meta approves it, and only then sent (WA-01). */
export type TemplateStatus = 'draft' | 'approved';
export type TemplateButtonKind = 'quick_reply' | 'url' | 'flow';

export type TemplateVariable = { readonly name: string; readonly label: string };
export type TemplateButton = { readonly kind: TemplateButtonKind; readonly text: string };

export type MessageTemplateDefinition = {
  readonly key: string;
  readonly name: string;
  readonly purpose: string;
  readonly source: string;
  readonly category: TemplateCategory;
  readonly header: TemplateHeader;
  readonly variables: readonly TemplateVariable[];
  readonly buttons: readonly TemplateButton[];
  readonly version: number;
  readonly status: TemplateStatus;
};

const patientName = { name: 'patient_name', label: "The patient's first name" } as const;
const date = { name: 'date', label: 'Appointment date, in IST' } as const;
const time = { name: 'time', label: 'Appointment time, in IST' } as const;
const clinic = { name: 'clinic', label: 'Centre name' } as const;
const physio = { name: 'physio', label: "The physio's name" } as const;
const draft = { category: 'utility', version: 1, status: 'draft' } as const;

export const messageTemplates = [
  {
    key: 'booking_confirmation',
    name: 'Booking confirmation',
    purpose: 'Confirms an appointment booked through the WhatsApp booking Flow.',
    source: 'PRD J1.1; TAD section 6',
    header: 'none',
    variables: [patientName, date, time, clinic, physio],
    buttons: [],
    ...draft,
  },
  {
    key: 'front_desk_booking_confirmation',
    name: 'Front desk booking confirmation',
    purpose:
      'Confirms an appointment the front desk booked for a caller or walk in; the same content as the WhatsApp confirmation (WA-07).',
    source: 'PRD J1.5; TAD section 6',
    header: 'none',
    variables: [patientName, date, time, clinic, physio],
    buttons: [],
    ...draft,
  },
  {
    key: 'plan_sessions_list',
    name: 'Plan sessions list',
    purpose: 'Lists the dates of every plan session booked at once, in one message.',
    source: 'PRD J4.8',
    header: 'none',
    variables: [
      patientName,
      clinic,
      { name: 'sessions', label: 'The booked session dates and times, in IST' },
    ],
    buttons: [],
    ...draft,
  },
  {
    key: 'day_before_reminder',
    name: 'Day before reminder',
    purpose: 'Reminds the patient the day before; Confirm sets the appointment to Confirmed.',
    source: 'PRD J1.6; TAD section 6 (Flow template)',
    header: 'none',
    variables: [patientName, date, time, clinic, physio],
    buttons: [
      { kind: 'quick_reply', text: 'Confirm' },
      { kind: 'flow', text: 'Reschedule' },
    ],
    ...draft,
  },
  {
    key: 'morning_reminder',
    name: '8 AM reminder',
    purpose: 'Reminds every patient at 8:00 AM on the day of the appointment.',
    source: 'PRD J1.6',
    header: 'none',
    variables: [patientName, time, clinic],
    buttons: [],
    ...draft,
  },
  {
    key: 'consultation_summary',
    name: 'Consultation summary',
    purpose: 'Sends the signed consultation summary PDF.',
    source: 'PRD J4.1',
    header: 'document',
    variables: [patientName],
    buttons: [
      { kind: 'url', text: 'Open My plan' },
      { kind: 'url', text: 'Rate your visit' },
    ],
    ...draft,
  },
  {
    key: 'receipt',
    name: 'Receipt',
    purpose: 'Sends the receipt when a bill is paid.',
    source: 'PRD J4.7, M12',
    header: 'document',
    variables: [
      patientName,
      { name: 'amount', label: 'Amount paid, in rupees' },
      { name: 'bill_number', label: 'Bill number' },
    ],
    buttons: [],
    ...draft,
  },
  {
    key: 'home_programme_update',
    name: 'Home programme update',
    purpose: 'Tells the patient their home programme on My plan has changed.',
    source: 'TAD section 6; PRD J3.7',
    header: 'none',
    variables: [patientName],
    buttons: [{ kind: 'url', text: 'Open My plan' }],
    ...draft,
  },
  {
    key: 'first_treatment_check',
    name: 'Day after first treatment check',
    purpose:
      'Asks how the patient feels the day after the first treatment; "Still sore" alerts the physio.',
    source: 'PRD J5.6',
    header: 'none',
    variables: [patientName],
    buttons: [
      { kind: 'quick_reply', text: 'Better' },
      { kind: 'quick_reply', text: 'Same' },
      { kind: 'quick_reply', text: 'Still sore' },
    ],
    ...draft,
  },
  {
    key: 'session_3_check',
    name: 'Session 3 check',
    purpose: 'Checks in with the patient after the third session.',
    source: 'PRD J5.6, M14',
    header: 'none',
    variables: [patientName],
    buttons: [],
    ...draft,
  },
  {
    key: 'no_show',
    name: 'No show',
    purpose:
      'Sent when an appointment is confirmed as a no show; the front desk also gets a call task.',
    source: 'PRD J5.12',
    header: 'none',
    variables: [patientName, date, time, clinic],
    buttons: [],
    ...draft,
  },
  {
    key: 'package_expiry_reminder',
    name: 'Package expiry reminder',
    purpose: 'Reminds the patient before their package expires (the timing is a setting).',
    source: 'PRD M8; PRD rules table, package validity',
    header: 'none',
    variables: [
      patientName,
      { name: 'sessions_left', label: 'Sessions left in the package' },
      { name: 'expiry_date', label: 'Package expiry date, in IST' },
    ],
    buttons: [],
    ...draft,
  },
  {
    key: 'discharge_report',
    name: 'Discharge report with feedback',
    purpose: 'Sends the discharge report PDF and asks for discharge feedback the same day.',
    source: 'PRD J6.7, J7.1',
    header: 'document',
    variables: [patientName],
    buttons: [{ kind: 'url', text: 'Give feedback' }],
    ...draft,
  },
  {
    key: 'review_request',
    name: 'Review request',
    purpose: 'Asks every discharged patient for a Google review.',
    source: 'PRD J7.3',
    header: 'none',
    variables: [patientName],
    buttons: [{ kind: 'url', text: 'Leave a review' }],
    ...draft,
  },
  {
    key: 'follow_up_check',
    name: 'Follow up check',
    purpose:
      'Follows up after discharge at each interval in the settings; "Injured again" logs a recurrence.',
    source: 'PRD J7.4, M14',
    header: 'none',
    variables: [
      patientName,
      { name: 'period', label: 'Time since discharge, for example "6 weeks"' },
    ],
    buttons: [
      { kind: 'quick_reply', text: 'Doing well' },
      { kind: 'quick_reply', text: 'Some pain' },
      { kind: 'quick_reply', text: 'Injured again' },
    ],
    ...draft,
  },
  {
    key: 'red_flag_safety_advice',
    name: 'Safety advice after a red flag',
    purpose:
      'Sent when a red flag puts the episode On hold. Its advice is written and clinically signed off in WA-06.',
    source: 'PRD J3.10',
    header: 'none',
    variables: [patientName, { name: 'clinic_phone', label: "The centre's phone number" }],
    buttons: [],
    ...draft,
  },
] as const satisfies readonly MessageTemplateDefinition[];

export type MessageTemplate = (typeof messageTemplates)[number];
export type MessageTemplateKey = MessageTemplate['key'];

/** The variables a template needs, by name: what the messaging client must be given to send it. */
export type TemplateVariables<K extends MessageTemplateKey> = {
  [V in Extract<MessageTemplate, { key: K }>['variables'][number]['name']]: string;
};

export function messageTemplate<K extends MessageTemplateKey>(
  key: K,
): Extract<MessageTemplate, { key: K }> {
  const found = messageTemplates.find((template) => template.key === key);
  if (!found) throw new Error(`No message template ${key}`);
  return found as Extract<MessageTemplate, { key: K }>;
}

export const templateHeaderLabels: Record<TemplateHeader, string> = {
  none: 'No header',
  document: 'Document (PDF)',
};

export const templateButtonKindLabels: Record<TemplateButtonKind, string> = {
  quick_reply: 'Quick reply',
  url: 'Link',
  flow: 'WhatsApp Flow',
};

export const templateStatusLabels: Record<TemplateStatus, string> = {
  draft: 'Draft: text written in WA-06',
  approved: 'Approved by Meta',
};
