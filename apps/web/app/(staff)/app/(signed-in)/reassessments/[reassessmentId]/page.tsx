import { accessScope, formatIstDateTime } from '@clinic-mx/schemas';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { Tag } from '../../../../../../components/tag';
import { NotAllowedError } from '../../../../../../modules/access/guard';
import { requireStaff } from '../../../../../../modules/auth/session';
import {
  loadReassessment,
  type ReassessmentScreen,
} from '../../../../../../modules/reassessments/services';
import { DecisionForm } from './decision-form';
import { ReassessmentRows } from './reassessment-rows';

export const metadata: Metadata = { title: 'Reassessment · Clinic Mx' };

// The session 4 reassessment review (OUT-05, PRD J5.10; decision 7 default): the episode's
// consultant reads baseline against the session, with the change, and signs a written decision
// once; their task closes with it. Clinicians who read the session note read it here too.
export default async function ReassessmentPage({
  params,
}: {
  params: Promise<{ reassessmentId: string }>;
}) {
  const staff = await requireStaff();
  if (!accessScope(staff, 'clinical.read')) redirect('/app/not-allowed');
  const { reassessmentId } = await params;
  let screen: ReassessmentScreen | undefined;
  try {
    screen = await loadReassessment(staff, reassessmentId);
  } catch (error) {
    if (error instanceof NotAllowedError) redirect('/app/not-allowed');
    throw error;
  }
  if (!screen) notFound();
  const { visit, sessionNumber, rows, decision, signs, consultantName } = screen;
  return (
    <main className="flex w-full max-w-3xl flex-col gap-4 px-4 py-6">
      <div className="flex flex-col gap-1.5">
        <Link href="/app/tasks" className="text-sm text-ink-muted underline underline-offset-2">
          Tasks
        </Link>
        <span className="flex flex-wrap items-center gap-2">
          <h1 className="text-title font-semibold">Session {sessionNumber} reassessment</h1>
          <span data-testid="reassessment-status">
            {decision ? <Tag tone="done">Signed</Tag> : <Tag tone="waiting">Awaiting review</Tag>}
          </span>
        </span>
        <p className="text-sm text-ink-muted">
          <Link
            href={`/app/patients/${visit.patientId}`}
            className="font-medium text-ink underline underline-offset-2"
          >
            {visit.patientName}
          </Link>{' '}
          · {visit.opNumber} · {formatIstDateTime(visit.startsAt)} · {visit.physioName}
        </p>
        <Link
          href={`/app/sessions/${visit.id}`}
          className="self-start text-sm text-accent underline underline-offset-2 pointer-coarse:py-3"
        >
          Open the session note
        </Link>
      </div>
      <section
        aria-labelledby="reassessment-measures"
        className="flex flex-col gap-3 rounded-panel border border-line bg-surface p-4"
      >
        <h2 id="reassessment-measures" className="font-semibold text-ink">
          Baseline and session {sessionNumber}
        </h2>
        <ReassessmentRows rows={rows} sessionNumber={sessionNumber} />
      </section>
      <section
        aria-labelledby="reassessment-decision"
        className="flex flex-col gap-3 rounded-panel border border-line bg-surface p-4"
      >
        <h2 id="reassessment-decision" className="font-semibold text-ink">
          Consultant&apos;s decision
        </h2>
        {decision ? (
          <div className="flex flex-col gap-1" data-testid="reassessment-signed">
            <p className="whitespace-pre-line text-ink">{decision.text}</p>
            <p className="text-sm text-ink-muted">
              Signed by {decision.by} on {formatIstDateTime(decision.at)}.
            </p>
          </div>
        ) : signs ? (
          <DecisionForm reassessmentId={screen.id} />
        ) : (
          <p className="text-ink-muted">Awaiting {consultantName}&apos;s review.</p>
        )}
      </section>
    </main>
  );
}
