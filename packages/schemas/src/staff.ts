import { z } from 'zod';
import { calendarDateSchema } from './ist';

/**
 * The five staff roles (PRD section 2). Each staff member has exactly one. The database
 * enum `staff_role` is built from this list, so client, server and database share it.
 */
export const staffRoles = [
  'super_admin',
  'centre_manager',
  'front_desk',
  'physiotherapist',
  'finance',
] as const;

export const staffRoleSchema = z.enum(staffRoles);

export type StaffRole = z.infer<typeof staffRoleSchema>;

/** How each role is named on screen (PRD section 2). */
export const staffRoleLabels: Record<StaffRole, string> = {
  super_admin: 'Super Admin',
  centre_manager: 'Centre Manager',
  front_desk: 'Front Desk',
  physiotherapist: 'Physiotherapist',
  finance: 'Finance',
};

/**
 * Two step verification (PRD section 2, TAD section 5): required for every role except Front
 * Desk, where it is optional (turned on from the account page).
 */
export function twoStepRequired(role: StaffRole): boolean {
  return role !== 'front_desk';
}

/**
 * Super Admin and Finance see every centre (PRD section 2); everyone else only the centres they
 * are assigned. internal.staff_claims applies the same rule in the database.
 */
export function seesAllCentres(role: StaffRole): boolean {
  return role === 'super_admin' || role === 'finance';
}

/**
 * The `clinic` claim in every staff token (IAM-03, TAD section 5), built by the database
 * (internal.staff_claims) and read by row level security. `all_centres` is true for the roles
 * that see every centre; `centres` lists the person's assigned centres.
 */
export const staffClaimsSchema = z.object({
  staff_id: z.guid(),
  role: staffRoleSchema,
  treats_patients: z.boolean(),
  consultant: z.boolean(),
  all_centres: z.boolean(),
  centres: z.array(z.guid()),
});

export type StaffClaims = z.infer<typeof staffClaimsSchema>;

/**
 * Whether a token's claim still says what the database says now. Missing on both sides counts as
 * the same; a malformed claim never matches.
 */
export function sameStaffClaims(token: unknown, current: unknown): boolean {
  const missing = (claim: unknown) => claim === null || claim === undefined;
  if (missing(token) || missing(current)) return missing(token) && missing(current);
  const a = staffClaimsSchema.safeParse(token);
  const b = staffClaimsSchema.safeParse(current);
  if (!a.success || !b.success) return false;
  const sorted = (ids: string[]) => [...ids].sort().join(',');
  return (
    a.data.staff_id === b.data.staff_id &&
    a.data.role === b.data.role &&
    a.data.treats_patients === b.data.treats_patients &&
    a.data.consultant === b.data.consultant &&
    a.data.all_centres === b.data.all_centres &&
    sorted(a.data.centres) === sorted(b.data.centres)
  );
}

/**
 * A staff member's details as the Super Admin sets them (IAM-06, PRD section 2). Physiotherapists
 * always treat patients, and the Consultant tick needs Treats patients (decision G5; the database
 * checks both too). People act only in their assigned centres, so every role but those that see
 * all centres needs at least one; for those roles assignments are not kept.
 */
export const staffDetailsSchema = z
  .object({
    name: z.string().trim().min(1, { error: 'Enter their name.' }).max(120),
    role: staffRoleSchema,
    treatsPatients: z.boolean(),
    consultant: z.boolean(),
    centreIds: z.array(z.guid()),
    /** The last day they can sign in, in IST; empty for no end date. */
    accessEndsOn: calendarDateSchema.optional(),
  })
  .transform((details) => ({
    ...details,
    treatsPatients: details.treatsPatients || details.role === 'physiotherapist',
    centreIds: seesAllCentres(details.role) ? [] : [...new Set(details.centreIds)],
  }))
  .superRefine((details, context) => {
    if (details.consultant && !details.treatsPatients) {
      context.addIssue({
        code: 'custom',
        path: ['consultant'],
        message: 'The Consultant tick needs Treats patients too.',
      });
    }
    if (!seesAllCentres(details.role) && details.centreIds.length === 0) {
      context.addIssue({
        code: 'custom',
        path: ['centreIds'],
        message: 'Choose at least one centre.',
      });
    }
  });

export type StaffDetails = z.output<typeof staffDetailsSchema>;

/** Inviting a new staff member: their details and the email they sign in with. */
export const staffInviteSchema = z.object({
  email: z
    .string()
    .trim()
    .toLowerCase()
    .pipe(z.email({ error: 'Enter their email address.' })),
  details: staffDetailsSchema,
});

/** Changing an existing staff member's details. */
export const staffUpdateSchema = z.object({ staffUserId: z.guid(), details: staffDetailsSchema });

/** An action on one staff member: deactivate, reactivate, invite again, link, reset. */
export const staffMemberRefSchema = z.object({ staffUserId: z.guid() });

export const staffActiveSchema = z.object({ staffUserId: z.guid(), active: z.boolean() });
