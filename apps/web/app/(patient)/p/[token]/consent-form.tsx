'use client';

import type { MinorStatus } from '@clinic-mx/schemas';
import Link from 'next/link';
import {
  useActionState,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
  type PointerEvent,
} from 'react';
import { saveScreenAction, type HealthFormState } from '../../../../modules/intake/actions';
import { patientPrimaryClass, patientSecondaryClass } from './patient-ui';

// Part A consent (INT-06, Frontend Specification "Consent card" and "Signature pad"): one card
// per statement with its version and full text, I agree or I do not agree, then a signature
// drawn with a finger or stylus, with Clear. Without scripts the pad cannot draw, so the patient
// types their full name instead (user decision, 23 October 2026).

const initialState: HealthFormState = {};

/** A paired choice drawn as two 64 px buttons, as Yes / No and I agree / I do not agree. */
const pairClass =
  'flex min-h-16 cursor-pointer items-center justify-center rounded-control border border-line-control bg-surface px-2 text-center font-semibold text-ink has-[:checked]:border-accent has-[:checked]:bg-accent has-[:checked]:text-on-accent has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-focus';

/** Who signs Part A (INT-07): under the adult age a guardian on file; unknown asks first. */
export interface ConsentSigning {
  status: MinorStatus;
  adultAge: number;
  guardians: { id: string; label: string }[];
}

/**
 * The guardian section (INT-07, PRD J2.7): without a date of birth on file, "Is the patient
 * under 18?" first; for a patient under the adult age, the guardian on file who signs. Shown by
 * CSS while Yes is ticked, so it works without scripts.
 */
function GuardianSection({
  signing,
  values,
  errors,
}: {
  signing: ConsentSigning;
  values: Record<string, string | string[]>;
  errors: Record<string, string>;
}) {
  const { status, adultAge, guardians } = signing;
  if (status === 'adult') return null;
  const unknown = status === 'unknown';
  return (
    <div className="group/minor flex flex-col gap-6">
      {unknown ? (
        <fieldset aria-invalid={errors.minor ? true : undefined} className="flex flex-col gap-3">
          <legend className="mb-3 font-medium text-ink">Is the patient under {adultAge}?</legend>
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
                  name="minor"
                  value={value}
                  defaultChecked={values.minor === value}
                  className="sr-only"
                />
                {label}
              </label>
            ))}
          </div>
          {errors.minor ? <p className="text-danger">{errors.minor}</p> : null}
        </fieldset>
      ) : null}
      <section
        aria-label="Parent or guardian"
        data-testid="guardian-section"
        className={
          unknown
            ? 'hidden flex-col gap-3 rounded-panel border border-line bg-surface p-4 group-has-[>fieldset_input[value=yes]:checked]/minor:flex'
            : 'flex flex-col gap-3 rounded-panel border border-line bg-surface p-4'
        }
      >
        <p className="text-ink">A parent or guardian signs for a patient under {adultAge}.</p>
        {guardians.length > 0 ? (
          <fieldset
            aria-invalid={errors.guardian ? true : undefined}
            className="flex flex-col gap-3"
          >
            <legend className="mb-3 font-medium text-ink">Who is signing?</legend>
            {guardians.map((guardian) => (
              <label
                key={guardian.id}
                className="flex min-h-target-patient items-center gap-3 rounded-control border border-line-control bg-surface px-4 text-ink has-[:checked]:border-accent has-[:checked]:bg-accent-soft"
              >
                <input
                  type="radio"
                  name="guardian"
                  value={guardian.id}
                  defaultChecked={values.guardian === guardian.id}
                  className="size-5 shrink-0 accent-accent"
                />
                {guardian.label}
              </label>
            ))}
            {errors.guardian ? <p className="text-danger">{errors.guardian}</p> : null}
          </fieldset>
        ) : (
          <p className="text-ink" data-testid="guardian-missing">
            Please speak to reception.
          </p>
        )}
      </section>
    </div>
  );
}

export interface ConsentCard {
  key: string;
  version: number;
  text: string;
}

const noSubscription = () => () => undefined;
const inBrowser = () => true;
const onServer = () => false;

