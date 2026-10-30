import { TEMPLATE_LANGUAGE } from './messaging';

/**
 * The WhatsApp template registry (SET-11, TAD section 6): every English template the platform
 * sends, with its key, category, text, variables and version. Messages store the key and version
 * they were sent with (TAD `message.template_key`).
 *
 * Decisions (user, 24 October 2026): the registry lives here, typed, so messaging code cannot
 * name an unknown template or leave out a variable; the Super Admin views it (/app/templates).
 * Variables and buttons are drafted from what the PRD says each message carries, cited in
 * `source`.
 *
 * WA-06 (user, 30 October 2026): the text is drafted by Velyx Labs from the facts each message
 * already carries, never clinical advice, and the client confirms it before WA-12 submits it on
 * the real number (DECISION WA-06). Whether Meta approved a version is per number, so it is kept
 * in the database (`whatsapp_template`), never here. Changing the text means a new version: a new
 * template on Meta (`metaTemplateName`), approved again, while the old one keeps sending.
 */

export type TemplateCategory = 'utility';
export type TemplateHeader = 'none' | 'document';
export type TemplateButtonKind = 'quick_reply' | 'url' | 'flow';

/** Meta's verdict on a template version on this environment's number (WA-06). */
export const templateApprovalStatuses = [
  'pending',
  'approved',
  'rejected',
  'paused',
  'disabled',
] as const;
export type TemplateApprovalStatus = (typeof templateApprovalStatuses)[number];

export type TemplateVariable = {
  readonly name: string;
  readonly label: string;
  /** A made-up value Meta reviews the template with; never a real patient's. */
  readonly example: string;
};
export type TemplateButton =
  | { readonly kind: 'quick_reply'; readonly text: string; readonly id: string }
  | {
      readonly kind: 'url';
      readonly text: string;
      /** The variable carrying the patient link token, the end of `<origin>/p/<token>`. */
      readonly variable: string;
    }
  | { readonly kind: 'flow'; readonly text: string };

export type MessageTemplateDefinition = {
  readonly key: string;
  readonly name: string;
  readonly purpose: string;
  readonly source: string;
  readonly category: TemplateCategory;
  readonly header: TemplateHeader;
  /** The message text; `{{n}}` is the n-th variable. */
  readonly body: string;
  readonly variables: readonly TemplateVariable[];
  readonly buttons: readonly TemplateButton[];
  readonly version: number;
  /** Why it is not submitted yet, when it waits for another ticket. */
  readonly held?: string;
};

const patientName = {
  name: 'patient_name',
  label: "The patient's first name",
  example: 'Asha',
} as const;
const date = { name: 'date', label: 'Appointment date, in IST', example: 'Mon, 2 Nov' } as const;
const time = { name: 'time', label: 'Appointment time, in IST', example: '10:00 AM' } as const;
const clinic = { name: 'clinic', label: 'Centre name', example: 'HSR Layout' } as const;
const physio = { name: 'physio', label: "The physio's name", example: 'Priya Rao' } as const;
const planLink = {
  name: 'plan_link',
  label: "The patient's My plan link token",
  example: 'k3f9q2',
} as const;
const utility = { category: 'utility', version: 1 } as const;

