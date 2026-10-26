import { appointmentStatusLabels, startLabel } from '@clinic-mx/schemas';
import Link from 'next/link';
import { secondaryButtonClass } from '../../../../../components/forms';
import { Tag } from '../../../../../components/tag';
import type { ColleagueRow } from '../../../../../modules/my-patients/services';
import { timeOf } from '../calendar/calendar-block';
import { StartButton } from './start-button';

/** Who covered a colleague's visit, when someone else started it. */
function coveredBy(visit: ColleagueRow): string | null {
  return visit.startedBy && visit.startedBy !== visit.physioId ? visit.startedByName : null;
}

/**
 * Colleagues today (SES-08, user decisions 26 October 2026): the other physios' visits today at
 * the centres the physio works at, by centre and time. A colleague's checked in session whose gate
 * is met can be started here to cover it; the note is then the covering physio's own.
 * Consultations are not covered.
 */
export function ColleaguesToday({ colleagues }: { colleagues: ColleagueRow[] }) {
  const centres = [...new Set(colleagues.map((visit) => visit.centreName))];
  return (
    <section aria-labelledby="colleagues-today" className="flex flex-col gap-3">
      <h2 id="colleagues-today" className="text-lg font-semibold">
        Colleagues today
      </h2>
      {centres.length === 0 ? (
        <p className="rounded-panel border border-line bg-surface px-4 py-6 text-ink-muted">
          No colleague visits today at your centres.
        </p>
      ) : (
        centres.map((centreName) => (
          <div key={centreName} className="flex flex-col gap-2">
            <h3 className="text-sm font-medium text-ink-secondary">{centreName}</h3>
            <ol className="divide-y divide-line overflow-hidden rounded-panel border border-line bg-surface">
              {colleagues
                .filter((visit) => visit.centreName === centreName)
                .map((visit) => (
                  <li
                    key={visit.id}
                    data-testid="colleague-visit"
                    data-appointment={visit.id}
                    className="flex flex-col gap-3 px-4 py-4 md:grid md:grid-cols-[4.5rem_minmax(0,1fr)_auto] md:items-center md:gap-x-4"
                  >
                    <span className="text-sm text-ink tabular-nums">{timeOf(visit.startsAt)}</span>
                    <span className="flex min-w-0 flex-col gap-1.5">
                      <Link
                        href={`/app/patients/${visit.patientId}`}
                        className="font-medium break-words text-ink underline-offset-2 hover:underline"
                      >
                        {visit.patientName}
                        <span className="font-normal text-ink-muted"> · {visit.opNumber}</span>
                      </Link>
                      <span className="text-sm text-ink-secondary">
                        {visit.typeName} · with {visit.physioName}
                      </span>
                      <span className="flex flex-wrap items-center gap-2">
                        <Tag tone="neutral">{appointmentStatusLabels[visit.status]}</Tag>
                        {coveredBy(visit) ? (
                          <span data-testid="covered-by">
                            <Tag tone="info">Covered by {coveredBy(visit)}</Tag>
                          </span>
                        ) : null}
                        {visit.session?.label ? (
                          <span data-testid="session-label">
                            <Tag tone="outline">{visit.session.label}</Tag>
                          </span>
                        ) : null}
                      </span>
                    </span>
                    {visit.status === 'checked_in' && visit.session && !visit.session.gate.met ? (
                      <p
                        data-testid="session-gate"
                        className="text-sm text-waiting-strong md:max-w-56"
                      >
                        Gate blocked: {visit.session.gate.message}
                      </p>
                    ) : visit.status === 'checked_in' && visit.session ? (
                      <StartButton
                        appointmentId={visit.id}
                        label={startLabel(visit.typeKey)}
                        patientName={visit.patientName}
                      />
                    ) : visit.status === 'in_progress' && visit.session ? (
                      <Link
                        href={`/app/sessions/${visit.id}`}
                        aria-label={`Open session for ${visit.patientName}`}
                        className={`${secondaryButtonClass} md:w-auto`}
                      >
                        Open session
                      </Link>
                    ) : null}
                  </li>
                ))}
            </ol>
          </div>
        ))
      )}
    </section>
  );
}
