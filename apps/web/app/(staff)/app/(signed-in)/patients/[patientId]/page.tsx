import { patientRecord, patientsOnPhone } from '@clinic-mx/db';
import {
  accessScope,
  formatIndianPhone,
  formatIstDate,
  istDate,
  patientSexLabels,
} from '@clinic-mx/schemas';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { z } from 'zod';
import { FormMessage } from '../../../../../../components/forms';
import { requirePermission } from '../../../../../../modules/access/require-permission';
import { asStaff } from '../../../../../../modules/access/staff-db';
import { PatientForm } from '../patient-form';

export const metadata: Metadata = { title: 'Patient · Clinic Mx' };

const notices: Record<string, string> = {
  added: 'Patient added.',
  saved: 'Details saved.',
};

// One patient (SCH-01): OP number, registering centre and contact details, and the others on the
// same mobile. Those with patients.edit_contact edit the details; the OP number never changes.
// The full patient record (episodes, notes, documents) grows here in CLN-12.
export default async function PatientPage({
  params,
  searchParams,
}: {
  params: Promise<{ patientId: string }>;
  searchParams: Promise<{ done?: string }>;
}) {
  const staff = await requirePermission('patients.view_contact');
  const { patientId } = await params;
  if (!z.guid().safeParse(patientId).success) notFound();
  const found = await asStaff(staff, async (tx) => {
    const patient = await patientRecord(tx, patientId);
    return patient
      ? { patient, family: await patientsOnPhone(tx, patient.phone, patientId) }
      : null;
  });
  if (!found) notFound();
  const { patient, family } = found;
  const notice = notices[(await searchParams).done ?? ''];
  const canEdit = accessScope(staff, 'patients.edit_contact');

  return (
    <main className="flex w-full max-w-signin flex-col gap-6 px-4 py-6">
      <div className="flex flex-col gap-1.5">
        <Link href="/app/patients" className="text-sm text-ink-muted underline underline-offset-2">
          Patients
        </Link>
        <h1 className="text-title font-semibold">{patient.name}</h1>
        <p className="text-ink-secondary">
          OP number{' '}
          <span className="font-mono text-ink" data-testid="op-number">
            {patient.opNumber}
          </span>
          {patient.registeredCentreName ? `, registered at ${patient.registeredCentreName}` : null}
        </p>
      </div>
      {notice ? <FormMessage tone="info">{notice}</FormMessage> : null}
      {staff.support ? (
        <FormMessage tone="info">Velyx support access is read only.</FormMessage>
      ) : null}

      {canEdit && !staff.support ? (
        <PatientForm
          today={istDate(new Date())}
          patient={{
            patientId: patient.id,
            name: patient.name,
            phone: patient.phone,
            email: patient.email ?? '',
            dateOfBirth: patient.dateOfBirth ?? '',
            sex: patient.sex ?? '',
            occupation: patient.occupation ?? '',
          }}
        />
      ) : (
        <dl className="flex flex-col gap-2 rounded-panel border border-line bg-surface p-4 text-ink-secondary">
          <dt className="font-medium text-ink">Mobile</dt>
          <dd>{formatIndianPhone(patient.phone)}</dd>
          <dt className="font-medium text-ink">Email</dt>
          <dd className="break-all">{patient.email ?? 'Not given'}</dd>
          <dt className="font-medium text-ink">Date of birth</dt>
          <dd>{patient.dateOfBirth ? formatIstDate(patient.dateOfBirth) : 'Not given'}</dd>
          <dt className="font-medium text-ink">Sex</dt>
          <dd>{patient.sex ? patientSexLabels[patient.sex] : 'Not given'}</dd>
          <dt className="font-medium text-ink">Occupation</dt>
          <dd>{patient.occupation ?? 'Not given'}</dd>
        </dl>
      )}

      {family.length > 0 ? (
        <section aria-labelledby="same-mobile" className="flex flex-col gap-2">
          <h2 id="same-mobile" className="font-semibold text-ink">
            Also on this mobile
          </h2>
          <ul className="flex flex-col gap-2" data-testid="same-mobile">
            {family.map((other) => (
              <li key={other.id}>
                <Link
                  href={`/app/patients/${other.id}`}
                  className="flex flex-wrap items-baseline justify-between gap-2 rounded-panel border border-line bg-surface p-4 hover:bg-surface-hover"
                >
                  <span className="font-medium text-ink">{other.name}</span>
                  <span className="font-mono text-sm text-ink-secondary">{other.opNumber}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </main>
  );
}
