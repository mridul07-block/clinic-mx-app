import { z } from 'zod';
import { accessScope, type StaffAccess } from './permissions';

/**
 * The audit log viewer (ADM-01; PRD M16 and section 2: "Audit log | Full | Clinical audit, own
 * centres | No | No | Finance audit"). Recommended defaults chosen under the user's standing
 * approval, 29 October 2026 (DECISION ADM-01; docs/runbooks/audit.md): each table belongs to one
 * part of the trail; the database (`internal.audit_category`) holds the same list, and a database
 * test keeps them in step.
 */

/** A clinical record's own tables: their values are read only by clinicians. */
const clinicalRecordTables = [
  'consultation',
  'session',
  'measure',
  'baseline_measure',
  'special_test_result',
  'reassessment',
  'final_test',
  'clearance',
  'phase_mark',
  'phase_move',
  'readiness_mark',
  'readiness_recording',
  'diagnosis',
  'plan_of_care',
  'plan_modality',
  'addendum',
  'confirmed_diagnosis',
  'precaution',
  'intake_response',
  'document',
  'patient_report',
  'exercise_tick',
  'questionnaire_result',
  'ai_run',
  'ai_preparation_sheet',
  'ai_suggestion',
] as const;

/** The patient's care around the record: identity, bookings, consent, alerts, tasks. */
const clinicalTables = [
  'patient',
  'guardian',
  'episode',
  'appointment',
  'plan_booking',
  'booking_counter',
  'consent_record',
  'red_flag_alert',
  'task',
  'patient_link',
  'feedback',
  'follow_up_schedule',
] as const;

/** Anything holding money. */
const financeTables = [
  'bill',
  'bill_line',
  'payment',
  'refund_credit',
  'package',
  'opening_entry',
  'price_item',
  'package_type',
  'package_type_item',
  'discount_preset',
  'plan_choice',
] as const;

/** Setup: staff, access, centres, settings, the knowledge base; the Super Admin's alone. */
export const auditSetupTables = [
  'appointment_type',
  'centre',
  'kb_condition',
  'kb_condition_listing',
  'kb_diagnosis_category',
  'kb_measure',
  'kb_modality',
  'kb_patient_content',
  'kb_phase',
  'kb_phase_criterion',
  'kb_questionnaire',
  'kb_readiness_criterion',
  'kb_red_flag_presentation',
  'kb_red_flag_rule',
  'kb_report',
  'kb_special_test',
  'kb_version',
  'kiosk_device',
  'notification',
  'physio_appointment_length',
  'roster',
  'setting',
  'staff_leave',
  'staff_user',
  'staff_user_centre',
  'support_grant',
] as const;

/** Every table placed on purpose; a database test checks each audited table is here once. */
export const auditPlacedTables: readonly string[] = [
  ...clinicalRecordTables,
  ...clinicalTables,
  ...financeTables,
  ...auditSetupTables,
];

export type AuditCategory = 'clinical_record' | 'clinical' | 'finance' | 'admin';

/** The part of the trail a table's events belong to; a table not placed yet is setup (admin). */
export function auditCategory(entity: string): AuditCategory {
  if ((clinicalRecordTables as readonly string[]).includes(entity)) return 'clinical_record';
  if ((clinicalTables as readonly string[]).includes(entity)) return 'clinical';
  if ((financeTables as readonly string[]).includes(entity)) return 'finance';
  return 'admin';
}

/** The parts one filters by; clinical takes in the clinical record. */
export const auditParts = ['clinical', 'finance', 'admin'] as const;
export type AuditPart = (typeof auditParts)[number];

export const auditPartLabels: Record<AuditPart, string> = {
  clinical: 'Clinical',
  finance: 'Finance',
  admin: 'Staff, access and setup',
};

/** The parts a person may read: the Super Admin all, Centre Managers clinical, Finance finance. */
export function auditPartsFor(staff: StaffAccess): AuditPart[] {
  if (accessScope(staff, 'audit.view_all')) return [...auditParts];
  const parts: AuditPart[] = [];
  if (accessScope(staff, 'audit.view_clinical')) parts.push('clinical');
  if (accessScope(staff, 'audit.view_finance')) parts.push('finance');
  return parts;
}

/** The tables of a part, for the record type filter. */
export function auditTablesOf(part: AuditPart): readonly string[] {
  if (part === 'clinical') return [...clinicalTables, ...clinicalRecordTables];
  if (part === 'finance') return financeTables;
  return [];
}

/** A table's name as people read it: "red_flag_alert" is "Red flag alert". */
export function auditEntityLabel(entity: string): string {
  const words = entity.replace(/^kb_/, 'knowledge base ').replaceAll('_', ' ');
  return `${words.charAt(0).toUpperCase()}${words.slice(1)}`;
}

export const auditActionLabels: Record<string, string> = {
  insert: 'Added',
  update: 'Changed',
  delete: 'Removed',
  view: 'Opened',
  sign_in: 'Signed in',
  sign_out: 'Signed out',
  password_change: 'Changed password',
  two_step_on: 'Turned on two step verification',
  two_step_reset: 'Reset two step verification',
  staff_invited: 'Invited',
  invite_link_created: 'Made an invite link',
  support_request: 'Support request',
};

/** Who did it, as the log shows it: the staff member's name, a patient's link, or the system. */
export function auditActorLabel(actor: string, staffName: string | null): string {
  if (staffName) return staffName;
  if (actor.startsWith('patient:')) return 'Patient, through a link';
  if (actor.startsWith('system:')) return `System (${actor.slice('system:'.length)})`;
  return 'Former staff member';
}

/** The filters, from the page's address (see `auditLogQuery`). */
export const auditLogQuerySchema = z.object({
  part: z.enum(auditParts).optional(),
  entity: z
    .string()
    .regex(/^[a-z_]{1,64}$/)
    .optional(),
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
  before: z.coerce.number().int().positive().optional(),
});
export type AuditLogQuery = z.infer<typeof auditLogQuerySchema>;

/**
 * The filters from the page's address, each on its own: a malformed one is dropped and the others
 * kept. Whether the reader may use a part or table is the service's to refuse.
 */
export function auditLogQuery(raw: Record<string, unknown>): AuditLogQuery {
  const query: Record<string, unknown> = {};
  for (const [key, field] of Object.entries(auditLogQuerySchema.shape)) {
    const parsed = field.safeParse(raw[key]);
    if (parsed.success && parsed.data !== undefined) query[key] = parsed.data;
  }
  return auditLogQuerySchema.parse(query);
}

/** One event as the viewer reads it. `before` and `after` are null when values are hidden. */
export interface AuditLogEntry {
  id: number;
  at: Date;
  actor: string;
  actorName: string | null;
  action: string;
  entity: string;
  entityId: string | null;
  category: AuditCategory;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  /** The fields an update changed, or an insert or delete held; null for other events. */
  changed: string[] | null;
  /** True when the values are a clinical record's and the reader is not a clinician. */
  redacted: boolean;
  /** Fields withheld from this reader (discharge text without the Treats tick, AI spend). */
  hiddenFields: string[];
}

/** A field's value as the log shows it, kept short. */
export function auditValue(value: unknown): string {
  if (value === null || value === undefined) return 'empty';
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return text.length > 80 ? `${text.slice(0, 79)}…` : text;
}
