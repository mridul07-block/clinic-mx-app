import type { SettingKey } from './settings';

/**
 * Patient links (IAM-09, TAD sections 3 and 5): patients never log in; each page they use is
 * reached through a signed link for one purpose, tied to one appointment or episode, that
 * expires. Decisions (user, 22 October 2026): lifetimes by use (settings below); a new My plan
 * link stops the older ones; form links accept one submission.
 */
export const patientLinkPurposes = [
  'health_form',
  'consent',
  'questionnaire',
  'feedback',
  'my_plan',
  'follow_up',
  'clearance',
  // WA-06: the review request's button, which opens the centre's Google review page.
  'review',
] as const;

export type PatientLinkPurpose = (typeof patientLinkPurposes)[number];

/** What a link is tied to: an appointment, an episode, or either. */
export type PatientLinkSubject = 'appointment' | 'episode' | 'either';

export interface PatientLinkPurposeDefinition {
  /** The page title patients see. */
  title: string;
  subject: PatientLinkSubject;
  /** Accepts one submission, then shows "already sent". */
  singleUse: boolean;
  /** How long a new link stays valid: a setting in hours or days. */
  lifetime: { setting: SettingKey; unit: 'hours' | 'days' };
  /** Patients get a fresh link from WhatsApp (TAD section 5: My plan only). */
  reissuedFromWhatsApp: boolean;
}

export const patientLinkDefinitions = {
  health_form: {
    title: 'Your health form',
    subject: 'appointment',
    singleUse: true,
    lifetime: { setting: 'links.health_form_hours', unit: 'hours' },
    reissuedFromWhatsApp: false,
  },
  consent: {
    title: 'Your consent',
    subject: 'either',
    singleUse: true,
    lifetime: { setting: 'links.consent_hours', unit: 'hours' },
    reissuedFromWhatsApp: false,
  },
  questionnaire: {
    title: 'Your questionnaire',
    subject: 'episode',
    singleUse: true,
    lifetime: { setting: 'links.questionnaire_days', unit: 'days' },
    reissuedFromWhatsApp: false,
  },
  feedback: {
    title: 'Your feedback',
    subject: 'either',
    singleUse: true,
    lifetime: { setting: 'links.feedback_days', unit: 'days' },
    reissuedFromWhatsApp: false,
  },
  my_plan: {
    title: 'My plan',
    subject: 'episode',
    singleUse: false,
    lifetime: { setting: 'links.my_plan_days', unit: 'days' },
    reissuedFromWhatsApp: true,
  },
  // PAT-10: the follow up after discharge, one interval's answer per link.
  follow_up: {
    title: 'How are you doing?',
    subject: 'episode',
    singleUse: true,
    lifetime: { setting: 'links.follow_up_days', unit: 'days' },
    reissuedFromWhatsApp: false,
  },
  // OUT-09: the patient's acknowledgement of a Return to training or sport clearance.
  clearance: {
    title: 'Your clearance',
    subject: 'episode',
    singleUse: true,
    lifetime: { setting: 'links.clearance_hours', unit: 'hours' },
    reissuedFromWhatsApp: false,
  },
  // WA-06: the review request's "Leave a review" button; it only redirects to the centre's
  // Google review page, so it may be opened again.
  review: {
    title: 'Leave a review',
    subject: 'episode',
    singleUse: false,
    lifetime: { setting: 'links.review_days', unit: 'days' },
    reissuedFromWhatsApp: false,
  },
} as const satisfies Record<PatientLinkPurpose, PatientLinkPurposeDefinition>;

/** Whether a link for `purpose` may be tied to this appointment or episode (exactly one). */
export function subjectFits(
  purpose: PatientLinkPurpose,
  subject: { appointmentId?: string; episodeId?: string },
): boolean {
  const hasAppointment = Boolean(subject.appointmentId);
  const hasEpisode = Boolean(subject.episodeId);
  if (hasAppointment === hasEpisode) return false;
  const wanted: PatientLinkSubject = patientLinkDefinitions[purpose].subject;
  return wanted === 'either' || (wanted === 'appointment' ? hasAppointment : hasEpisode);
}

/** When a link made at `now` ends, for a lifetime of `amount` hours or days. */
export function patientLinkExpiry(
  unit: 'hours' | 'days',
  amount: number,
  now: Date = new Date(),
): Date {
  const hours = unit === 'hours' ? amount : amount * 24;
  return new Date(now.getTime() + hours * 3_600_000);
}
