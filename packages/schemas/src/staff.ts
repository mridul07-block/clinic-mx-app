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
