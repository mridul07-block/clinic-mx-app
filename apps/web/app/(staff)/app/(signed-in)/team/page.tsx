import { pendingLeave, rosterVersions, teamMembers, versionsFrom } from '@clinic-mx/db';
import { formatLeave, istDate, staffRoleLabels } from '@clinic-mx/schemas';
import type { Metadata } from 'next';
import Link from 'next/link';
import { FormMessage } from '../../../../../components/forms';
import { requirePermission } from '../../../../../modules/access/require-permission';
import { asStaff } from '../../../../../modules/access/staff-db';
import { DecideLeaveForm } from '../leave/leave-forms';

export const metadata: Metadata = { title: 'Team · Clinic Mx' };

const notices: Record<string, string> = {
  approved: 'Leave approved.',
  declined: 'Leave declined. They see your reason on My leave.',
};

// Team (SET-04, Frontend Specification "Team: rosters and leave"): leave waiting for a decision,
// and the people who treat patients in the manager's centres with where they work. Centre
// Managers and the Super Admin (rosters.manage); read under row level security.
export default async function TeamPage({
  searchParams,
}: {
  searchParams: Promise<{ done?: string }>;
}) {
  const staff = await requirePermission('rosters.manage');
  const today = istDate(new Date());
  const { waiting, people } = await asStaff(staff, async (tx) => {
    const members = await teamMembers(tx);
    return {
      waiting: (await pendingLeave(tx)).filter((leave) => leave.staffUserId !== staff.id),
      people: await Promise.all(
        members.map(async (member) => ({
          ...member,
          centres: [
            ...new Set(
              versionsFrom(await rosterVersions(tx, member.id), today)
                .filter((version) => version.weekly.some((day) => day.length > 0))
                .map((version) => version.centreName),
            ),
          ],
        })),
      ),
    };
  });
  const notice = notices[(await searchParams).done ?? ''];

  return (
    <main className="flex w-full max-w-signin flex-col gap-6 px-4 py-6">
      <div className="flex flex-col gap-1.5">
        <Link href="/app" className="text-sm text-ink-muted underline underline-offset-2">
          Home
        </Link>
        <h1 className="text-title font-semibold">Team</h1>
        <p className="text-ink-secondary">
          Working hours and leave for the people who treat patients. Patients are booked only in
          their hours, never on approved leave.
        </p>
      </div>
      {notice ? <FormMessage tone="info">{notice}</FormMessage> : null}
      {staff.support ? (
        <FormMessage tone="info">Velyx support access is read only.</FormMessage>
      ) : null}

      <section className="flex flex-col gap-3">
        <h2 className="font-semibold text-ink">Leave requests</h2>
        {waiting.length === 0 ? (
          <p className="text-ink-secondary">No leave is waiting for a decision.</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {waiting.map((leave) => (
              <li
                key={leave.id}
                data-testid="leave-request"
                className="flex flex-col gap-2 rounded-panel border border-line bg-surface p-4"
              >
                <span className="font-semibold text-ink">{leave.staffName}</span>
                <span className="text-ink-secondary tabular-nums">
                  {formatLeave(leave.startsAt, leave.endsAt, leave.allDay)}
                </span>
                {leave.note ? (
                  <span className="text-sm text-ink-secondary">{leave.note}</span>
                ) : null}
                {staff.support ? null : <DecideLeaveForm leaveId={leave.id} />}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-3 border-t border-line pt-4">
        <h2 className="font-semibold text-ink">People</h2>
        <ul className="flex flex-col gap-3">
          {people.map((person) => (
            <li key={person.id} data-testid="team-member">
              <Link
                href={`/app/team/${person.id}`}
                className="flex flex-col gap-1 rounded-panel border border-line bg-surface p-4 hover:bg-surface-hover"
              >
                <span className="font-semibold text-ink">{person.name}</span>
                <span className="text-sm text-ink-secondary">
                  {staffRoleLabels[person.role]} ·{' '}
                  {person.centres.length > 0
                    ? `Hours at ${person.centres.join(', ')}`
                    : 'No working hours yet'}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