export const messageTemplates = [
  {
    key: 'booking_confirmation',
    name: 'Booking confirmation',
    purpose: 'Confirms an appointment booked through the WhatsApp booking Flow.',
    source: 'PRD J1.1; TAD section 6',
    header: 'none',
    body: 'Hi {{1}}, your appointment is booked: {{2}} at {{3}}, Movementology {{4}}, with {{5}}. Reply to this message if you need to change it.',
    variables: [patientName, date, time, clinic, physio],
    buttons: [],
    ...utility,
  },
  {
    key: 'front_desk_booking_confirmation',
    name: 'Front desk booking confirmation',
    purpose:
      'Confirms an appointment the front desk booked for a caller or walk in; the same content as the WhatsApp confirmation (WA-07).',
    source: 'PRD J1.5; TAD section 6',
    header: 'none',
    body: 'Hi {{1}}, your appointment is booked: {{2}} at {{3}}, Movementology {{4}}, with {{5}}. Reply to this message if you need to change it.',
    variables: [patientName, date, time, clinic, physio],
    buttons: [],
    ...utility,
  },
  {
    key: 'plan_sessions_list',
    name: 'Plan sessions list',
    purpose: 'Lists the dates of every plan session booked at once, in one message.',
    source: 'PRD J4.8',
    header: 'none',
    body: 'Hi {{1}}, your treatment sessions at Movementology {{2}} are booked for {{3}}. Reply to this message if you need to change any of them.',
    variables: [
      patientName,
      clinic,
      {
        name: 'sessions',
        // Meta refuses line breaks in a variable, so the sessions are joined with "; ".
        label: 'The booked session dates and times, in IST, joined with "; "',
        example: 'Mon, 2 Nov 10:00 AM; Wed, 4 Nov 10:00 AM; Fri, 6 Nov 10:00 AM',
      },
    ],
    buttons: [],
    ...utility,
  },
  {
    key: 'day_before_reminder',
    name: 'Day before reminder',
    purpose: 'Reminds the patient the day before; Confirm sets the appointment to Confirmed.',
    source: 'PRD J1.6; TAD section 6 (Flow template)',
    header: 'none',
    body: 'Hi {{1}}, a reminder of your appointment tomorrow, {{2}} at {{3}}, Movementology {{4}}, with {{5}}. Tap Confirm, or Reschedule to pick another time.',
    variables: [patientName, date, time, clinic, physio],
    buttons: [
      { kind: 'quick_reply', text: 'Confirm', id: 'confirm' },
      { kind: 'flow', text: 'Reschedule' },
    ],
    held: 'Its Reschedule button opens the reschedule Flow, which WA-05 builds and submits it with.',
    ...utility,
  },
  {
    key: 'morning_reminder',
    name: '8 AM reminder',
    purpose: 'Reminds every patient at 8:00 AM on the day of the appointment.',
    source: 'PRD J1.6',
    header: 'none',
    body: 'Hi {{1}}, a reminder of your appointment today at {{2}} at Movementology {{3}}. See you soon.',
    variables: [patientName, time, clinic],
    buttons: [],
    ...utility,
  },
  {
    key: 'consultation_summary',
    name: 'Consultation summary',
    purpose: 'Sends the signed consultation summary PDF.',
    source: 'PRD J4.1',
    header: 'document',
    body: "Hi {{1}}, here is the summary of your consultation at Movementology. Your plan is on My plan, and we would value your rating of today's visit.",
    variables: [
      patientName,
      planLink,
      { name: 'feedback_link', label: 'The visit feedback link token', example: 'r7m2x8' },
    ],
    buttons: [
      { kind: 'url', text: 'Open My plan', variable: 'plan_link' },
      { kind: 'url', text: 'Rate your visit', variable: 'feedback_link' },
    ],
    ...utility,
  },
  {
    key: 'receipt',
    name: 'Receipt',
    purpose: 'Sends the receipt when a bill is paid.',
    source: 'PRD J4.7, M12',
    header: 'document',
    body: 'Hi {{1}}, thank you for your payment of {{2}}. Your receipt for bill {{3}} is attached.',
    variables: [
      patientName,
      { name: 'amount', label: 'Amount paid, in rupees', example: '₹1,500' },
      { name: 'bill_number', label: 'Bill number', example: 'MVH-B-00042' },
    ],
    buttons: [],
    ...utility,
  },
  {
    key: 'home_programme_update',
    name: 'Home programme update',
    purpose: 'Tells the patient their home programme on My plan has changed.',
    source: 'TAD section 6; PRD J3.7',
    header: 'none',
    body: 'Hi {{1}}, your physio has updated your home exercise programme. Open My plan to see the changes.',
    variables: [patientName, planLink],
    buttons: [{ kind: 'url', text: 'Open My plan', variable: 'plan_link' }],
    ...utility,
  },
  {
    key: 'first_treatment_check',
    name: 'Day after first treatment check',
    purpose:
      'Asks how the patient feels the day after the first treatment; "Still sore" alerts the physio.',
    source: 'PRD J5.6',
    header: 'none',
    body: 'Hi {{1}}, how are you feeling the day after your first treatment at Movementology?',
    variables: [patientName],
    buttons: [
      { kind: 'quick_reply', text: 'Better', id: 'better' },
      { kind: 'quick_reply', text: 'Same', id: 'same' },
      { kind: 'quick_reply', text: 'Still sore', id: 'still_sore' },
    ],
    ...utility,
  },
  {
    key: 'session_3_check',
    name: 'Session 3 check',
    purpose: 'Checks in with the patient after the third session.',
    source: 'PRD J5.6, M14',
    header: 'none',
    body: 'Hi {{1}}, you have completed three sessions at Movementology. Thank you for keeping up with your treatment. If you have any questions, reply to this message.',
    variables: [patientName],
    buttons: [],
    ...utility,
  },
  {
    key: 'no_show',
    name: 'No show',
    purpose:
      'Sent when an appointment is confirmed as a no show; the front desk also gets a call task.',
    source: 'PRD J5.12',
    header: 'none',
    body: 'Hi {{1}}, we missed you at your appointment on {{2}} at {{3}}, Movementology {{4}}. Reply to this message to book a new time.',
    variables: [patientName, date, time, clinic],
    buttons: [],
    ...utility,
  },
  {
    key: 'package_expiry_reminder',
    name: 'Package expiry reminder',
    purpose: 'Reminds the patient before their package expires (the timing is a setting).',
    source: 'PRD M8; PRD rules table, package validity',
    header: 'none',
    body: 'Hi {{1}}, you have {{2}} sessions left in your package, which ends on {{3}}. Reply to this message to book your next session.',
    variables: [
      patientName,
      { name: 'sessions_left', label: 'Sessions left in the package', example: '3' },
      { name: 'expiry_date', label: 'Package expiry date, in IST', example: 'Mon, 30 Nov' },
    ],
    buttons: [],
    ...utility,
  },
  {
    key: 'discharge_report',
    name: 'Discharge report with feedback',
    purpose: 'Sends the discharge report PDF and asks for discharge feedback the same day.',
    source: 'PRD J6.7, J7.1',
    header: 'document',
    body: 'Hi {{1}}, congratulations on completing your treatment at Movementology. Your discharge report is attached. Please tell us how we did.',
    variables: [
      patientName,
      { name: 'feedback_link', label: 'The discharge feedback link token', example: 'd5w1z4' },
    ],
    buttons: [{ kind: 'url', text: 'Give feedback', variable: 'feedback_link' }],
    ...utility,
  },
  {
    key: 'review_request',
    name: 'Review request',
    purpose: 'Asks every discharged patient for a Google review.',
    source: 'PRD J7.3',
    header: 'none',
    body: 'Hi {{1}}, thank you for choosing Movementology. If you were happy with your care, a short Google review would help others find us.',
    variables: [
      patientName,
      {
        name: 'review_link',
        label: "The link token that opens the centre's Google review page",
        example: 'g8h3n6',
      },
    ],
    buttons: [{ kind: 'url', text: 'Leave a review', variable: 'review_link' }],
    ...utility,
  },
  {
    key: 'follow_up_check',
    name: 'Follow up check',
    purpose:
      'Follows up after discharge at each interval in the settings; "Injured again" logs a recurrence.',
    source: 'PRD J7.4, M14',
    header: 'none',
    body: 'Hi {{1}}, it has been {{2}} since you finished your treatment at Movementology. How are you doing?',
    variables: [
      patientName,
      { name: 'period', label: 'Time since discharge, for example "6 weeks"', example: '6 weeks' },
    ],
    buttons: [
      { kind: 'quick_reply', text: 'Doing well', id: 'doing_well' },
      { kind: 'quick_reply', text: 'Some pain', id: 'some_pain' },
      { kind: 'quick_reply', text: 'Injured again', id: 'injured_again' },
    ],
    ...utility,
  },
  {
    key: 'red_flag_safety_advice',
    name: 'Safety advice after a red flag',
    purpose:
      'Sent when a red flag puts the episode On hold. Holding text with no medical advice until the clinical lead signs off the advice (DECISION WA-06).',
    source: 'PRD J3.10',
    header: 'none',
    body: 'Hi {{1}}, your physio has advised further checks before you continue treatment. Please follow the advice you were given at the clinic. If you have any questions, please call us on {{2}} during clinic hours.',
    variables: [
      patientName,
      { name: 'clinic_phone', label: "The centre's phone number", example: '+91 80 4000 0000' },
    ],
    buttons: [],
    ...utility,
  },
] as const satisfies readonly MessageTemplateDefinition[];

