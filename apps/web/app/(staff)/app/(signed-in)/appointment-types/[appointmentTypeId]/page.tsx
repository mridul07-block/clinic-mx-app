import { appointmentTypeRecord } from '@clinic-mx/db';
import { formatMinutes } from '@clinic-mx/schemas';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { z } from 'zod';
import { FormMessage } from '../../../../../../components/forms';
import { Tag } from '../../../../../../components/tag';
import { requirePermission } from '../../../../../../modules/access/require-permission';
import { asStaff } from '../../../../../../modules/access/staff-db';
import { getSetting } from '../../../../../../modules/settings/settings';
import { AppointmentTypeActiveForm, AppointmentTypeForm } from '../appointment-type-forms';

export const metadata: Metadata = { title: 'Appointment type · Clinic Mx' };

const notices: Record<string, string> = {
  added: 'Appointment type added.',
  saved: 'Appointment type saved.',
  deactivated: 'Appointment type deactivated. Appointments already booked and its history stay.',
  reactivated: 'Appointment type reactivated.',
};

// One appointment type (SET-03): its name and length, and deactivate or reactivate.
export default async function AppointmentTypePage({
  params,
  searchParams,
}: {
  params: Promise<{ appointmentTypeId: string }>;
  searchParams: Promise<{ done?: string }>;
}) {
  const staff = await requirePermission('settings.manage');
  const { appointmentTypeId } = await params;
  if (!z.guid().safeParse(appointmentTypeId).success) notFound();
  const type = await asStaff(staff, (tx) => appointmentTypeRecord(tx, appointmentTypeId));
  if (!type) notFound();
  const slotMinutes = await getSetting('scheduling.slot_minutes');
  const notice = notices[(await searchParams).done ?? ''];

  return (
    <main className="flex w-full max-w-signin flex-col gap-6 px-4 py-6">
      <div className="flex flex-col gap-1.5">
        <Link
          href="/app/appointment-types"
          className="text-sm text-ink-muted underline underline-offset-2"
        >
          Appointment types
        </Link>
        <h1 className="text-title font-semibold">{type.name}</h1>
        <span className="flex flex-wrap items-center gap-2">
          {type.active ? <Tag tone="active">Active</Tag> : <Tag tone="neutral">Inactive</Tag>}
        </span>
      </div>
      {notice ? <FormMessage tone="info">{notice}</FormMessage> : null}
      {staff.support ? (
        <>
          <FormMessage tone="info">Velyx support access is read only.</FormMessage>
          <dl className="flex flex-col gap-0.5 text-ink-secondary">
            <dt className="font-medium text-ink">Length</dt>
            <dd className="tabular-nums">{formatMinutes(type.minutes)}</dd>
          </dl>
        </>
      ) : (
        <>
          <AppointmentTypeForm
            type={{ appointmentTypeId: type.id, name: type.name, minutes: String(type.minutes) }}
            slotMinutes={slotMinutes}
          />
          <section className="flex flex-col gap-3 border-t border-line pt-4">
            <h2 className="font-semibold text-ink">{type.active ? 'Deactivate' : 'Reactivate'}</h2>
            <AppointmentTypeActiveForm
              appointmentTypeId={type.id}
              name={type.name}
              active={type.active}
            />
          </section>
        </>
      )}
    </main>
  );
}
