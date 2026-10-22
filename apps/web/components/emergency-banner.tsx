import Link from 'next/link';

/** An open emergency alert as the front desk sees it (filled by red flag alerts, INT-10). */
export interface EmergencyAlert {
  id: string;
  patientName: string;
  /** Where its one action goes: the patient. */
  href: string;
}

/**
 * The emergency banner (Frontend Specification: full width solid red, one action, stays until a
 * clinician acknowledges it). The front desk sees "Clinician review needed before patient
 * leaves" (PRD section 9, emergency tier); clinicians acknowledge it on their screens.
 */
export function EmergencyBanner({ alert }: { alert: EmergencyAlert }) {
  return (
    <div
      role="alert"
      data-testid="emergency-banner"
      className="flex w-full flex-wrap items-center justify-between gap-3 bg-danger-strong px-4 py-3 text-on-danger"
    >
      <p className="font-semibold">Clinician review needed before {alert.patientName} leaves.</p>
      <Link
        href={alert.href}
        className="inline-flex min-h-11 items-center rounded-control border border-on-danger px-3 font-medium"
      >
        Open patient
      </Link>
    </div>
  );
}
