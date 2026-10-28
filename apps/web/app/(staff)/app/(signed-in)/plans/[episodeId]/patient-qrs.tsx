import { PatientLinkQr } from '../../../../../../components/patient-link-qr';
import {
  showDischargeFeedbackAction,
  showFeedbackAction,
} from '../../../../../../modules/feedback/actions';
import { showMyPlanAction } from '../../../../../../modules/patient-links/actions';

/**
 * Show My plan QR (PAT-01): the patient's page with their next visit, exercises, package and
 * pain; the episode's working link, or a new one, working for `links.my_plan_days`.
 */
export function MyPlanQr({ episodeId, origin }: { episodeId: string; origin: string }) {
  return (
    <PatientLinkQr
      id="my-plan"
      title="My plan for the patient"
      description="The patient's page with their next visit, exercises, package and pain. They scan it with their phone camera."
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
