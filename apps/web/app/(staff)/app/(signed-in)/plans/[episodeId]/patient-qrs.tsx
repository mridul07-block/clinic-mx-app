import QRCode from 'qrcode';
import { PatientLinkQr } from '../../../../../../components/patient-link-qr';
import {
  showDischargeFeedbackAction,
  showFeedbackAction,
  showFirstTreatmentCheckAction,
} from '../../../../../../modules/feedback/actions';
import { showMyPlanAction } from '../../../../../../modules/patient-links/actions';

/**
 * Show My plan QR (PAT-01): the patient's page with their next visit, exercises, package and
 * pain; the episode's working link, or a new one, working for `links.my_plan_days`.
 */
export function MyPlanQr({
  episodeId,
  origin,
  discharged,
}: {
  episodeId: string;
  origin: string;
  /** PAT-03: after discharge the page is the maintenance mode. */
  discharged: boolean;
}) {
  return (
    <PatientLinkQr
      id="my-plan"
      title="My plan for the patient"
      description={
        discharged
          ? "The patient's maintenance page: their exercises, the return and flare plans as written at discharge, and how to book a check up. They scan it with their phone camera."
          : "The patient's page with their next visit, exercises, package and pain. They scan it with their phone camera."
      }
      buttonLabel="Show My plan QR"
      alt="QR code for the patient’s My plan"
      action={showMyPlanAction}
      fields={{ episodeId }}
      origin={origin}
    />
  );
}

/**
 * Rate your visit (PAT-04): the four questions after the episode's newest signed consultation,
 * as the bundled WhatsApp message will offer them (ALT-06); working for `links.feedback_days`,
 * once answered "Feedback received".
 */
export function RateYourVisitQr({ episodeId, origin }: { episodeId: string; origin: string }) {
  return (
    <PatientLinkQr
      id="rate-your-visit"
      title="Rate your visit"
      description="Four quick questions about the consultation, answered on the patient's phone."
      buttonLabel="Show Rate your visit QR"
      alt="QR code for the patient’s feedback"
      receivedText="Feedback received. Thank you."
      action={showFeedbackAction}
      fields={{ episodeId }}
      origin={origin}
    />
  );
}

/**
 * Day after first treatment check (PAT-05): Better, Same or Still sore, as the WhatsApp check the
 * day after session 1 will ask (WA-06); once answered, received.
 */
export function FirstTreatmentCheckQr({
  episodeId,
  origin,
}: {
  episodeId: string;
  origin: string;
}) {
  return (
    <PatientLinkQr
      id="first-treatment-check"
      title="First treatment check"
      description="How the patient feels since their first treatment: Better, Same or Still sore, answered on their phone. Still sore alerts the physio."
      buttonLabel="Show first treatment check QR"
      alt="QR code for the patient’s first treatment check"
      receivedText="Answer received. Thank you."
      action={showFirstTreatmentCheckAction}
      fields={{ episodeId }}
      origin={origin}
    />
  );
}

/**
 * Discharge feedback (PAT-07): the discharge questions and the 0 to 10 recommendation score, as
 * the discharge report's "Give feedback" will offer them (OUT-11); once answered, received.
 */
export function DischargeFeedbackQr({ episodeId, origin }: { episodeId: string; origin: string }) {
  return (
    <PatientLinkQr
      id="discharge-feedback"
      title="Discharge feedback"
      description="A few questions about the patient's care, with how likely they are to recommend us, answered on their phone."
      buttonLabel="Show discharge feedback QR"
      alt="QR code for the patient’s discharge feedback"
      receivedText="Discharge feedback received. Thank you."
      action={showDischargeFeedbackAction}
      fields={{ episodeId }}
      origin={origin}
    />
  );
}

/**
 * Leave a review (PAT-09; PRD J7.3: to every discharged patient, never filtered by score): the
 * centre's Google review link as a QR, as the WhatsApp review request will send it (WA-06); shown
 * for every discharged episode, whatever its feedback. A public link, drawn here on the server.
 */
export async function LeaveReviewQr({ link }: { link: string | null }) {
  const image = link
    ? `data:image/svg+xml;utf8,${encodeURIComponent(
        await QRCode.toString(link, { type: 'svg', margin: 2, errorCorrectionLevel: 'M' }),
      )}`
    : null;
  return (
    <section
      aria-labelledby="leave-review-qr-heading"
      className="flex flex-col gap-2"
      data-testid="leave-review-qr"
    >
      <h2 id="leave-review-qr-heading" className="font-semibold text-ink">
        Leave a review
      </h2>
      <p className="text-sm text-ink-secondary">
        The centre’s Google review page, offered to every patient at discharge. They scan it with
        their phone camera.
      </p>
      {link && image ? (
        <figure className="flex flex-col items-center gap-2 rounded-panel border border-line bg-surface p-4">
          {/* eslint-disable-next-line @next/next/no-img-element -- an SVG data URL drawn here; next/image cannot optimise it */}
          <img
            src={image}
            alt="QR code for the centre’s Google review page"
            width={240}
            height={240}
            className="size-60"
          />
          <figcaption
            className="font-mono text-xs break-all text-ink-muted"
            data-testid="leave-review-link"
          >
            {link}
          </figcaption>
        </figure>
      ) : (
        <p className="text-sm text-ink-muted" data-testid="leave-review-none">
          This centre has no Google review link yet. The Super Admin adds it under Centres.
        </p>
      )}
    </section>
  );
}
