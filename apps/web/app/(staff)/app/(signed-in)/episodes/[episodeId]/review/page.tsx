import { accessScope, formatIstDateTime, takesFinalTest } from '@clinic-mx/schemas';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { NotAllowedError } from '../../../../../../../modules/access/guard';
import { requireStaff } from '../../../../../../../modules/auth/session';
import { loadReview, type ReviewScreen } from '../../../../../../../modules/reviews/services';
import { EpisodeHeading } from '../../../patients/[patientId]/clinical-record';
import { FinalTestForm } from './final-test-form';
import { FinalTestRows } from './final-test-rows';

export const metadata: Metadata = { title: 'Review and discharge · Clinic Mx' };

// The episode's Review and discharge screen (Frontend Specification "Physiotherapist", Consultant
// tick). OUT-07 gives it final testing (PRD J6.2): exactly the baseline's measures, with session
// 4's beside them, retested and signed once by a consultant; readiness and discharge follow.
export default async function ReviewPage({ params }: { params: Promise<{ episodeId: string }> }) {
  const staff = await requireStaff();
  if (!accessScope(staff, 'clinical.read')) redirect('/app/not-allowed');
  const { episodeId } = await params;
  let screen: ReviewScreen | undefined;
  try {
    screen = await loadReview(staff, episodeId);
  } catch (error) {
    if (error instanceof NotAllowedError) redirect('/app/not-allowed');
    throw error;
  }
  if (!screen) notFound();
  const { episode, patient, items, finalTest, signs, sessionNumber } = screen;
  return (
    <main className="flex w-full max-w-3xl flex-col gap-4 px-4 py-6">
      <div className="flex flex-col gap-1.5">
        <Link
          href={`/app/patients/${patient.id}`}
          className="text-sm text-ink-muted underline underline-offset-2"
        >
          {patient.name} · {patient.opNumber}
        </Link>
        <h1 className="text-title font-semibold">Review and discharge</h1>
      </div>
      <div className="rounded-panel border border-line bg-surface p-4">
        <EpisodeHeading episode={episode} />
      </div>
      <section
        aria-labelledby="final-testing"
        className="flex flex-col gap-3 rounded-panel border border-line bg-surface p-4"
        data-testid="final-testing"
      >
        <h2 id="final-testing" className="font-semibold text-ink">
          Final testing
        </h2>
        {finalTest ? (
          <>
            <FinalTestRows rows={finalTest.rows} sessionNumber={sessionNumber} />
            <p className="text-sm text-ink-secondary" data-testid="final-test-signed">
              Signed by {finalTest.by} on {formatIstDateTime(finalTest.at)}.
            </p>
          </>
        ) : items.length === 0 ? (
          <p className="text-ink-muted">
            No baseline was recorded at session 1, so there is nothing to retest.
          </p>
        ) : signs ? (
          <FinalTestForm episodeId={episode.id} items={items} sessionNumber={sessionNumber} />
        ) : (
          <p className="text-ink-muted">
            {takesFinalTest(episode.status)
              ? 'Not tested yet. A consultant retests the baseline measures and signs them.'
              : 'Final testing is done while the episode is Active or Under review.'}
          </p>
        )}
      </section>
    </main>
  );
}
