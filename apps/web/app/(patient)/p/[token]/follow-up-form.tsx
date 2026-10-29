import {
  followUpAnswerLabels,
  followUpAnswers,
  followUpCheck,
  followUpPeriod,
} from '@clinic-mx/schemas';
import { sendFollowUpCheckAction } from '../../../../modules/feedback/actions';

// A follow up after discharge (PAT-10; PRD J7.4: "Doing well, Some pain, Injured again"): one
// question and its three answers as 64 px buttons, one tap each sends it, for the interval due. A
// plain form post, so it works without scripts; the link's page then thanks the patient.

const answerClass =
  'flex min-h-16 w-full items-center justify-center rounded-control border border-line-control bg-surface px-4 text-center text-lg font-semibold text-ink hover:border-accent focus-visible:outline-2 focus-visible:outline-focus';

export function FollowUpForm({ token, followUp }: { token: string; followUp: string }) {
  const period = followUpPeriod(followUp);
  return (
    <form
      action={sendFollowUpCheckAction}
      className="flex flex-col gap-6"
      data-testid="follow-up-form"
    >
      <input type="hidden" name="token" value={token} />
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold text-ink">{followUpCheck.title}</h1>
        <p className="text-ink-secondary">{followUpCheck.question}</p>
        {period ? (
          <p className="text-sm text-ink-muted" data-testid="follow-up-period">
            {period} after your treatment ended
          </p>
        ) : null}
      </div>
      <div className="flex flex-col gap-3" role="group" aria-label={followUpCheck.question}>
        {followUpAnswers.map((answer) => (
          <button key={answer} type="submit" name="answer" value={answer} className={answerClass}>
            {followUpAnswerLabels[answer]}
          </button>
        ))}
      </div>
    </form>
  );
}
