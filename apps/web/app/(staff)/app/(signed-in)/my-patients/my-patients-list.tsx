'use client';

import type { MyPatientVisit } from '@clinic-mx/db';
import {
  healthFormStateLabels,
  loudestAlert,
  startLabel,
  visitFormStatus,
  type AlertDisplay,
  type HealthFormState,
  type SessionView,
} from '@clinic-mx/schemas';
import { toneByAppointmentStatus, type Tone } from '@clinic-mx/ui';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { secondaryButtonClass } from '../../../../../components/forms';
import { Tag } from '../../../../../components/tag';
import { LIVE_HEADER } from '../../../../../lib/live';
import { shownStatus, shownStatusLabels, stripClass, timeOf } from '../calendar/calendar-block';
import { StartButton } from './start-button';

/** A visit with its session (SES-01), and who covered it (SES-08). */
type MyPatientRow = MyPatientVisit & { session: SessionView | null; coveredBy: string | null };

type VisitJson = Omit<
  MyPatientRow,
  'startsAt' | 'endsAt' | 'arrivedAt' | 'startedAt' | 'healthForm'
> & {
  startsAt: string;
  endsAt: string;
  arrivedAt: string | null;
  startedAt: string | null;
  healthForm:
    { expiresAt: string; revokedAt: string | null; completedAt: string | null } | undefined;
};

const date = (value: string | null) => (value ? new Date(value) : null);
const revive = (v: VisitJson): MyPatientRow => ({
  ...v,
  startsAt: new Date(v.startsAt),
  endsAt: new Date(v.endsAt),
  arrivedAt: date(v.arrivedAt),
  startedAt: date(v.startedAt),
  healthForm: v.healthForm && {
    expiresAt: new Date(v.healthForm.expiresAt),
    revokedAt: date(v.healthForm.revokedAt),
    completedAt: date(v.healthForm.completedAt),
  },
});

const minutesSince = (from: Date, now: number) =>
  Math.max(0, Math.floor((now - from.getTime()) / 60_000));

const formTone: Record<HealthFormState, Tone> = {
  not_sent: 'outline',
  waiting: 'waiting',
  submitted: 'active',
  expired: 'neutral',
  declined: 'danger',
};

const alertTone: Record<AlertDisplay, Tone> = {
  emergency: 'danger',
  review: 'waiting',
  information: 'neutral',
};

/**
 * My patients today (CLN-01): the physio's visits in time order with status, form status and open
 * alerts, and Start on a checked in visit. Live like Today: checked every `live.refresh_seconds`,
 * only a changed list is sent back; the page gives it a new key when it changes after a post.
 */
