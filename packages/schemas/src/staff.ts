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
