import type { Metadata } from 'next';
import Link from 'next/link';
import { FormMessage } from '../../../../../../components/forms';
import { requirePermission } from '../../../../../../modules/access/require-permission';
import { getSetting } from '../../../../../../modules/settings/settings';
import { AppointmentTypeForm } from '../appointment-type-forms';

export const metadata: Metadata = { title: 'Add an appointment type · Clinic Mx' };

// Add an appointment type (SET-03): its name and length.
export default async function NewAppointmentTypePage() {
  const staff = await requirePermission('settings.manage');
  const slotMinutes = await getSetting('scheduling.slot_minutes');
  return (
    <main className="flex w-full max-w-signin flex-col gap-6 px-4 py-6">
      <div className="flex flex-col gap-1">
        <Link
          href="/app/appointment-types"
          className="text-sm text-ink-muted underline underline-offset-2"
        >
          Appointment types
        </Link>
        <h1 className="text-title font-semibold">Add an appointment type</h1>
      </div>
      {staff.support ? (
        <FormMessage tone="info">Velyx support access is read only.</FormMessage>
      ) : (
        <AppointmentTypeForm slotMinutes={slotMinutes} />
      )}
    </main>
  );
}
