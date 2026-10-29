import { patientRecord } from '@clinic-mx/db';
import { istDate } from '@clinic-mx/schemas';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { z } from 'zod';
import { requirePermission } from '../../../../../../modules/access/require-permission';
import { asStaff } from '../../../../../../modules/access/staff-db';
import { getSetting } from '../../../../../../modules/settings/settings';
import { RecordDataRequestForm } from '../data-request-forms';

export const metadata: Metadata = { title: 'New data request · Clinic Mx' };

// Recording a patient's data request (ADM-03), from their record.
export default async function NewDataRequestPage({
  searchParams,
}: {
  searchParams: Promise<{ patient?: string }>;
}) {
  const staff = await requirePermission('data_requests.manage');
  const { patient: raw } = await searchParams;
  const patientId = z.uuid().safeParse(raw);
  if (!patientId.success) notFound();
  const patient = await asStaff(staff, (tx) => patientRecord(tx, patientId.data));
  if (!patient) notFound();
  const days = await getSetting('privacy.request_response_days');

  return (
    <main className="flex w-full max-w-signin flex-col gap-6 px-4 py-6">
      <div className="flex flex-col gap-1.5">
        <Link
          href={['/app/patients', patient.id].join('/')}
          className="text-sm text-ink-muted underline underline-offset-2"
        >
          {patient.name}
        </Link>
        <h1 className="text-title font-semibold">New data request</h1>
        <p className="text-ink-secondary">
          For {patient.name}, OP number <span className="font-mono">{patient.opNumber}</span>. It is
          due {days} days after it was received.
        </p>
      </div>
      <RecordDataRequestForm patientId={patient.id} today={istDate(new Date())} />
    </main>
  );
}