export function MyPatientsList({
  initial,
  version,
  renderedAt,
  lateMinutes,
  refreshSeconds,
  showCentre,
}: {
  initial: MyPatientRow[];
  version: string;
  renderedAt: number;
  lateMinutes: number;
  refreshSeconds: number;
  /** Whether the person works at more than one centre, so each visit says where. */
  showCentre: boolean;
}) {
  const [visits, setVisits] = useState(initial);
  const [checkedAt, setCheckedAt] = useState(renderedAt);
  const [failing, setFailing] = useState(false);
  const [now, setNow] = useState(renderedAt);
  const current = useRef(version);

  useEffect(() => {
    const tick = setInterval(() => {
      setNow(Date.now());
    }, 1000);
    return () => {
      clearInterval(tick);
    };
  }, []);

  useEffect(() => {
    let stopped = false;
    const check = async () => {
      try {
        const query = new URLSearchParams({ since: current.current });
        const response = await fetch(`/app/my-patients/live?${query.toString()}`, {
          headers: { [LIVE_HEADER]: '1' },
          cache: 'no-store',
        });
        if (!response.ok) throw new Error(`live check ${String(response.status)}`);
        const answer = (await response.json()) as { version: string; visits?: VisitJson[] };
        if (stopped) return;
        if (answer.visits) {
          setVisits(answer.visits.map(revive));
          current.current = answer.version;
        }
        setCheckedAt(Date.now());
        setFailing(false);
      } catch {
        if (!stopped) setFailing(true);
      }
    };
    const timer = setInterval(() => void check(), refreshSeconds * 1000);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [refreshSeconds]);

  const seconds = Math.max(0, Math.round((now - checkedAt) / 1000));
  return (
    <div className="flex flex-col gap-3">
      <p
        data-testid="live-status"
        className={`text-sm ${failing ? 'text-waiting-strong' : 'text-ink-muted'}`}
      >
        {failing
          ? `Not updated for ${String(seconds)} s. Checking again.`
          : `Live, updated ${String(seconds)} s ago`}
      </p>
      {visits.length === 0 ? (
        <p className="rounded-panel border border-line bg-surface px-4 py-6 text-ink-muted">
          No patients booked with you today.
        </p>
      ) : (
        <ol className="divide-y divide-line overflow-hidden rounded-panel border border-line bg-surface">
          {visits.map((visit) => {
            const status = shownStatus(visit, now, lateMinutes);
            const label =
              visit.status === 'checked_in' && visit.arrivedAt
                ? `Here ${String(minutesSince(visit.arrivedAt, now))} min`
                : visit.status === 'in_progress' && visit.coveredBy && visit.startedAt
                  ? `With ${visit.coveredBy} since ${timeOf(visit.startedAt)}`
                  : visit.status === 'in_progress' && visit.startedAt
                    ? `With you since ${timeOf(visit.startedAt)}`
                    : shownStatusLabels[status];
            const form = visitFormStatus(visit, new Date(now));
            const loudest = loudestAlert(visit.alertDisplays);
            return (
              <li
                key={visit.id}
                data-testid="my-patient"
                data-appointment={visit.id}
                className="relative flex flex-col gap-3 py-4 pr-4 pl-5 md:grid md:grid-cols-[7.5rem_minmax(0,1fr)_auto] md:items-center md:gap-x-4"
              >
                <span
                  aria-hidden="true"
                  className={`absolute inset-y-0 left-0 w-[3px] ${stripClass[toneByAppointmentStatus[status]]}`}
                />
                <span className="text-sm text-ink tabular-nums">
                  {timeOf(visit.startsAt)}
                  <span className="text-ink-muted"> to {timeOf(visit.endsAt)}</span>
                </span>
                <span className="flex min-w-0 flex-col gap-1.5">
                  <Link
                    href={`/app/patients/${visit.patientId}`}
                    className="font-medium break-words text-ink underline-offset-2 hover:underline"
                  >
                    {visit.patientName}
                    <span className="font-normal text-ink-muted"> · {visit.opNumber}</span>
                  </Link>
                  <span className="text-sm text-ink-secondary">
                    {visit.typeName}
                    {showCentre ? ` · ${visit.centreName}` : ''}
                  </span>
                  <span className="flex flex-wrap items-center gap-2">
                    <Tag tone={toneByAppointmentStatus[status]}>{label}</Tag>
                    {visit.coveredBy ? (
                      // SES-08: a colleague started it; the note is theirs.
                      <span data-testid="covered-by">
                        <Tag tone="info">Covered by {visit.coveredBy}</Tag>
                      </span>
                    ) : null}
                    {visit.session?.label ? (
                      <span data-testid="session-label">
                        <Tag tone="outline">{visit.session.label}</Tag>
                      </span>
                    ) : null}
                    {form ? (
                      <span data-testid="form-status">
                        <Tag tone={formTone[form]}>Form: {healthFormStateLabels[form]}</Tag>
                      </span>
                    ) : null}
                    {loudest ? (
                      <Link
                        href="/app/alerts"
                        data-testid="visit-alerts"
                        className="rounded-control underline-offset-2 hover:underline"
                      >
                        <Tag tone={alertTone[loudest]}>
                          {visit.openAlerts} open red flag{' '}
                          {visit.openAlerts === 1 ? 'alert' : 'alerts'}
                        </Tag>
                      </Link>
                    ) : null}
                  </span>
                </span>
                {visit.status === 'checked_in' && visit.session && !visit.session.gate.met ? (
                  // SES-01: the session waits for its gate; the physio sees why.
                  <p data-testid="session-gate" className="text-sm text-waiting-strong md:max-w-56">
                    Gate blocked: {visit.session.gate.message}
                  </p>
                ) : visit.status === 'checked_in' ? (
                  <StartButton
                    appointmentId={visit.id}
                    label={startLabel(visit.typeKey)}
                    patientName={visit.patientName}
                  />
                ) : visit.status === 'in_progress' && visit.consultationId ? (
                  <Link
                    href={`/app/consultations/${visit.consultationId}`}
                    data-testid="open-consultation"
                    aria-label={`Open consultation for ${visit.patientName}`}
                    className={`${secondaryButtonClass} md:w-auto`}
                  >
                    Open consultation
                  </Link>
                ) : visit.status === 'in_progress' && visit.session ? (
                  <Link
                    href={`/app/sessions/${visit.id}`}
                    data-testid="open-session"
                    aria-label={`Open session for ${visit.patientName}`}
                    className={`${secondaryButtonClass} md:w-auto`}
                  >
                    Open session
                  </Link>
                ) : null}
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
