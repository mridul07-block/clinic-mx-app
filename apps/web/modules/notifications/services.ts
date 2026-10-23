import 'server-only';
import {
  markNotificationsRead,
  myNotifications,
  unreadNotificationCount,
  type NotificationEntry,
} from '@clinic-mx/db';
import { z } from 'zod';
import { assertMay } from '../access/guard';
import { staffService, type ServiceContext } from '../access/service';
import { asStaff } from '../access/staff-db';
import type { StaffMember } from '@clinic-mx/db';

/**
 * In app notifications (INT-10, user decision 23 October 2026): a staff member reads the ones
 * sent to them, newest first, and opening the list marks them read. Row level security keeps
 * every read and write to their own.
 */
export function notificationsOf(actor: StaffMember): Promise<NotificationEntry[]> {
  assertMay(actor, 'notifications.read');
  return asStaff(actor, (tx) => myNotifications(tx));
}

/** How many of the staff member's notifications are unread; none for support logins. */
export function unreadNotifications(actor: StaffMember): Promise<number> {
  if (actor.support) return Promise.resolve(0);
  assertMay(actor, 'notifications.read');
  return asStaff(actor, (tx) => unreadNotificationCount(tx));
}

const markReadService = staffService({
  action: 'notifications.read',
  input: z.object({ ids: z.array(z.guid()).max(100) }),
  run: (tx, { ids }) => markNotificationsRead(tx, ids),
});

/** Marks the notifications just shown read; how many were unread. */
export function markRead(context: ServiceContext, ids: readonly string[]): Promise<number> {
  return markReadService(context, { ids });
}
