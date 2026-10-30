import { followUpPeriod, formatIstDate } from '@clinic-mx/schemas';
import QRCode from 'qrcode';
import { PatientLinkQr } from '../../../../../../components/patient-link-qr';
import {
  showDischargeFeedbackAction,
  showFeedbackAction,
  showFirstTreatmentCheckAction,
  showFollowUpCheckAction,
} from '../../../../../../modules/feedback/actions';
import { showPartBConsentAction } from '../../../../../../modules/consent/actions';
import { showMyPlanAction } from '../../../../../../modules/patient-links/actions';
import { showQuestionnairesAction } from '../../../../../../modules/questionnaires/actions';

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

/**
 * Follow up (PAT-10): the follow up after discharge due now (Doing well, Some pain or Injured
 * again), as the WhatsApp follow up will ask it (WA-06); before one is due, when the next is; once
 * all are answered, so.
 */
export function FollowUpCheckQr({
  episodeId,
  origin,
  due,
  nextOn,
}: {
  episodeId: string;
  origin: string;
  due: string | null;
  nextOn: string | null;
}) {
  if (!due) {
    return (
      <section
        aria-labelledby="follow-up-heading"
        className="flex flex-col gap-2"
        data-testid="follow-up-qr"
      >
        <h2 id="follow-up-heading" className="font-semibold text-ink">
          Follow up
        </h2>
        <p className="text-sm text-ink-muted" data-testid="follow-up-next">
          {nextOn
            ? `The next follow up is due on ${formatIstDate(nextOn)}.`
            : 'Every follow up after discharge is answered or past.'}
        </p>
      </section>
    );
  }
  return (
    <PatientLinkQr
      id="follow-up"
      title="Follow up"
      description={`The ${followUpPeriod(due) ?? ''} follow up after discharge: Doing well, Some pain or Injured again, answered on the patient's phone. Injured again alerts the consultant.`}
      buttonLabel="Show follow up QR"
      alt="QR code for the patient’s follow up"
      action={showFollowUpCheckAction}
      fields={{ episodeId }}
      origin={origin}
    />
  );
}

/**
 * OUT-02: the plan's questionnaires on the patient's phone, one question per screen, scored by
 * our server; until WhatsApp (WA-06) as a QR at the desk. Only those that can be filled (SET-08:
 * items, a confirmed licence and sign-off) are offered; until then the sheet says so.
 */
export function QuestionnairesQr({
  episodeId,
  origin,
  fillable,
}: {
  episodeId: string;
  origin: string;
  fillable: number;
}) {
  if (fillable === 0) {
    return (
      <section
        aria-labelledby="questionnaires-heading"
        className="flex flex-col gap-2"
        data-testid="questionnaires-qr"
      >
        <h2 id="questionnaires-heading" className="font-semibold text-ink">
          Questionnaires
        </h2>
        <p className="text-sm text-ink-muted" data-testid="questionnaires-none">
          None of the plan’s questionnaires can be filled yet: each needs its items, a confirmed
          licence and clinical sign-off in the knowledge base.
        </p>
      </section>
    );
  }
  return (
    <PatientLinkQr
      id="questionnaires"
      title="Questionnaires"
      description={`${fillable === 1 ? 'The plan’s questionnaire' : `The plan’s ${String(fillable)} questionnaires`}, one question per screen on the patient's phone and scored automatically: at the start of care, at reviews and before discharge.`}
      buttonLabel="Show questionnaires QR"
      alt="QR code for the patient’s questionnaires"
      action={showQuestionnairesAction}
      fields={{ episodeId }}
      origin={origin}
    />
  );
}

/**
 * Show Part B consent QR (BIL-03, PRD J4.4): the patient reads and signs the pre-treatment consent
 * on their phone; the episode's working consent link, or a new one.
 */
export function PartBConsentQr({ episodeId, origin }: { episodeId: string; origin: string }) {
  return (
    <PatientLinkQr
      id="part-b"
      title="Part B consent for the patient"
      description="The pre-treatment consent: the general terms, the package terms when they chose a package, and each planned treatment. They scan it with their phone camera."
      buttonLabel="Show Part B consent QR"
      alt="QR code for the patient’s Part B consent"
      action={showPartBConsentAction}
      fields={{ episodeId }}
      origin={origin}
    />
  );
}
