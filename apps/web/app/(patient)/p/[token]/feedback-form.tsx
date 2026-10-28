'use client';

import {
  feedbackCommentMax,
  feedbackScoreMax,
  type FeedbackSurvey,
  type FeedbackSurveyKey,
} from '@clinic-mx/schemas';
import { useActionState } from 'react';
import { sendFeedbackAction, type FeedbackFormState } from '../../../../modules/feedback/actions';
import { patientPrimaryClass } from './patient-ui';

// Feedback after the consultation (PAT-04) and at discharge (PAT-07), Frontend Specification
// "Feedback": the questions as 64 px Yes / No pairs, at discharge the 0 to 10 recommendation score
// as a row of numbers, an optional comment, and Send as the one gold action. One short topic, so
// one screen; a plain form post, so it works without scripts.

const initialState: FeedbackFormState = {};

/** A paired choice drawn as two 64 px buttons, as on the consent cards. */
const pairClass =
  'flex min-h-16 cursor-pointer items-center justify-center rounded-control border border-line-control bg-surface px-2 text-center font-semibold text-ink has-[:checked]:border-accent has-[:checked]:bg-accent has-[:checked]:text-on-accent has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-focus';

/** A number of the 0 to 10 scale, 56 px tall (the patient target), chosen like the Yes / No pairs. */
const scoreClass =
  'flex min-h-14 cursor-pointer items-center justify-center rounded-control border border-line-control bg-surface text-center font-semibold text-ink tabular-nums has-[:checked]:border-accent has-[:checked]:bg-accent has-[:checked]:text-on-accent has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-focus';

export function FeedbackForm({
  token,
  surveyKey,
  survey,
}: {
  token: string;
  surveyKey: FeedbackSurveyKey;
  survey: FeedbackSurvey;
}) {
  const [state, action, pending] = useActionState(sendFeedbackAction, initialState);
  const errors = state.errors ?? {};
  const values = state.values ?? {};
  return (
    <form action={action} className="flex flex-col gap-6 pb-28" data-testid="feedback-form">
      <input type="hidden" name="token" value={token} />
      <input type="hidden" name="survey" value={surveyKey} />
      {state.errors ? (
        <p
          role="alert"
          className="rounded-control border border-danger-line bg-danger-soft p-3 text-ink"
        >
          Please answer the questions marked below.
        </p>
      ) : null}
      <div key={state.attempt ?? 0} className="flex flex-col gap-6">
        <div className="flex flex-col gap-1">
          <h1 className="text-xl font-semibold text-ink">{survey.title}</h1>
          <p className="text-ink-secondary">{survey.intro}</p>
        </div>
        {survey.questions.map((question) => (
          <fieldset
            key={question.key}
            aria-invalid={errors[question.key] ? true : undefined}
            aria-describedby={errors[question.key] ? `${question.key}-error` : undefined}
            className="group flex flex-col gap-3"
            data-testid="feedback-question"
          >
            <legend className="mb-3 font-medium text-ink">{question.text}</legend>
            <div className="grid grid-cols-2 gap-3">
              {(
                [
                  ['yes', 'Yes'],
                  ['no', 'No'],
                ] as const
              ).map(([value, label]) => (
                <label key={value} className={pairClass}>
                  <input
                    type="radio"
                    name={question.key}
                    value={value}
                    defaultChecked={values[question.key] === value}
                    className="sr-only"
                  />
                  {label}
                </label>
              ))}
            </div>
            {errors[question.key] ? (
              <p id={`${question.key}-error`} className="text-danger group-has-[:checked]:hidden">
                {errors[question.key]}
              </p>
            ) : null}
          </fieldset>
        ))}
        {survey.score ? (
          <fieldset
            aria-invalid={errors.score ? true : undefined}
            aria-describedby={errors.score ? 'score-error' : 'score-ends'}
            className="group flex flex-col gap-3"
            data-testid="feedback-score"
          >
            <legend className="mb-3 font-medium text-ink">{survey.score}</legend>
            <div className="grid grid-cols-4 gap-2">
              {Array.from({ length: feedbackScoreMax + 1 }, (_, value) => (
                <label key={value} className={scoreClass}>
                  <input
                    type="radio"
                    name="score"
                    value={String(value)}
                    defaultChecked={values.score === String(value)}
                    className="sr-only"
                  />
                  {value}
                </label>
              ))}
            </div>
            <p id="score-ends" className="text-sm text-ink-secondary">
              0 means not at all likely, 10 extremely likely.
            </p>
            {errors.score ? (
              <p id="score-error" className="text-danger group-has-[:checked]:hidden">
                {errors.score}
              </p>
            ) : null}
          </fieldset>
        ) : null}
        <div className="flex flex-col gap-2">
          <label htmlFor="feedback-comment" className="font-medium text-ink">
            {survey.commentLabel}
          </label>
          <textarea
            id="feedback-comment"
            name="comment"
            rows={4}
            maxLength={feedbackCommentMax}
            defaultValue={values.comment ?? ''}
            aria-invalid={errors.comment ? true : undefined}
            className="rounded-control border border-line-control bg-surface p-3 text-ink"
          />
          {errors.comment ? <p className="text-danger">{errors.comment}</p> : null}
        </div>
      </div>
      <div className="fixed inset-x-0 bottom-0 border-t border-line bg-surface px-4 py-3">
        <div className="mx-auto flex w-full max-w-signin">
          <button type="submit" disabled={pending} className={patientPrimaryClass}>
            Send
          </button>
        </div>
      </div>
    </form>
  );
}
