import { accessScope, formatIstDateTime, phaseNotSetUp } from '@clinic-mx/schemas';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { Tag } from '../../../../../../components/tag';
import { NotAllowedError } from '../../../../../../modules/access/guard';
import { requireStaff } from '../../../../../../modules/auth/session';
import { nextSessionPanel } from '../../../../../../modules/scheduling/next-session';
import { loadSession, type SessionScreen } from '../../../../../../modules/sessions/services';
import { Addenda } from '../../consultations/[consultationId]/addenda';
import { SummaryCard } from '../../patients/[patientId]/clinical-record';
import { NextSessionPanel } from './next-session';
import { SessionNoteForm } from './session-note';

export const metadata: Metadata = { title: 'Session · Clinic Mx' };

// The session screen (SES-02, PRD J5.2): Start session opens it, and Open session on My patients
// while it runs. The treating physio's summary card of the episode comes first, from the signed
// plan with no AI sheet; the session note (SES-03) goes under it, written and closed by the
// appointment's physio. Only the appointment's physio opens it; the Super Admin reads it (user
// decision 25 October 2026). With cover (SES-08) the note is whoever started it; the booked physio
// and colleagues at the centre read it.
export default async function SessionPage({
  params,
}: {
  params: Promise<{ appointmentId: string }>;
}) {
  const staff = await requireStaff();
  if (!accessScope(staff, 'clinical.read')) redirect('/app/not-allowed');
  const { appointmentId } = await params;
  let screen: SessionScreen | undefined;
  try {
    screen = await loadSession(staff, appointmentId);
  } catch (error) {
    if (error instanceof NotAllowedError) redirect('/app/not-allowed');
    throw error;
  }
  if (!screen) notFound();
  // SCH-12: the note's writer books the patient's next session here; readers never see it.
  const nextSession = screen.readOnly ? undefined : await nextSessionPanel(staff, appointmentId);
  const { visit, session, summary, nextVisit, readOnly, writerName, coveredBy, note } = screen;
  return (
    <main className="flex w-full max-w-5xl flex-col gap-4 px-4 py-6">
      <div className="flex flex-col gap-1.5">
        <Link
          href="/app/my-patients"
          className="text-sm text-ink-muted underline underline-offset-2"
        >
          My patients today
        </Link>
        <span className="flex flex-wrap items-center gap-2">
          <h1 className="text-title font-semibold">{visit.typeName}</h1>
          {session.label ? (
            <span data-testid="session-label">
              <Tag tone="outline">{session.label}</Tag>
            </span>
          ) : null}
          {coveredBy ? (
            <span data-testid="session-covered">
              <Tag tone="info">Covered by {coveredBy}</Tag>
            </span>
          ) : null}
        </span>
        <p className="text-sm text-ink-muted">
          <Link
            href={`/app/patients/${visit.patientId}`}
            className="font-medium text-ink underline underline-offset-2"
          >
            {visit.patientName}
          </Link>{' '}
          · {visit.opNumber} · {formatIstDateTime(visit.startsAt)} · {visit.centreName}
        </p>
        {readOnly ? (
          <p data-testid="session-read-only" className="text-sm text-ink-muted">
            Read only: this is {writerName}&apos;s session.
          </p>
        ) : null}
      </div>
      <SummaryCard
        patientId={visit.patientId}
        summary={summary}
        nextVisit={nextVisit}
        // DECISION SES-02: the phase stepper (OUT-04) replaces this line.
        phase={phaseNotSetUp}
        empty="Not part of an episode yet."
      />
      {note ? (
        <SessionNoteForm
          appointmentId={visit.id}
          serverValue={note.value}
          serverVersion={note.version}
          editable={note.editable}
          signed={note.signed}
          plan={note.plan}
          lastTime={note.lastTime}
          modalityDefinitions={note.modalities}
          baseline={note.baseline}
          reassessment={note.reassessment}
        />
      ) : null}
      {note?.signed ? (
        <div className="rounded-panel border border-line bg-surface p-4">
          <Addenda
            target={{ sessionId: note.id }}
            addenda={note.addenda}
            adds={note.addsAddenda}
            patientId={visit.patientId}
          />
        </div>
      ) : null}
      {nextSession ? (
        <NextSessionPanel
          appointmentId={nextSession.appointmentId}
          toBook={nextSession.toBook}
          defaultDate={nextSession.defaultDate}
          today={nextSession.today}
        />
      ) : null}
    </main>
  );
}
