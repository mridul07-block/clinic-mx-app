'use client';

import type {
  QuestionnaireDefinition,
  QuestionnaireItem,
  QuestionnaireRawAnswers,
} from '@clinic-mx/schemas';
import { useId, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { sendQuestionnaireAction } from '../../../../modules/questionnaires/actions';
import { patientPrimaryClass, patientSecondaryClass } from './patient-ui';

// A patient filled questionnaire (OUT-02; Frontend Specification: one question per screen,
// progress shown, auto score): the instrument's instructions, then each item on its own screen,
// worded answers as 64 px buttons and scales as numbered buttons with their worded ends; one may
// be skipped, which the instrument's rule counts as missing. Send posts every answer at once, with
// the versions shown; our server scores it.

const answerClass =
  'flex min-h-16 w-full items-center justify-center rounded-control border px-4 text-center text-lg font-semibold focus-visible:outline-2 focus-visible:outline-focus';
const chosenClass = 'border-accent bg-accent-soft text-ink';
const openClass = 'border-line-control bg-surface text-ink hover:border-accent';

function Choices({
  item,
  value,
  choose,
}: {
  item: QuestionnaireItem;
  value: number | null | undefined;
  choose: (value: number) => void;
}) {
  const ends = useId();
  if (item.kind === 'choice') {
    return (
      <div className="flex flex-col gap-3" role="group" aria-label={item.text}>
        {item.options.map((option) => (
          <button
            key={option.value}
            type="button"
            aria-pressed={value === option.value}
            className={[answerClass, value === option.value ? chosenClass : openClass].join(' ')}
            onClick={() => {
              choose(option.value);
            }}
          >
            {option.label}
          </button>
        ))}
      </div>
    );
  }
  const values = Array.from({ length: item.max - item.min + 1 }, (_, index) => item.min + index);
  return (
    <div className="flex flex-col gap-2">
      <div className="grid grid-cols-6 gap-2" role="group" aria-label={item.text}>
        {values.map((each) => (
          <button
            key={each}
            type="button"
            aria-pressed={value === each}
            aria-describedby={ends}
            className={[
              'flex min-h-12 items-center justify-center rounded-control border text-lg font-semibold tabular-nums focus-visible:outline-2 focus-visible:outline-focus',
              value === each ? chosenClass : openClass,
            ].join(' ')}
            onClick={() => {
              choose(each);
            }}
          >
            {each}
          </button>
        ))}
      </div>
      <p id={ends} className="flex justify-between gap-4 text-sm text-ink-secondary">
        <span>
          {item.min}: {item.minLabel}
        </span>
        <span className="text-right">
          {item.max}: {item.maxLabel}
        </span>
      </p>
    </div>
  );
}

/** Send, held while it is on its way so it goes once. */
function SendButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className={patientPrimaryClass}>
      {pending ? 'Sending…' : 'Send'}
    </button>
  );
}

export function QuestionnaireForm({
  token,
  instrumentKey,
  kbVersionId,
  name,
  definition,
  number,
  of,
}: {
  token: string;
  instrumentKey: string;
  /** The knowledge base version it was shown from, sent back so a change is caught. */
  kbVersionId: string;
  name: string;
  definition: QuestionnaireDefinition;
  /** Which of the link's questionnaires this is, and how many there are. */
  number: number;
  of: number;
}) {
  const items = definition.items;
  const first = definition.instructions ? -1 : 0;
  // -1 is the instructions; items.length is the last screen, to send.
  const [at, setAt] = useState(first);
  const [answers, setAnswers] = useState<QuestionnaireRawAnswers>({});
  const item = items[at];
  const next = () => {
    setAt((current) => current + 1);
  };
  const back = () => {
    setAt((current) => current - 1);
  };
  const answer = (key: string, change: Partial<QuestionnaireRawAnswers[string]>) => {
    setAnswers((current) => ({
      ...current,
      [key]: { value: current[key]?.value ?? null, ...current[key], ...change },
    }));
  };
  const given = items.filter((each) => typeof answers[each.key]?.value === 'number').length;
  const named = item?.kind !== 'activity' || Boolean(answers[item.key]?.activity?.trim());

  return (
    <div className="flex flex-col gap-6" data-testid="questionnaire-form">
      <div className="flex flex-col gap-1">
        <p className="text-sm text-ink-muted" data-testid="questionnaire-of">
          {of > 1 ? `Questionnaire ${String(number)} of ${String(of)}` : 'Questionnaire'}
        </p>
        <h1 className="text-xl font-semibold text-ink">{name}</h1>
      </div>

      {at === -1 ? (
        <>
          <p className="whitespace-pre-line text-ink" data-testid="questionnaire-instructions">
            {definition.instructions}
          </p>
          <button type="button" className={patientPrimaryClass} onClick={next}>
            Start
          </button>
        </>
      ) : item ? (
        // Keyed by item, so a quick second tap never lands on the next question's button.
        <div key={item.key} className="flex flex-col gap-6">
          <p
            className="text-sm text-ink-muted"
            data-testid="questionnaire-progress"
            aria-live="polite"
          >
            Question {at + 1} of {items.length}
          </p>
          <p className="text-lg text-ink" data-testid="questionnaire-item">
            {item.text}
          </p>
          {item.kind === 'activity' ? (
            <label className="flex flex-col gap-1.5 text-ink">
              <span className="text-sm text-ink-secondary">The activity</span>
              <input
                type="text"
                maxLength={120}
                value={answers[item.key]?.activity ?? ''}
                onChange={(event) => {
                  answer(item.key, { activity: event.target.value });
                }}
                className="min-h-11 rounded-control border border-line-control bg-surface px-3 text-ink"
              />
            </label>
          ) : null}
          <Choices
            item={item}
            value={answers[item.key]?.value}
            choose={(value) => {
              answer(item.key, { value });
              if (item.kind !== 'activity') next();
            }}
          />
          <div className="flex flex-col gap-2">
            {item.kind === 'activity' ? (
              <button
                type="button"
                className={patientPrimaryClass}
                disabled={!named || typeof answers[item.key]?.value !== 'number'}
                onClick={next}
              >
                Next
              </button>
            ) : null}
            <button
              type="button"
              className={patientSecondaryClass}
              onClick={() => {
                answer(item.key, { value: null });
                next();
              }}
            >
              Skip this question
            </button>
            {at > first ? (
              <button type="button" className={patientSecondaryClass} onClick={back}>
                Back
              </button>
            ) : null}
          </div>
        </div>
      ) : (
        <form action={sendQuestionnaireAction} className="flex flex-col gap-4">
          <input type="hidden" name="token" value={token} />
          <input type="hidden" name="key" value={instrumentKey} />
          <input type="hidden" name="kbVersionId" value={kbVersionId} />
          <input type="hidden" name="version" value={definition.version} />
          <input type="hidden" name="answers" value={JSON.stringify(answers)} />
          <p className="text-ink" data-testid="questionnaire-ready">
            You answered {given} of {items.length} questions.
          </p>
          <SendButton />
          <button type="button" className={patientSecondaryClass} onClick={back}>
            Back
          </button>
        </form>
      )}
    </div>
  );
}
