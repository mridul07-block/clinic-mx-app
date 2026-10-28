import {
  firstTreatmentAnswerLabels,
  firstTreatmentAnswers,
  firstTreatmentCheck,
} from '@clinic-mx/schemas';
import { sendFirstTreatmentCheckAction } from '../../../../modules/feedback/actions';

// The day after first treatment check (PAT-05; PRD J5.6: "Better, Same, Still sore"): one
// question and its three answers as 64 px buttons, one tap each sends it. A plain form post, so it
// works without scripts; the link's page then thanks the patient.

const answerClass =
  'flex min-h-16 w-full items-center justify-center rounded-control border border-line-control bg-surface px-4 text-center text-lg font-semibold text-ink hover:border-accent focus-visible:outline-2 focus-visible:outline-focus';

export function FirstTreatmentForm({ token }: { token: string }) {
  return (
    <form
      action={sendFirstTreatmentCheckAction}
      className="flex flex-col gap-6"
      data-testid="first-treatment-form"
    >
      <input type="hidden" name="token" value={token} />
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold text-ink">{firstTreatmentCheck.title}</h1>
        <p className="text-ink-secondary">{firstTreatmentCheck.question}</p>
      </div>
      <div className="flex flex-col gap-3" role="group" aria-label={firstTreatmentCheck.question}>
        {firstTreatmentAnswers.map((answer) => (
          <button key={answer} type="submit" name="answer" value={answer} className={answerClass}>
            {firstTreatmentAnswerLabels[answer]}
          </button>
        ))}
      </div>
    </form>
  );
}
