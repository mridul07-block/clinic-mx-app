'use client';

import { useActionState } from 'react';
import { saveClearanceAction, type PartBFormState } from '../../../../modules/consent/actions';
import type { ClearanceSectionCard } from '../../../../modules/consent/clearance';
import type { PartBSigning } from '../../../../modules/consent/part-b';
import { GuardianSection, SignaturePad, pairClass } from './consent-form';
import { patientPrimaryClass } from './patient-ui';

// The clearance acknowledgement (OUT-09; Frontend Specification "Clearance acknowledgement: Plan,
// warning signs to stop, residual risk; tick and sign"): the consultant's words under each heading,
// a tick for each, then the signature, drawn or a typed full name. Nothing is declined: a patient
// unsure of a section asks before ticking it.

const initialState: PartBFormState = {};

export function ClearanceAcknowledgementForm({
  token,
  firstName,
  status,
  title,
  sections,
  tick,
  signing,
  guardianNeeded,
}: {
  token: string;
  firstName: string;
  status: string;
  title: string;
  sections: ClearanceSectionCard[];
  tick: string;
  signing: PartBSigning;
  guardianNeeded: boolean;
}) {
  const [state, action, pending] = useActionState(saveClearanceAction, initialState);
  const values = state.values ?? {};
  const errors = state.errors ?? {};
  return (
    <form action={action} noValidate className="flex flex-col gap-6 pb-28">
      <input type="hidden" name="token" value={token} />
      <input type="hidden" name="status" value={status} />
      <div className="flex flex-col gap-2">
        <h1 className="text-xl font-semibold text-ink">{title}</h1>
        <p className="text-ink">
          Hello {firstName}. Your physiotherapist wrote these for you. Please read each one and tick
          it. If anything is unclear, ask before you tick.
        </p>
      </div>
      {guardianNeeded ? (
        <p
          role="alert"
          className="rounded-control border border-danger-line bg-danger-soft p-3 text-ink"
        >
          A parent or guardian signs for a patient under {signing.adultAge}. Please speak to your
          physiotherapist.
        </p>
      ) : null}
      {state.errors ? (
        <p
          role="alert"
          className="rounded-control border border-danger-line bg-danger-soft p-3 text-ink"
        >
          Please answer the questions marked below.
        </p>
      ) : null}
      <div key={state.attempt ?? 0} className="flex flex-col gap-6">
        <GuardianSection signing={signing} values={values} errors={errors} />
        {sections.map((card) => {
          const name = ['tick', card.section].join('-');
          const error = errors[card.section];
          const errorId = [card.section, 'error'].join('-');
          return (
            <section
              key={card.section}
              aria-labelledby={[card.section, 'title'].join('-')}
              className="flex flex-col gap-3 rounded-panel border border-line bg-surface p-4"
              data-testid="clearance-section"
              data-section={card.section}
            >
              <h2 id={[card.section, 'title'].join('-')} className="font-semibold text-ink">
                {card.title}
              </h2>
              <p className="whitespace-pre-line text-ink">{card.text}</p>
              <label className={pairClass}>
                <input
                  type="checkbox"
                  name={name}
                  value="yes"
                  defaultChecked={values[name] === 'yes'}
                  aria-invalid={error ? true : undefined}
                  aria-describedby={error ? errorId : undefined}
                  className="sr-only"
                />
                {tick}
                <span className="sr-only"> {card.title}</span>
              </label>
              {error ? (
                <p id={errorId} className="text-danger">
                  {error}
                </p>
              ) : null}
            </section>
          );
        })}
        <p className="text-ink">Sign below to acknowledge all three.</p>
        <SignaturePad
          error={errors.signature}
          typedName={typeof values.typedName === 'string' ? values.typedName : undefined}
        />
      </div>
      <div className="fixed inset-x-0 bottom-0 border-t border-line bg-surface px-4 py-3">
        <div className="mx-auto flex w-full max-w-signin">
          <button type="submit" disabled={pending} className={patientPrimaryClass}>
            Done
          </button>
        </div>
      </div>
    </form>
  );
}
