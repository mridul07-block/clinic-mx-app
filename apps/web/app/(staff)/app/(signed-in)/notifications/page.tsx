import {
  formatIstDateTime,
  istDate,
  notificationKindLabels,
  redFlagTriageLabels,
} from '@clinic-mx/schemas';
import type { Metadata } from 'next';
import Link from 'next/link';
import { FormMessage } from '../../../../../components/forms';
import { Tag } from '../../../../../components/tag';
import { serviceContext } from '../../../../../modules/access/staff-db';
import { requireStaff } from '../../../../../modules/auth/session';
import { markRead, notificationsOf } from '../../../../../modules/notifications/services';
import { calendarHref } from '../../../../../modules/scheduling/links';

export const metadata: Metadata = { title: 'Notifications · Clinic Mx' };
export const dynamic = 'force-dynamic';

// Notifications (INT-10, user decision 23 October 2026): what was sent to the signed in staff
// member, newest first. A health form submitted, and a red flag raised as an emergency with the
// rules that raised it (awaiting the client's clinical sign-off, where they are). Each opens the
// visit on the calendar. Opening the list marks what it shows read.
export default async function NotificationsPage() {
  const staff = await requireStaff();
  const entries = await notificationsOf(staff);
  const unread = entries.filter((entry) => entry.readAt === null).map((entry) => entry.id);
  if (unread.length > 0 && !staff.support) await markRead(await serviceContext(), unread);

  return (
    <main className="flex w-full max-w-signin flex-col gap-6 px-4 py-6">
      <div className="flex flex-col gap-1.5">
        <Link href="/app" className="text-sm text-ink-muted underline underline-offset-2">
          Home
        </Link>
        <h1 className="text-title font-semibold">Notifications</h1>
      </div>
      {entries.length === 0 ? (
        <FormMessage tone="info">Nothing yet.</FormMessage>
      ) : (
        <ul
          className="flex flex-col divide-y divide-line border-y border-line"
          data-testid="notifications"
        >
          {entries.map((entry) => (
            <li
              key={entry.id}
              className="flex flex-col gap-1.5 py-3"
              data-kind={entry.kind}
              data-unread={entry.readAt === null ? '' : undefined}
            >
              <div className="flex flex-wrap items-center gap-2">
                <Tag tone={entry.kind === 'red_flag_emergency' ? 'danger' : 'info'}>
                  {notificationKindLabels[entry.kind]}
                </Tag>
                {entry.readAt === null ? <Tag tone="outline">New</Tag> : null}
              </div>
              {entry.patientName && entry.startsAt ? (
                <p className="font-medium text-ink">
                  {entry.patientName}, visit {formatIstDateTime(entry.startsAt)}
                </p>
              ) : null}
              {entry.alerts.length > 0 ? (
                <ul className="flex flex-col gap-0.5 text-ink">
                  {entry.alerts.map((alert) => (
                    <li key={alert.name}>
                      {alert.name}: {redFlagTriageLabels[alert.triage]}
                      {alert.signedOff ? null : (
                        <span className="text-ink-secondary"> (awaiting clinical sign-off)</span>
                      )}
                    </li>
                  ))}
                </ul>
              ) : null}
              {entry.kind === 'red_flag_emergency' ? (
                <Link
                  href="/app/alerts"
                  className="self-start text-accent underline underline-offset-2 pointer-coarse:py-3"
                >
                  Open the alerts
                </Link>
              ) : null}
              {entry.kind === 'health_form_submitted' && entry.assistedByName ? (
                <p className="text-sm text-ink-secondary" data-testid="assisted-by">
                  Entered with help by {entry.assistedByName}
                </p>
              ) : null}
              <p className="text-sm text-ink-secondary">{formatIstDateTime(entry.createdAt)}</p>
              {entry.appointmentId && entry.centreId && entry.startsAt ? (
                <Link
                  href={calendarHref({
                    centreId: entry.centreId,
                    date: istDate(entry.startsAt),
                    appointmentId: entry.appointmentId,
                  })}
                  className="self-start text-accent underline underline-offset-2 pointer-coarse:py-3"
                >
                  Open the visit
                </Link>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
