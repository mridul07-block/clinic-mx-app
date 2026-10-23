import type { RedFlagAlertEntry } from '@clinic-mx/db';
import {
  formatIstDateTime,
  istDate,
  redFlagAlertStatusLabels,
  redFlagTriageLabels,
  type AlertDisplay,
} from '@clinic-mx/schemas';
import type { Tone } from '@clinic-mx/ui';
import type { Metadata } from 'next';
import Link from 'next/link';
import { FormMessage } from '../../../../../components/forms';
import { Tag } from '../../../../../components/tag';
import { requirePermission } from '../../../../../modules/access/require-permission';
import { alertsOf } from '../../../../../modules/alerts/services';
import { calendarHref } from '../../../../../modules/scheduling/links';
import { CloseForm, ReferForm, ReviewForm } from './alert-forms';

export const metadata: Metadata = { title: 'Alerts · Clinic Mx' };
export const dynamic = 'force-dynamic';

const displayTone: Record<AlertDisplay, Tone> = {
  emergency: 'danger',
  review: 'waiting',
  information: 'neutral',
};

/** Raised, then each step with who and when (Frontend Specification: lifecycle shown). */
function Lifecycle({ alert }: { alert: RedFlagAlertEntry }) {
  const steps = [
    { label: 'Raised', at: alert.raisedAt, by: 'from the health form' },
    alert.reviewedAt && { label: 'Reviewed', at: alert.reviewedAt, by: alert.reviewedBy },
    alert.referredAt && {
      label: `Referred to ${alert.referredTo ?? ''}`,
      at: alert.referredAt,
      by: alert.referredBy,
    },
    alert.closedAt && { label: 'Closed', at: alert.closedAt, by: alert.closedBy },
  ].filter((step) => step !== null);
  return (
    <ol className="flex flex-col gap-1 border-l-2 border-line pl-3 text-sm text-ink-secondary">
      {steps.map((step) => (
        <li key={step.label}>
          <span className="font-medium text-ink">{step.label}</span> · {formatIstDateTime(step.at)}
          {step.by ? ` · ${step.by}` : ''}
        </li>
      ))}
    </ol>
  );
}

function AlertCard({ alert, canAct }: { alert: RedFlagAlertEntry; canAct: boolean }) {
  return (
    <li
      data-testid="alert-card"
      data-status={alert.status}
      data-alert={alert.id}
      className="flex flex-col gap-3 rounded-panel border border-line bg-surface p-4"
    >
      <div className="flex flex-col gap-1.5">
        <span className="flex flex-wrap items-center gap-2">
          <span className="font-semibold text-ink">{alert.name}</span>
          <Tag tone={displayTone[alert.display]}>{redFlagTriageLabels[alert.triage]}</Tag>
          <Tag tone={alert.status === 'closed' ? 'done' : 'outline'}>
            {redFlagAlertStatusLabels[alert.status]}
          </Tag>
          {alert.signedOff ? null : <Tag tone="outline">Awaiting clinical sign-off</Tag>}
        </span>
        <p className="text-ink">
          {alert.patientName}
          {alert.startsAt ? `, visit ${formatIstDateTime(alert.startsAt)}` : ''}
        </p>
        <p className="text-sm text-ink-secondary">
          <span className="font-medium text-ink">Action: </span>
          {alert.action}
        </p>
      </div>
      <Lifecycle alert={alert} />
      {alert.decision ? (
        <p className="text-sm text-ink-secondary">
          <span className="font-medium text-ink">Decision: </span>
          {alert.decision}
        </p>
      ) : null}
      {canAct && alert.status === 'raised' ? <ReviewForm alertId={alert.id} /> : null}
      {canAct && alert.status === 'reviewed' ? <ReferForm alertId={alert.id} /> : null}
      {canAct && (alert.status === 'reviewed' || alert.status === 'referred') ? (
        <CloseForm alertId={alert.id} />
      ) : null}
      {alert.appointmentId && alert.startsAt ? (
        <Link
          href={calendarHref({
            centreId: alert.centreId,
            date: istDate(alert.startsAt),
            appointmentId: alert.appointmentId,
          })}
          className="self-start text-sm text-accent underline underline-offset-2 pointer-coarse:py-3"
        >
          Open the visit
        </Link>
      ) : null}
    </li>
  );
}

// Red flag alerts (ALT-01, PRD M11; Frontend Specification "Alert card"): the open alerts at the
// person's centres, emergencies first, each with its tier, rule, patient, time raised and
// lifecycle; clinicians press "I'm reviewing", refer, and close with a written decision. The most
// recently closed follow. For the Super Admin, Centre Managers and physios (PRD section 2).
export default async function AlertsPage() {
  const staff = await requirePermission('red_flags.view');
  const { open, recentlyClosed, canAct } = await alertsOf(staff);
  return (
    <main className="flex w-full max-w-signin flex-col gap-6 px-4 py-6">
      <div className="flex flex-col gap-1.5">
        <Link href="/app" className="text-sm text-ink-muted underline underline-offset-2">
          Home
        </Link>
        <h1 className="text-title font-semibold">Alerts</h1>
        {canAct ? null : (
          <p className="text-sm text-ink-muted">
            Clinicians review, refer and close alerts; you see them here.
          </p>
        )}
      </div>
      <section className="flex flex-col gap-3" aria-labelledby="open-alerts">
        <h2 id="open-alerts" className="font-semibold text-ink">
          Open
        </h2>
        {open.length === 0 ? (
          <FormMessage tone="info">No open alerts.</FormMessage>
        ) : (
          <ul className="flex flex-col gap-3" data-testid="open-alerts">
            {open.map((alert) => (
              <AlertCard key={alert.id} alert={alert} canAct={canAct} />
            ))}
          </ul>
        )}
      </section>
      {recentlyClosed.length > 0 ? (
        <section className="flex flex-col gap-3" aria-labelledby="closed-alerts">
          <h2 id="closed-alerts" className="font-semibold text-ink">
            Recently closed
          </h2>
          <ul className="flex flex-col gap-3" data-testid="closed-alerts">
            {recentlyClosed.map((alert) => (
              <AlertCard key={alert.id} alert={alert} canAct={false} />
            ))}
          </ul>
        </section>
      ) : null}
    </main>
  );
}
