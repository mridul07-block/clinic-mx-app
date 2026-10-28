'use client';

import { useActionState } from 'react';
import {
  FormMessage,
  TextField,
  dangerButtonClass,
  primaryButtonClass,
} from '../../../../../components/forms';
import { switchAiSheetAction, type AiSwitchState } from '../../../../../modules/ai/actions';

const initialState: AiSwitchState = {};

/** One record: when, and the document it is in. */
function Evidence({
  part,
  legend,
  state,
  today,
}: {
  part: 'blindTest' | 'legalCheck';
  legend: string;
  state: AiSwitchState;
  today: string;
}) {
  return (
    <fieldset className="flex flex-col gap-3 rounded-panel border border-line bg-surface p-4">
      <legend className="px-1 font-semibold text-ink">{legend}</legend>
      <TextField
        label="Date"
        name={`${part}.date`}
        type="date"
        max={today}
        defaultValue={state.values?.[`${part}.date`]}
        error={state.fieldErrors?.[`${part}.date`]}
      />
      <TextField
        label="Reference"
        name={`${part}.reference`}
        maxLength={200}
        defaultValue={state.values?.[`${part}.reference`]}
        error={state.fieldErrors?.[`${part}.reference`]}
        helper="The document’s name or number. No patient details."
      />
    </fieldset>
  );
}

/**
 * The AI preparation sheet switch (AI-09): while off, the blind test pass and the legal clearance
 * to record, then "Switch on"; "Switch off" whenever it is stored on, including while a newer
 * knowledge base version holds it off.
 */
export function AiSwitchForm({
  choices,
  today,
}: {
  choices: { switchOff: boolean; switchOn: boolean };
  today: string;
}) {
  const [state, action, pending] = useActionState(switchAiSheetAction, initialState);
  return (
    <div className="flex flex-col gap-3">
      {state.done ? <FormMessage tone="info">{state.done}</FormMessage> : null}
      {state.error ? <FormMessage tone="danger">{state.error}</FormMessage> : null}
      {choices.switchOff ? (
        <form action={action} className="flex flex-col gap-2">
          <input type="hidden" name="on" value="false" />
          <button
            type="submit"
            disabled={pending}
            className={`${dangerButtonClass} md:w-auto md:self-start`}
          >
            Switch off
          </button>
        </form>
      ) : null}
      {choices.switchOn ? (
        <form action={action} className="flex flex-col gap-4" noValidate>
          <input type="hidden" name="on" value="true" />
          <Evidence part="blindTest" legend="Blind test passed" state={state} today={today} />
          <Evidence part="legalCheck" legend="Legal check cleared" state={state} today={today} />
          <button
            type="submit"
            disabled={pending}
            className={`${primaryButtonClass} md:w-auto md:self-start`}
          >
            Switch on
          </button>
        </form>
      ) : null}
    </div>
  );
}
