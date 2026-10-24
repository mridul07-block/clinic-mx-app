import { episodesOf, guardiansOf, patientRecord, patientsOnPhone } from '@clinic-mx/db';
import {
  accessScope,
  ageOn,
  can,
  formatIndianPhone,
  formatIstDate,
  guardianRelationshipLabels,
  istDate,
  needsGuardian,
  patientRecordTab,
  patientRecordTabLabels,
  patientRecordTabs,
  patientSexLabels,
  worksAtCentre,
} from '@clinic-mx/schemas';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { z } from 'zod';
import { FormMessage } from '../../../../../../components/forms';
import { RecordTabs } from '../../../../../../components/record-tabs';
import { Tag } from '../../../../../../components/tag';
import { requirePermission } from '../../../../../../modules/access/require-permission';
import { reportsOfPatient } from '../../../../../../modules/reports/services';
import { asStaff } from '../../../../../../modules/access/staff-db';
import { clinicalRecordOf } from '../../../../../../modules/patients/record';
import { selfBookingStatus } from '../../../../../../modules/scheduling/services';
import { getSetting } from '../../../../../../modules/settings/settings';
import { GuardianForm, RemoveGuardianForm } from '../guardian-forms';
import { LiftBlockForm } from '../lift-block-form';
import { PatientForm } from '../patient-form';
import { AlertsTab, EpisodeHeading, NotesTab, SummaryCard } from './clinical-record';
import { ReportList } from './report-list';

export const metadata: Metadata = { title: 'Patient · Clinic Mx' };

const notices: Record<string, string> = {
  added: 'Patient added.',
  saved: 'Details saved.',
  'guardian-added': 'Guardian added.',
  'guardian-saved': 'Guardian saved.',
  'guardian-removed': 'Guardian removed. They stay on record for any consent they signed.',
  'self-booking': 'The patient can book themselves again.',
};

