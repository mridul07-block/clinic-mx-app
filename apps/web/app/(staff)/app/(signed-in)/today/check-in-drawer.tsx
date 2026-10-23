import {
  formatIstDateTime,
  guardianRelationshipLabels,
  healthFormStateLabels,
  reportAddedBy,
  reportKindLabels,
  reportSizeText,
  type HealthFormState,
} from '@clinic-mx/schemas';
import type { Tone } from '@clinic-mx/ui';
import Link from 'next/link';
import QRCode from 'qrcode';
import { FormMessage } from '../../../../../components/forms';
import { Tag } from '../../../../../components/tag';
import type { CheckInDrawerView } from '../../../../../modules/front-desk/check-in';
import type { CheckInDone } from '../../../../../modules/front-desk/links';
import { timeOf } from '../calendar/calendar-block';
import { Detail, Drawer, linkClass } from '../calendar/drawer';
import {
  CheckInForm,
  OpenOnTabletForm,
  ReportUpload,
  ShowQrButton,
  UndoCheckInButton,
  type DrawerPlace,
} from './check-in-buttons';

const formTone: Record<HealthFormState, Tone> = {
  not_sent: 'outline',
  waiting: 'waiting',
  submitted: 'active',
  expired: 'neutral',
  // A Part A consent declined (INT-06): reception speaks to the patient.
  declined: 'danger',
};

const doneMessages: Record<CheckInDone, string> = {
  'checked-in': 'Checked in.',
  undone: 'Check in undone.',
  tablet: 'Sent to the tablet. It opens the form within a few seconds.',
  reports: 'Reports added.',
};

