'use client';

import { useActionState } from 'react';
import { savePartBAction, type PartBFormState } from '../../../../modules/consent/actions';
import type { PartBCard, PartBSigning } from '../../../../modules/consent/part-b';
import { GuardianSection, SignaturePad, pairClass } from './consent-form';
import { patientPrimaryClass } from './patient-ui';

// Part B, pre-treatment consent (BIL-03; Frontend Specification "Consent card" and "Signature
// pad"): one card per statement, under what it is about, with its version and full text, I agree
// or I do not agree; then the signature for what is agreed, drawn or a typed full name. Declining
// is allowed: a general term declined means no treatment, a package term no package, a treatment
// only that treatment (PRD J4.5), and the front desk speaks to the patient.

const initialState: PartBFormState = {};

export function PartBConsentForm({
  token,
  firstName,
  cards,
  signing,
  guardianNeeded,
}: {
  token: string;
  firstName: string;
  cards: PartBCard[];
  signing: PartBSigning;
  guardianNeeded: boolean;
}) {
  const [state, action, pending] = useActionState(savePartBAction, initialState);
  const values = state.values ?? {};
  const errors = state.errors ?? {};
  return (
    <form action={action} noValidate className="flex flex-col gap-6 pb-28">
      <input type="hidden" name="token" value={token} />
      <div className="flex flex-col gap-2">
        <h1 className="text-xl font-semibold text-ink">Your consent before treatment</h1>
        <p className="text-ink">
          Hello {firstName}. Please read each statement, then choose I agree or I do not agree. You
          may decline any part of your treatment.
        </p>
      </div>
      {guardianNeeded ? (
        <p
          role="alert"
          className="rounded-control border border-danger-line bg-danger-soft p-3 text-ink"
        >
          A parent or guardian signs for a patient under {signing.adultAge}. Please speak to the
          front desk.
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
        {cards.map((card) => (
          <fieldset
            key={card.key}
            aria-invalid={errors[card.key] ? true : undefined}
            className="flex flex-col gap-3 rounded-panel border border-line bg-surface p-4"
            data-testid="part-b-card"
            data-key={card.key}
          >
            <legend className="sr-only">
              {card.title}: {card.text}
            </legend>
            <p className="font-semibold text-ink" aria-hidden="true">
              {card.title}
            </p>
            <p className="text-sm text-ink-muted">
              {card.awaitingWording
                ? 'Wording awaited from the clinic'
                : `Version ${String(card.version)}`}
            </p>
            <p className="text-ink" aria-hidden="true">
              {card.text}
            </p>
            <div className="grid grid-cols-2 gap-3">
              {(
                [
                  ['agree', 'I agree'],
                  ['decline', 'I do not agree'],
                ] as const
              ).map(([value, label]) => (
                <label key={value} className={pairClass}>
                  <input
                    type="radio"
                    name={card.key}
                    value={value}
                    defaultChecked={values[card.key] === value}
                    className="sr-only"
                  />
                  {label}
                </label>
              ))}
            </div>
            {errors[card.key] ? <p className="text-danger">{errors[card.key]}</p> : null}
          </fieldset>
        ))}
        <p className="text-ink">Sign below for what you agree to.</p>
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
