import { accessScope, patientContentPartLabels, patientContentParts } from '@clinic-mx/schemas';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { z } from 'zod';
import { requireStaff } from '../../../../../../../modules/auth/session';
import { loadExplanation } from '../../../../../../../modules/consultations/explain';

export const metadata: Metadata = { title: 'Explain to patient · Clinic Mx' };
export const dynamic = 'force-dynamic';

// "Explain to patient" (CLN-08, PRD J3.8): the approved patient content for the condition chosen
// in the consultation, in large type to show the patient on the clinician's screen. Only approved
// content (AI-07), never a draft; without it, the page says why.
export default async function ExplainPage({
  params,
}: {
  params: Promise<{ consultationId: string }>;
}) {
  const staff = await requireStaff();
  if (!accessScope(staff, 'consultant_records.write') && !accessScope(staff, 'clinical.read')) {
    redirect('/app/not-allowed');
  }
  const { consultationId } = await params;
  if (!z.guid().safeParse(consultationId).success) notFound();
  const view = await loadExplanation(staff, consultationId);
  if (!view) notFound();
  const back = `/app/consultations/${view.consultationId}`;
  return (
    <main className="flex w-full max-w-3xl flex-col gap-6 px-4 py-6">
      <Link href={back} className="text-sm text-ink-muted underline underline-offset-2">
        Back to the consultation
      </Link>
      {view.condition ? (
        <h1 className="text-display font-semibold text-ink" data-testid="explain-condition">
          {view.condition.name}
        </h1>
      ) : (
        <h1 className="text-title font-semibold">Explain to patient</h1>
      )}
      {!view.condition ? (
        <p className="text-lg text-ink-secondary" data-testid="explain-none">
          Choose the diagnosis in the Assessment step first.
        </p>
      ) : view.content ? (
        <div className="flex flex-col gap-6" data-testid="explain-content">
          {patientContentParts.map((part) => (
            <section
              key={part}
              aria-labelledby={['explain', part].join('-')}
              className="flex flex-col gap-2"
            >
              <h2 id={['explain', part].join('-')} className="text-xl font-semibold text-ink">
                {patientContentPartLabels[part]}
              </h2>
              <p className="whitespace-pre-line text-xl leading-relaxed text-ink">
                {view.content?.[part]}
              </p>
            </section>
          ))}
        </div>
      ) : (
        <div className="flex flex-col gap-2" data-testid="explain-none">
          <p className="text-lg text-ink-secondary">
            No approved explanation for this condition yet. Patients see one only once a consultant
            who treats patients approves it.
          </p>
          {view.writes ? (
            <Link
              href={`/app/knowledge-base/patient-content/${view.condition.id}`}
              className="inline-flex min-h-11 items-center self-start font-medium text-ink underline underline-offset-2"
            >
              Write it in the knowledge base
            </Link>
          ) : null}
        </div>
      )}
    </main>
  );
}
