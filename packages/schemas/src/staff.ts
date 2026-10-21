import { z } from 'zod';

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