export type MessageTemplate = (typeof messageTemplates)[number];
export type MessageTemplateKey = MessageTemplate['key'];

/** The variables a template needs, by name: what the messaging client must be given to send it. */
export type TemplateVariables<K extends MessageTemplateKey> = {
  [V in Extract<MessageTemplate, { key: K }>['variables'][number]['name']]: string;
};

/**
 * Everything a message row must carry to send the template: its variables, and for a document
 * header the PDF's link and file name.
 */
export type TemplateParameters<K extends MessageTemplateKey> = Extract<
  MessageTemplate,
  { key: K }
>['header'] extends 'document'
  ? TemplateVariables<K> & { document_link: string; document_name: string }
  : TemplateVariables<K>;

export function messageTemplate<K extends MessageTemplateKey>(
  key: K,
): Extract<MessageTemplate, { key: K }> {
  const found = messageTemplates.find((template) => template.key === key);
  if (!found) throw new Error(`No message template ${key}`);
  return found as Extract<MessageTemplate, { key: K }>;
}

/** The name a template version has on Meta: a new version is a new template there. */
export function metaTemplateName(key: string, version: number): string {
  return `${key}_v${version}`;
}

/** The variables that fill the text, in `{{n}}` order; the others fill link buttons. */
export function bodyVariables(template: MessageTemplateDefinition): readonly TemplateVariable[] {
  const linkVariables = new Set(
    template.buttons.flatMap((button) => (button.kind === 'url' ? [button.variable] : [])),
  );
  return template.variables.filter((variable) => !linkVariables.has(variable.name));
}

