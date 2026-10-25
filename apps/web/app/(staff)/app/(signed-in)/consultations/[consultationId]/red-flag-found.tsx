'use client';

import {
  formatIstDateTime,
  redFlagTriageActions,
  redFlagTriageLabels,
  redFlagTriages,
  triageRefers,
  type RedFlagTriage,
} from '@clinic-mx/schemas';
import { useActionState, useId, useState } from 'react';
import {
  FormMessage,
  primaryButtonClass,
  secondaryButtonClass,
  TextAreaField,
  TextField,
} from '../../../../../../components/forms';
import { recordRedFlagAction, type AlertFormState } from '../../../../../../modules/alerts/actions';

/** A red flag recorded in this consultation, as the server lists it. */
export interface RecordedRedFlag {
  id: string;
  name: string;
  triage: RedFlagTriage;
  status: string;
  referredTo: string | null;
  raisedAt: Date;
}

const initialState: AlertFormState = {};

/**
 * Red flag found (CLN-11, PRD J3.10; user decisions 25 October 2026): the consultant records what
 * they found in one of the framework's five categories. Every category but Monitor with caution
 * refers: the episode goes On hold, a referral letter is generated and the safety advice is queued.
 * Below, the red flags recorded in this consultation; read only once it is signed.
 */
export function RedFlagFound({
  consultationId,
  editable,
  recorded,
}: {
  consultationId: string;
  editable: boolean;
  recorded: RecordedRedFlag[];
}) {
  const id = useId();
  const [triage, setTriage] = useState<RedFlagTriage | ''>('');
  const [state, action, pending] = useActionState(recordRedFlagAction, initialState);
  // The form is open from the state it was opened at until a later post succeeds; a refusal keeps
  // it open with its message.
  const [openedAt, setOpenedAt] = useState<AlertFormState | null>(null);
  const open = openedAt !== null && (openedAt === state || !state.done);
  const refers = triage !== '' && triageRefers(triage);

  return (
    <section
      aria-labelledby={[id, 'heading'].join('-')}
      className="flex flex-col gap-3 border-t border-line pt-4"
      data-testid="red-flag-found"
    >
      <h3 id={[id, 'heading'].join('-')} className="text-md font-semibold">
        Red flags found in this consultation
      </h3>
      {recorded.length === 0 ? (
        <p className="text-sm text-ink-muted">None recorded.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {recorded.map((flag) => (
            <li
              key={flag.id}
              data-testid="recorded-red-flag"
              className="flex flex-col gap-0.5 rounded-panel border border-line bg-surface px-3 py-2"
            >
              <span className="font-medium text-ink">{flag.name}</span>
              <span className="text-sm text-ink-secondary">
                {redFlagTriageLabels[flag.triage]} ·{' '}
                {flag.referredTo ? `Referred to ${flag.referredTo}` : 'Monitoring'} ·{' '}
                {formatIstDateTime(flag.raisedAt)}
              </span>
            </li>
          ))}
        </ul>
      )}
      {recorded.some((flag) => flag.referredTo) ? (
        <p className="text-sm text-ink-muted">
          The referral letter appears on the patient record’s Documents tab.
        </p>
      ) : null}
      {state.done && !open ? <FormMessage tone="info">Red flag recorded.</FormMessage> : null}

      {editable && !open ? (
        <button
          type="button"
          onClick={() => {
            setTriage('');
            setOpenedAt(state);
          }}
          className={`${secondaryButtonClass} sm:w-auto sm:self-start`}
        >
          Red flag found
        </button>
      ) : null}

      {editable && open ? (
        <form action={action} className="flex flex-col gap-3" noValidate>
          <input type="hidden" name="consultationId" value={consultationId} />
          {/* The category is posted from state: a form reset after a refusal unchecks radios. */}
          <input type="hidden" name="triage" value={triage} />
          {state.error ? <FormMessage tone="danger">{state.error}</FormMessage> : null}
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 font-medium text-ink">Category</legend>
            {redFlagTriages.map((option) => (
              <label key={option} className="flex items-start gap-3 rounded-control px-1 py-1.5">
                <input
                  type="radio"
                  name="triageChoice"
                  value={option}
                  checked={triage === option}
                  onChange={() => {
                    setTriage(option);
                  }}
                  className="mt-1 size-4 shrink-0 accent-accent"
                />
                <span className="flex flex-col">
                  <span className="font-medium text-ink">{redFlagTriageLabels[option]}</span>
                  <span className="text-sm text-ink-muted">{redFlagTriageActions[option]}</span>
                </span>
              </label>
            ))}
          </fieldset>
          <TextField
            label="Red flags found"
            name="found"
            defaultValue={state.values?.found}
            maxLength={200}
            helper="For example, night pain and unexplained weight loss."
          />
          {refers ? (
            <>
              <TextField
                label="Referred to"
                name="referredTo"
                defaultValue={state.values?.referredTo}
                maxLength={200}
                helper="For example the emergency department or an orthopaedic surgeon."
              />
              <TextAreaField
                label="Reason"
                name="reason"
                defaultValue={state.values?.reason}
                maxLength={1000}
                rows={3}
                helper="The red flags found and your reasoning, for the referral letter."
              />
              <TextAreaField
                label="Question for the specialist"
                name="question"
                defaultValue={state.values?.question}
                maxLength={1000}
                rows={2}
                helper="The episode goes On hold and a referral letter is generated."
              />
            </>
          ) : triage === 'monitor_with_caution' ? (
            <p className="text-sm text-ink-muted">
              Recorded for monitoring; the episode carries on. The safety advice is sent with the
              WhatsApp messages.
            </p>
          ) : null}
          <div className="flex flex-col gap-2 sm:flex-row">
            <button
              type="submit"
              disabled={pending || triage === ''}
              className={`${primaryButtonClass} sm:w-auto`}
            >
              {refers ? 'Record and refer' : 'Record red flag'}
            </button>
            <button
              type="button"
              onClick={() => {
                setOpenedAt(null);
              }}
              className={`${secondaryButtonClass} sm:w-auto`}
            >
              Cancel
            </button>
          </div>
        </form>
      ) : null}
    </section>
  );
}
