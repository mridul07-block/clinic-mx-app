import { centreList } from '@clinic-mx/db';
import { istDate } from '@clinic-mx/schemas';
import type { Metadata } from 'next';
import Link from 'next/link';
import { FormMessage } from '../../../../../../components/forms';
import { requirePermission } from '../../../../../../modules/access/require-permission';
import { asStaff } from '../../../../../../modules/access/staff-db';
import { PatientForm } from '../patient-form';

export const metadata: Metadata = { title: 'Add patient · Clinic Mx' };

// Add a patient (SCH-01): a name and a mobile, at an active centre the person sees, which issues
// the OP number.
export default async function NewPatientPage() {
  const staff = await requirePermission('patients.edit_contact');
  const centres = (await asStaff(staff, (tx) => centreList(tx)))
    .filter((centre) => centre.active)
    .map(({ id, name }) => ({ id, name }));
  return (
    <main className="flex w-full max-w-signin flex-col gap-6 px-4 py-6">
      <div className="flex flex-col gap-1">
        <Link href="/app/patients" className="text-sm text-ink-muted underline underline-offset-2">
          Patients
        </Link>
        <h1 className="text-title font-semibold">Add patient</h1>
      </div>
      {staff.support ? (
        <FormMessage tone="info">Velyx support access is read only.</FormMessage>
      ) : centres.length === 0 ? (
        <FormMessage tone="info">
          You are not assigned to an active centre, so you cannot register patients.
        </FormMessage>
      ) : (
        <PatientForm centres={centres} today={istDate(new Date())} />
      )}
    </main>
  );
}