/** The health form link as a QR the patient scans with their phone camera (PRD J2.2). */
async function qrImage(url: string): Promise<string> {
  const svg = await QRCode.toString(url, { type: 'svg', margin: 2, errorCorrectionLevel: 'M' });
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

/**
 * The check in drawer (INT-02, Frontend Specification "Check in drawer"): who the patient is,
 * Check in once that is ticked, then the health form (status, Show QR, Open on tablet) for a
 * first visit, and the patient's reports. On a phone it is a bottom sheet, like the calendar's.
 */
export async function CheckInDrawer({
  view,
  place,
  origin,
  showQr,
  done,
  closeHref,
  maxReportMegabytes,
}: {
  view: CheckInDrawerView;
  place: DrawerPlace;
  /** Our own address, for the QR (never supabase.co). */
  origin: string;
  showQr: boolean;
  done?: CheckInDone;
  closeHref: string;
  maxReportMegabytes: number;
}) {
  const { appointment, healthForm } = view;
  const waiting = appointment.status === 'booked' || appointment.status === 'confirmed';
  const here = appointment.status === 'checked_in';
  const formUrl = healthForm?.path ? `${origin}${healthForm.path}` : null;
  return (
    <Drawer
      label="Check in"
      closeHref={closeHref}
      footer={waiting ? <CheckInForm place={place} /> : undefined}
    >
      {done ? (
        <div role="status" data-testid="check-in-done">
          <FormMessage tone="info">{doneMessages[done]}</FormMessage>
        </div>
      ) : null}
      <div className="flex flex-col gap-1">
        <p className="font-mono text-sm text-ink-secondary">{appointment.number}</p>
        <h2 className="text-title font-semibold text-ink">{appointment.patientName}</h2>
        <p className="text-ink-secondary">
          {appointment.typeName} at {timeOf(appointment.startsAt)} with {appointment.physioName}
        </p>
      </div>

      <section aria-labelledby="identity" className="flex flex-col gap-3" data-testid="identity">
        <h3 id="identity" className="font-semibold text-ink">
          Who this is
        </h3>
        <dl className="grid grid-cols-2 gap-3">
          <Detail term="OP number">
            <span className="font-mono">{appointment.opNumber}</span>
          </Detail>
          <Detail term="Age">
            {view.age === null ? 'Date of birth not recorded' : `${String(view.age)} years`}
          </Detail>
          <Detail term="Mobile">Ending {appointment.phoneEnding}</Detail>
          <Detail term="Patient">
            <Link href={`/app/patients/${appointment.patientId}`} className={linkClass}>
              Open their page
            </Link>
          </Detail>
        </dl>
        {view.minor ? (
          <div
            data-testid="guardians"
            className="flex flex-col gap-1 rounded-panel border border-waiting-line bg-waiting-soft px-4 py-3"
          >
            <span className="font-semibold text-waiting-strong">A guardian must attend.</span>
            {view.guardians.length === 0 ? (
              <span className="text-sm text-ink-secondary">No guardian recorded yet.</span>
            ) : (
              view.guardians.map((guardian) => (
                <span key={guardian.id} className="text-sm text-ink-secondary">
                  {guardian.name}, {guardianRelationshipLabels[guardian.relationship]}
                </span>
              ))
            )}
          </div>
        ) : null}
      </section>

      {here ? (
        <section aria-labelledby="arrival" className="flex flex-col gap-3">
          <h3 id="arrival" className="font-semibold text-ink">
            Arrival
          </h3>
          <p data-testid="checked-in" className="text-ink">
            Checked in {appointment.arrivedAt ? timeOf(appointment.arrivedAt) : ''}
            {appointment.checkedInByName ? ` by ${appointment.checkedInByName}` : ''}
          </p>
          <UndoCheckInButton place={place} />
        </section>
      ) : null}

      {here ? (
        <section aria-labelledby="health-form" className="flex flex-col gap-3">
          <h3 id="health-form" className="font-semibold text-ink">
            Health form
          </h3>
          {healthForm ? (
            <>
              <span data-testid="form-status">
                <Tag tone={formTone[healthForm.state]}>
                  {healthFormStateLabels[healthForm.state]}
                </Tag>
              </span>
              {showQr && formUrl && healthForm.expiresAt ? (
                <figure
                  data-testid="form-qr"
                  className="flex flex-col items-center gap-2 rounded-panel border border-line bg-surface p-4"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element -- an SVG data URL drawn here on the server; next/image cannot optimise it */}
                  <img
                    src={await qrImage(formUrl)}
                    alt="QR code for the patient’s health form"
                    width={240}
                    height={240}
                    className="size-60"
                  />
                  <figcaption className="text-center text-sm text-ink-secondary">
                    Scan with your phone camera. Works until{' '}
                    {formatIstDateTime(healthForm.expiresAt)}.
                    <span className="mt-1 block font-mono text-xs break-all text-ink-muted">
                      {healthForm.path}
                    </span>
                  </figcaption>
                </figure>
              ) : null}
              {healthForm.state !== 'submitted' ? (
                <div className="flex flex-col gap-2">
                  {!showQr || !formUrl ? (
                    <ShowQrButton
                      place={place}
                      label={healthForm.state === 'expired' ? 'Show a new QR' : 'Show QR'}
                    />
                  ) : null}
                  {view.tablets.length > 0 ? (
                    <OpenOnTabletForm place={place} tablets={view.tablets} />
                  ) : (
                    <p className="text-sm text-ink-muted">
                      No tablet is set up as a kiosk here.{' '}
                      <Link href="/app/kiosk-tablets" className={linkClass}>
                        Set one up
                      </Link>
                    </p>
                  )}
                </div>
              ) : null}
            </>
          ) : (
            <p data-testid="no-health-form" className="text-ink-secondary">
              No health form for this visit: it is part of an open episode.
            </p>
          )}
        </section>
      ) : null}

      <section aria-labelledby="reports" className="flex flex-col gap-3">
        <h3 id="reports" className="font-semibold text-ink">
          Reports
        </h3>
        {view.reports.length === 0 ? (
          <p className="text-sm text-ink-muted">None added yet.</p>
        ) : (
          <ul data-testid="report-list" className="flex flex-col divide-y divide-line">
            {view.reports.map((report) => (
              <li key={report.id} className="flex flex-col py-2 text-sm">
                <span className="text-ink">
                  {reportKindLabels[report.contentType]}, {reportSizeText(report.sizeBytes)}
                </span>
                <span className="text-ink-secondary">
                  Added by {reportAddedBy(report)}, {formatIstDateTime(report.createdAt)}
                </span>
              </li>
            ))}
          </ul>
        )}
        <p className="text-sm text-ink-muted">
          Only clinicians open reports, from the patient record.
        </p>
        <ReportUpload place={place} maxMegabytes={maxReportMegabytes} />
      </section>
    </Drawer>
  );
}
