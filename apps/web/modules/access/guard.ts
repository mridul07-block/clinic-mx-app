import 'server-only';
import {
  accessScope,
  can,
  type AccessTarget,
  type Action,
  type StaffAccess,
} from '@clinic-mx/schemas';

/** Someone tried an action the permission map does not give them (IAM-04). */
export class NotAllowedError extends Error {
  override name = 'NotAllowedError';
}

/**
 * Refuses unless the permission map gives `staff` the action at all, on any record or only their
 * own (packages/schemas/src/permissions.ts). Pages and the first step of a service use it.
 */
export function assertMay(staff: StaffAccess, action: Action): void {
  if (!accessScope(staff, action)) throw new NotAllowedError(`Not allowed: ${action}`);
}

/**
 * Refuses unless `staff` may take the action on this record: its centre is theirs (or they see
 * every centre), and it is their own where their grant is only for their own records.
 */
export function assertCan(staff: StaffAccess, action: Action, target: AccessTarget): void {
  if (!can(staff, action, target)) throw new NotAllowedError(`Not allowed: ${action}`);
}
