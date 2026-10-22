import { appointmentTypeList } from '@clinic-mx/db';
import { formatMinutes } from '@clinic-mx/schemas';
import type { Metadata } from 'next';
import Link from 'next/link';
import { FormMessage, secondaryButtonClass } from '../../../../../components/forms';
import { Tag } from '../../../../../components/tag';
import { requirePermission } from '../../../../../modules/access/require-permission';
import { asStaff } from '../../../../../modules/access/staff-db';

export const metadata: Metadata = { title: 'Appointment types · Clinic Mx' };

const ownLengths = (count: number) =>
  count === 0
    ? 'Every physio uses this length'
    : count === 1
      ? '1 physio has their own length'
      : `${String(count)} physios have their own length`;

// Appointment types (SET-03, PRD M2): what can be booked and how long it takes. The Super Admin
// keeps them (settings.manage); a physio's own lengths are set on their staff page. Read under
// row level security; a support login sees the page read only.
export default async function AppointmentTypesPage() {
  const staff = await requirePermission('settings.manage');
  const types = await asStaff(staff, (tx) => appointmentTypeList(tx));

  return (
    <main className="flex w-full max-w-signin flex-col gap-6 px-4 py-6">
      <div className="flex flex-col gap-1.5">
        <Link href="/app" className="text-sm text-ink-muted underline underline-offset-2">
          Home
        </Link>
        <h1 className="text-title font-semibold">Appointment types</h1>
        <p className="text-ink-secondary">
          How long each kind of appointment takes. The calendar books with these lengths, or with a
          physio’s own length where one is set.
        </p>
      </div>
      {staff.support ? (
        <FormMessage tone="info">Velyx support access is read only.</FormMessage>
      ) : (
        <Link href="/app/appointment-types/new" className={secondaryButtonClass}>
          Add an appointment type
        </Link>
      )}
      <ul className="flex flex-col gap-3">
        {types.map((type) => (
          <li key={type.id} data-testid="appointment-type">
            <Link
              href={`/app/appointment-types/${type.id}`}
              className="flex flex-col gap-1 rounded-panel border border-line bg-surface p-4 hover:bg-surface-hover"
            >
              <span className="flex flex-wrap items-center justify-between gap-2">
                <span className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold text-ink">{type.name}</span>
                  {type.active ? null : <Tag tone="neutral">Inactive</Tag>}
                </span>
                <span className="font-semibold text-ink tabular-nums">
                  {formatMinutes(type.minutes)}
                </span>
              </span>
              <span className="text-sm text-ink-secondary">{ownLengths(type.physioLengths)}</span>
            </Link>
          </li>
        ))}
      </ul>
    </main>
  );
}