/** The text with each `{{n}}` replaced by its variable's name, as the templates page shows it. */
export function bodyWithNames(template: MessageTemplateDefinition): string {
  const names = bodyVariables(template).map((variable) => variable.name);
  return template.body.replace(/\{\{(\d+)\}\}/g, (match, n: string) => {
    const name = names[Number(n) - 1];
    return name ? `{{${name}}}` : match;
  });
}

/** Where link buttons lead: a patient link on our domain, the token as the variable part. */
export function templateLinkBase(origin: string): string {
  return `${origin.replace(/\/+$/, '')}/p/`;
}

/**
 * The request that creates a template version on Meta (`POST /<business account>/message_templates`),
 * with made-up examples for Meta's review. A document header needs the handle of a sample PDF
 * uploaded first; a Flow button needs the Flow.
 */
export function templateCreateBody(
  template: MessageTemplateDefinition,
  options: { origin: string; documentHandle?: string; flowId?: string },
) {
  const examples = bodyVariables(template).map((variable) => variable.example);
  const variable = (name: string) => {
    const found = template.variables.find((entry) => entry.name === name);
    if (!found) throw new Error(`Template ${template.key} has no variable ${name}`);
    return found;
  };
  const components: Record<string, unknown>[] = [];
  if (template.header === 'document') {
    if (!options.documentHandle) throw new Error(`Template ${template.key} needs a sample PDF`);
    components.push({
      type: 'HEADER',
      format: 'DOCUMENT',
      example: { header_handle: [options.documentHandle] },
    });
  }
  components.push({
    type: 'BODY',
    text: template.body,
    ...(examples.length > 0 ? { example: { body_text: [examples] } } : {}),
  });
  if (template.buttons.length > 0) {
    const base = templateLinkBase(options.origin);
    components.push({
      type: 'BUTTONS',
      buttons: template.buttons.map((button) => {
        switch (button.kind) {
          case 'quick_reply':
            return { type: 'QUICK_REPLY', text: button.text };
          case 'url':
            return {
              type: 'URL',
              text: button.text,
              url: `${base}{{1}}`,
              example: [`${base}${variable(button.variable).example}`],
            };
          case 'flow':
            if (!options.flowId) throw new Error(`Template ${template.key} needs its Flow`);
            return {
              type: 'FLOW',
              text: button.text,
              flow_id: options.flowId,
              flow_action: 'data_exchange',
            };
        }
      }),
    });
  }
  return {
    name: metaTemplateName(template.key, template.version),
    language: TEMPLATE_LANGUAGE,
    category: template.category.toUpperCase(),
    components,
  };
}

/** The payload a quick reply sends back, so the router knows which template and button. */
export function quickReplyPayload(key: string, id: string): string {
  return `${key}.${id}`;
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

/** This environment's Meta verdict, or none yet. */
export const templateApprovalLabels: Record<TemplateApprovalStatus | 'not_submitted', string> = {
  not_submitted: 'Not submitted',
  pending: 'Waiting for Meta',
  approved: 'Approved by Meta',
  rejected: 'Rejected by Meta',
  paused: 'Paused by Meta',
  disabled: 'Disabled by Meta',
};
