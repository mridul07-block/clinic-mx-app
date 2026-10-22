import { centreOptions, leaveFor, rosterVersions, staffRecord, versionsOn } from '@clinic-mx/db';
import {
  formatBlocks,
  formatIstDate,
  istDate,
  seesAllCentres,
  staffRoleLabels,
  weekdayNames,
  type Weekly,
} from '@clinic-mx/schemas';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { z } from 'zod';
import { FormMessage } from '../../../../../../components/forms';
import { requirePermission } from '../../../../../../modules/access/require-permission';
import { asStaff } from '../../../../../../modules/access/staff-db';
import { getSetting } from '../../../../../../modules/settings/settings';
import { LeaveForm } from '../../leave/leave-forms';
import { LeaveList } from '../../leave/leave-list';
import { RosterForm } from '../roster-form';

export const metadata: Metadata = { title: 'Team member · Clinic Mx' };

const notices: Record<string, string> = {
  hours: 'Working hours saved.',
  leave: 'Leave recorded.',
  cancelled: 'Leave cancelled.',
};

function Week({ weekly }: { weekly: Weekly }) {
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
      {weekdayNames.map((day, i) => (
        <div key={day} className="contents">
          <dt className="text-ink-secondary">{day}</dt>
          <dd className="text-ink tabular-nums">{formatBlocks(weekly[i] ?? [])}</dd>
        </div>
      ))}
    </dl>
  );
}

// One person's working hours per centre and their leave (SET-04). A manager changes their hours
// from a date and records or cancels their leave; never their own leave.
export default async function TeamMemberPage({
  params,
  searchParams,
}: {
  params: Promise<{ staffUserId: string }>;
  searchParams: Promise<{ done?: string }>;
}) {
  const staff = await requirePermission('rosters.manage');
  const { staffUserId } = await params;
  if (!z.guid().safeParse(staffUserId).success) notFound();
  const [member, versions, leave, centres] = await asStaff(staff, (tx) =>
    Promise.all([
      staffRecord(tx, staffUserId),
      rosterVersions(tx, staffUserId),
      leaveFor(tx, staffUserId),
      centreOptions(tx),
    ]),
  );
  if (!member?.treatsPatients || !member.active) notFound();
  const slotMinutes = await getSetting('scheduling.slot_minutes');
  const today = istDate(new Date());
  const current = versionsOn(versions, today);
  const later = versions.filter((v) => v.effectiveFrom > today);
  // The centres they work at that this manager sees.
  const editable = centres.filter(
    (c) =>
      c.active &&
      member.centreIds.includes(c.id) &&
      (seesAllCentres(staff.role) || staff.centreIds.includes(c.id)),
  );
  const self = member.id === staff.id;
  const notice = notices[(await searchParams).done ?? ''];

  return (
    <main className="flex w-full max-w-signin flex-col gap-6 px-4 py-6">
      <div className="flex flex-col gap-1.5">
        <Link href="/app/team" className="text-sm text-ink-muted underline underline-offset-2">
          Team
        </Link>
        <h1 className="text-title font-semibold">{member.name}</h1>
        <p className="text-ink-secondary">{staffRoleLabels[member.role]}</p>
      </div>
      {notice ? <FormMessage tone="info">{notice}</FormMessage> : null}
      {staff.support ? (
        <FormMessage tone="info">Velyx support access is read only.</FormMessage>
      ) : null}

      <section className="flex flex-col gap-3">
        <h2 className="font-semibold text-ink">Working hours</h2>
        {current.length === 0 && later.length === 0 ? (
          <p className="text-ink-secondary">No working hours yet.</p>
        ) : null}
        {current.map((version) => (
          <div
            key={version.id}
            data-testid="roster"
            className="flex flex-col gap-2 rounded-panel border border-line bg-surface p-4"
          >
            <span className="font-semibold text-ink">
              {version.centreName}
              <span className="font-normal text-ink-muted">
                {' '}
                · since {formatIstDate(version.effectiveFrom)}
              </span>
            </span>
            <Week weekly={version.weekly} />
          </div>
        ))}
        {later.map((version) => (
          <div
            key={version.id}
            data-testid="roster"
            className="flex flex-col gap-2 rounded-panel border border-line bg-surface p-4"
          >
            <span className="font-semibold text-ink">
              {version.centreName}
              <span className="font-normal text-ink-muted">
                {' '}
                · from {formatIstDate(version.effectiveFrom)}
              </span>
            </span>
            <Week weekly={version.weekly} />
          </div>
        ))}
      </section>

      {staff.support ? null : (
        <section className="flex flex-col gap-3 border-t border-line pt-4">
          <h2 className="font-semibold text-ink">Change hours</h2>
          {editable.length === 0 ? (
            <p className="text-ink-secondary">
              They work at no centre you manage. Add a centre on their staff page first.
            </p>
          ) : (
            <RosterForm
              staffUserId={member.id}
              today={today}
              slotMinutes={slotMinutes}
              centres={editable.map((c) => ({
                id: c.id,
                name: c.name,
                current: current.find((v) => v.centreId === c.id)?.weekly,
              }))}
            />
          )}
        </section>
      )}

      <section className="flex flex-col gap-3 border-t border-line pt-4">
        <h2 className="font-semibold text-ink">Leave</h2>
        <LeaveList
          leave={leave}
          cancellable={(entry) =>
            !staff.support && !self && (entry.status === 'requested' || entry.status === 'approved')
          }
          back={`/app/team/${member.id}`}
        />
        {staff.support || self ? null : (
          <>
            <h3 className="font-semibold text-ink">Record leave</h3>
            <p className="text-ink-secondary">Recorded leave is approved at once.</p>
            <LeaveForm staffUserId={member.id} today={today} slotMinutes={slotMinutes} />
          </>
        )}
      </section>
    </main>
  );
}