/** The pad: draws on a canvas and posts it as a PNG; a typed name until scripts run. */
function SignaturePad({ error, typedName }: { error?: string; typedName?: string }) {
  const id = useId();
  const canvas = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  // False on the server and without scripts (the typed name), true once the page runs here.
  const ready = useSyncExternalStore(noSubscription, inBrowser, onServer);
  const [drawn, setDrawn] = useState('');

  const point = (event: PointerEvent<HTMLCanvasElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    return {
      x: ((event.clientX - box.left) / box.width) * event.currentTarget.width,
      y: ((event.clientY - box.top) / box.height) * event.currentTarget.height,
    };
  };
  const start = (event: PointerEvent<HTMLCanvasElement>) => {
    const context = event.currentTarget.getContext('2d');
    if (!context) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    drawing.current = true;
    const { x, y } = point(event);
    context.lineWidth = 4;
    context.lineCap = 'round';
    context.lineJoin = 'round';
    // The ink colour token, read from the canvas's own text colour.
    context.strokeStyle = getComputedStyle(event.currentTarget).color;
    context.beginPath();
    context.moveTo(x, y);
  };
  const move = (event: PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return;
    const context = event.currentTarget.getContext('2d');
    const { x, y } = point(event);
    context?.lineTo(x, y);
    context?.stroke();
  };
  const end = (event: PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return;
    drawing.current = false;
    setDrawn(event.currentTarget.toDataURL('image/png'));
  };
  const clear = () => {
    const pad = canvas.current;
    pad?.getContext('2d')?.clearRect(0, 0, pad.width, pad.height);
    setDrawn('');
  };

  const message = error ? (
    <p id={`${id}-error`} className="text-danger">
      {error}
    </p>
  ) : null;
  if (!ready) {
    return (
      <div className="flex flex-col gap-2">
        <label htmlFor={id} className="font-medium text-ink">
          Type your full name to sign
        </label>
        <input
          id={id}
          name="typedName"
          autoComplete="name"
          defaultValue={typedName ?? ''}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-error` : undefined}
          className="h-target-patient w-full rounded-control border border-line-control bg-surface px-4 text-lg text-ink aria-[invalid=true]:border-danger"
        />
        {message}
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span id={id} className="font-medium text-ink">
          Sign here
        </span>
        <button type="button" onClick={clear} className="text-ink-secondary underline">
          Clear
        </button>
      </div>
      <canvas
        ref={canvas}
        width={600}
        height={200}
        role="img"
        aria-labelledby={id}
        aria-describedby={error ? `${id}-error` : undefined}
        data-testid="signature-pad"
        onPointerDown={start}
        onPointerMove={move}
        onPointerUp={end}
        onPointerCancel={end}
        className={`h-40 w-full scroll-mb-28 touch-none rounded-control border bg-surface text-ink ${
          error ? 'border-danger' : 'border-line-control'
        }`}
      />
      <input type="hidden" name="signature" value={drawn} />
      {message}
    </div>
  );
}

/** The consent screen: the statements, the signature, Back and Next. */
export function ConsentScreenForm({
  token,
  screenKey,
  cards,
  signing,
  backHref,
}: {
  token: string;
  screenKey: string;
  cards: ConsentCard[];
  signing: ConsentSigning;
  backHref: string;
}) {
  const [state, action, pending] = useActionState(saveScreenAction, initialState);
  const values = state.values ?? {};
  const errors = state.errors ?? {};
  return (
    <form action={action} noValidate className="flex flex-col gap-6 pb-28">
      <input type="hidden" name="token" value={token} />
      <input type="hidden" name="screen" value={screenKey} />
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
          >
            <legend className="sr-only">{card.text}</legend>
            <p className="text-sm text-ink-muted">Version {card.version}</p>
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
        <SignaturePad
          error={errors.signature}
          typedName={typeof values.typedName === 'string' ? values.typedName : undefined}
        />
      </div>
      <div className="fixed inset-x-0 bottom-0 border-t border-line bg-surface px-4 py-3">
        <div className="mx-auto flex w-full max-w-signin gap-3">
          <Link href={backHref} className={patientSecondaryClass}>
            Back
          </Link>
          <button type="submit" disabled={pending} className={patientPrimaryClass}>
            Next
          </button>
        </div>
      </div>
    </form>
  );
}