// One patient (SCH-01): OP number, registering centre and contact details, and the others on the
// same mobile. Those with patients.edit_contact edit the details; the OP number never changes.
// Guardians (SCH-02): a patient under the adult age is marked, and "Guardian needed" until one is
// added. Self booking (SCH-09): for those who book, whether the patient may still book themselves,
// and for a manager, lifting the block. Reports (ALT-08): clinicians only open the photos and
// scans added at check in or on the health form. The patient record (CLN-12): for clinicians
// (`clinical.read`), tabs Overview (the summary card first), Notes (episodes with their signed
// notes and addenda), Documents and Alerts, read at any centre and logged as a record view;
// everyone else sees Overview only.
export default async function PatientPage({
  params,
  searchParams,
}: {
  params: Promise<{ patientId: string }>;
  searchParams: Promise<{ done?: string; tab?: string }>;
}) {
  const staff = await requirePermission('patients.view_contact');
  const { patientId } = await params;
  if (!z.guid().safeParse(patientId).success) notFound();
  // Settings are read before the transaction opens (docs/runbooks/settings.md).
  const adultAge = await getSetting('patients.adult_age_years');
  const found = await asStaff(staff, async (tx) => {
    const patient = await patientRecord(tx, patientId);
    if (!patient) return null;
    return {
      patient,
      family: await patientsOnPhone(tx, patient.phone, patientId),
      guardians: await guardiansOf(tx, patientId),
      episodes: await episodesOf(tx, patientId),
    };
  });
  if (!found) notFound();
  const { patient, family, guardians, episodes } = found;
  const age = patient.dateOfBirth ? ageOn(patient.dateOfBirth, istDate(new Date())) : null;
  const minor = needsGuardian(age, adultAge);
  const showGuardians = minor || age === null || guardians.length > 0;
  const query = await searchParams;
  const notice = notices[query.done ?? ''];
  const clinical = can(staff, 'clinical.read');
  const tab = patientRecordTab(query.tab, clinical);
  const record = await clinicalRecordOf(staff, patient.id);
  const canEdit = accessScope(staff, 'patients.edit_contact') && !staff.support;
  const selfBooking = can(staff, 'bookings.manage')
    ? await selfBookingStatus(staff, patient.id)
    : undefined;
  const canLift = can(staff, 'bookings.lift_self_booking_block') && !staff.support;
  const reports = tab === 'documents' ? await reportsOfPatient(staff, patient.id) : [];
  const openAlerts = record?.alerts.filter((alert) => alert.status !== 'closed').length ?? 0;
  const actsOnAlerts = can(staff, 'red_flags.act') && !staff.support;

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
        {minor ? (
          <span className="flex flex-wrap gap-2" data-testid="guardian-tags">
            <Tag tone="neutral">Under {adultAge}</Tag>
            {guardians.length === 0 ? <Tag tone="waiting">Guardian needed</Tag> : null}
          </span>
        ) : null}
      </div>
      {notice ? <FormMessage tone="info">{notice}</FormMessage> : null}
      {staff.support ? (
        <FormMessage tone="info">Velyx support access is read only.</FormMessage>
      ) : null}

      {record ? (
        <RecordTabs
          label="Patient record"
          current={tab}
          tabs={patientRecordTabs.map((key) => ({
            key,
            label: patientRecordTabLabels[key],
            href:
              key === 'overview'
                ? `/app/patients/${patient.id}`
                : `/app/patients/${patient.id}?tab=${key}`,
            count: key === 'alerts' ? openAlerts : undefined,
          }))}
        />
      ) : null}

      {tab === 'overview' ? (
        <>
          {record ? (
            <SummaryCard
              patientId={patient.id}
              summary={record.summary}
              nextVisit={record.nextVisit}
            />
          ) : null}

          {canEdit ? (
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

          {record ? null : (
            <section aria-labelledby="episodes" className="flex flex-col gap-3">
              <h2 id="episodes" className="font-semibold text-ink">
                Episodes
              </h2>
              {episodes.length === 0 ? (
                <p className="text-ink-muted">No episodes yet. Booking a consultation opens one.</p>
              ) : (
                <ul className="flex flex-col gap-2">
                  {episodes.map((episode) => (
                    <li
                      key={episode.id}
                      data-testid="episode"
                      className="rounded-panel border border-line bg-surface p-4"
                    >
                      <EpisodeHeading episode={episode} />
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}

          {selfBooking ? (
            <section aria-labelledby="self-booking" className="flex flex-col gap-3">
              <h2 id="self-booking" className="font-semibold text-ink">
                Self booking
              </h2>
              {selfBooking.blocked ? (
                <div
                  data-testid="self-booking-blocked"
                  className="flex flex-col gap-1 rounded-panel border border-waiting-line bg-waiting-soft p-4"
                >
                  <span className="font-semibold text-ink">
                    Self booking blocked:{' '}
                    {selfBooking.because === 'reschedules'
                      ? `${String(selfBooking.reschedules)} reschedules asked by the patient.`
                      : `${String(selfBooking.noShows)} no shows.`}
                  </span>
                  <span className="text-ink-secondary">
                    They are asked to call; book them at the front desk.
                  </span>
                </div>
              ) : (
                <p className="text-ink-secondary" data-testid="self-booking-allowed">
                  Can book on WhatsApp.
                </p>
              )}
              <p className="text-sm text-ink-secondary tabular-nums" data-testid="booking-counts">
                Reschedules asked by the patient {selfBooking.reschedules} of{' '}
                {selfBooking.limits.reschedules} · No shows {selfBooking.noShows} of{' '}
                {selfBooking.limits.noShows}
              </p>
              {selfBooking.liftedAt ? (
                <p className="text-sm text-ink-muted">
                  Last allowed again
                  {selfBooking.liftedByName ? ` by ${selfBooking.liftedByName}` : ''},{' '}
                  {formatIstDate(istDate(selfBooking.liftedAt))}
                </p>
              ) : null}
              {canLift && (selfBooking.reschedules > 0 || selfBooking.noShows > 0) ? (
                <LiftBlockForm patientId={patient.id} />
              ) : null}
            </section>
          ) : null}

          {showGuardians ? (
            <section aria-labelledby="guardians" className="flex flex-col gap-3">
              <h2 id="guardians" className="font-semibold text-ink">
                Guardians
              </h2>
              <p className="text-sm text-ink-secondary">
                {minor
                  ? `Patients under ${adultAge} need a guardian, who signs the consent and attends.`
                  : `Needed for patients under ${adultAge}. Add one if the patient is a child.`}
              </p>
              {guardians.length === 0 ? (
                <p className="text-ink-muted">No guardian yet.</p>
              ) : (
                <ul className="flex flex-col gap-2">
                  {guardians.map((guardian) => (
                    <li
                      key={guardian.id}
                      data-testid="guardian"
                      className="flex flex-col gap-2 rounded-panel border border-line bg-surface p-4"
                    >
                      <span className="flex flex-wrap items-baseline justify-between gap-2">
                        <span className="font-medium text-ink">{guardian.name}</span>
                        <span className="text-sm text-ink-secondary">
                          {guardianRelationshipLabels[guardian.relationship]}
                        </span>
                      </span>
                      <span className="text-sm text-ink-secondary">
                        {formatIndianPhone(guardian.phone)}
                      </span>
                      {canEdit ? (
                        <details>
                          <summary className="cursor-pointer text-accent underline underline-offset-2 pointer-coarse:py-3">
                            Edit or remove {guardian.name}
                          </summary>
                          <div className="mt-3 flex flex-col gap-3">
                            <GuardianForm patientId={patient.id} guardian={guardian} />
                            <RemoveGuardianForm
                              patientId={patient.id}
                              guardianId={guardian.id}
                              name={guardian.name}
                            />
                          </div>
                        </details>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
              {canEdit ? (
                <details open={guardians.length === 0 && minor ? true : undefined}>
                  <summary className="cursor-pointer font-medium text-accent pointer-coarse:py-3">
                    {guardians.length === 0 ? 'Add guardian' : 'Add another guardian'}
                  </summary>
                  <div className="mt-3">
                    <GuardianForm patientId={patient.id} defaultPhone={patient.phone} />
                  </div>
                </details>
              ) : null}
            </section>
          ) : null}

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
        </>
      ) : null}

      {record && tab === 'notes' ? (
        <NotesTab patientId={patient.id} episodes={episodes} notes={record.notes} />
      ) : null}

      {tab === 'documents' ? (
        <section aria-labelledby="reports" className="flex flex-col gap-3">
          <h2 id="reports" className="font-semibold text-ink">
            Reports
          </h2>
          <ReportList reports={reports} />
          <p className="text-sm text-ink-muted">
            Consultation summaries and letters appear here once they are generated.
          </p>
        </section>
      ) : null}

      {record && tab === 'alerts' ? (
        <AlertsTab
          alerts={record.alerts}
          opensAlerts={(alert) => actsOnAlerts && worksAtCentre(staff, alert.centreId)}
        />
      ) : null}
    </main>
  );
}
