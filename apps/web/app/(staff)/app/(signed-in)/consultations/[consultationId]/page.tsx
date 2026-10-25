import { accessScope, formatIstDateTime, stepFromQuery } from '@clinic-mx/schemas';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { requireStaff } from '../../../../../../modules/auth/session';
import { consultationRedFlagsOf } from '../../../../../../modules/alerts/services';
import { loadConsultation } from '../../../../../../modules/consultations/services';
import { ConsultationStepper } from './consultation-stepper';

export const metadata: Metadata = { title: 'Consultation · Clinic Mx' };

// The consultation (CLN-02, PRD J3.2, Frontend Specification "Consultation"): a vertical stepper
// of Subjective, Screening, Objective, Assessment, Plan and Sign; one section at a time, with
// Back and Next pinned at the bottom on phones (user decision 24 October 2026). Everything
// autosaves. Its own consultant writes and signs it (CLN-09); once signed it is read only, read by
// clinicians at its centre, who add addenda.
export default async function ConsultationPage({
  params,
  searchParams,
}: {
  params: Promise<{ consultationId: string }>;
  searchParams: Promise<{ section?: string | string[] }>;
}) {
  const staff = await requireStaff();
  if (!accessScope(staff, 'consultant_records.write') && !accessScope(staff, 'clinical.read')) {
    redirect('/app/not-allowed');
  }
  const { consultationId } = await params;
  const consultation = await loadConsultation(staff, consultationId);
  if (!consultation) notFound();
  const redFlags = await consultationRedFlagsOf(staff, consultation.id);
  const { section } = await searchParams;
  return (
    <main className="flex w-full max-w-5xl flex-col gap-4 px-4 pt-6 md:pb-6">
      <div className="flex flex-col gap-1.5">
        <Link
          href="/app/my-patients"
          className="text-sm text-ink-muted underline underline-offset-2"
        >
          My patients today
        </Link>
        <h1 className="text-title font-semibold">Consultation</h1>
        <p className="text-sm text-ink-muted">
          <Link
            href={`/app/patients/${consultation.patientId}`}
            className="font-medium text-ink underline underline-offset-2"
          >
            {consultation.patientName}
          </Link>{' '}
          · {consultation.opNumber} · {formatIstDateTime(consultation.startsAt)} ·{' '}
          {consultation.centreName}
        </p>
      </div>
      <ConsultationStepper
        id={consultation.id}
        serverValue={consultation.sections}
        serverVersion={consultation.version}
        editable={consultation.editable}
        signedBy={
          consultation.signedAt && consultation.signedByName
            ? { name: consultation.signedByName, at: consultation.signedAt }
            : null
        }
        addenda={consultation.addenda}
        addsAddenda={consultation.addsAddenda}
        patientAnswers={consultation.patientAnswers}
        objectiveCatalog={consultation.objectiveCatalog}
        assessmentCatalog={consultation.assessmentCatalog}
        assessmentSettings={consultation.assessmentSettings}
        planCatalog={consultation.planCatalog}
        treatingPhysios={consultation.treatingPhysios}
        planDefaults={consultation.planDefaults}
        redFlags={redFlags}
        initialStep={stepFromQuery(typeof section === 'string' ? section : undefined)}
      />
    </main>
  );
}
