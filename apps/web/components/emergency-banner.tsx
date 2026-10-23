import { formatIstDateTime } from '@clinic-mx/schemas';
import Link from 'next/link';
import { ReviewAlertButton } from './review-alert-button';

/** An open emergency alert as a banner shows it (ALT-01). */
export interface EmergencyAlert {
  id: string;
  patientName: string;
  /** Where the front desk's one action goes: the visit. */
  href: string;
  /** For those who read alerts: the rule, and whether they act on it. */
  clinical?: { name: string; signedOff: boolean; canAct: boolean; raisedAt: Date };
}

const actionClass =
  'inline-flex min-h-11 items-center rounded-control border border-on-danger px-3 font-medium';

/**
 * The emergency banner (Frontend Specification: full width solid red, one action, stays until a
 * clinician acknowledges it), on every staff page. The front desk sees "Clinician review needed
 * before patient leaves" (PRD section 2: the banner only); clinicians see the rule and press
 * "I'm reviewing"; managers without the Treats patients tick see the rule and open the alerts.
 */
export function EmergencyBanner({ alert }: { alert: EmergencyAlert }) {
  const clinical = alert.clinical;
  return (
    <div
      role="alert"
      data-testid="emergency-banner"
      data-alert={alert.id}
      className="flex w-full flex-wrap items-center justify-between gap-3 bg-danger-strong px-4 py-3 text-on-danger"
    >
      {clinical ? (
        <>
          <p className="flex flex-col">
            <span className="font-semibold">
              Emergency: {clinical.name} · {alert.patientName}
            </span>
            <span className="text-sm">
              Raised {formatIstDateTime(clinical.raisedAt)}
              {clinical.signedOff ? '' : ' · Awaiting clinical sign-off'}
            </span>
          </p>
          {clinical.canAct ? (
            <ReviewAlertButton alertId={alert.id} className={actionClass} />
          ) : (
            <Link href="/app/alerts" className={actionClass}>
              Open alerts
            </Link>
          )}
        </>
      ) : (
        <>
          <p className="font-semibold">
            Clinician review needed before {alert.patientName} leaves.
          </p>
          <Link href={alert.href} className={actionClass}>
            Open patient
          </Link>
        </>
      )}
    </div>
  );
}
