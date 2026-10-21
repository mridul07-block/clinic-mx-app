'use client';

import { useActionState } from 'react';
import { FormMessage, primaryButtonClass } from '../../../../../../components/forms';
import type { AuthFormState } from '../../../../../../modules/auth/actions';
import { finishTwoStepSetup } from '../../../../../../modules/auth/two-step-actions';
import { CodeInput } from '../../code-input';

const initialState: AuthFormState = {};

const secondaryButtonClass =
  'inline-flex h-row w-full items-center justify-center rounded-control border border-line-strong bg-surface px-3.5 font-medium text-ink shadow-xs transition-colors duration-[var(--duration-quick)] hover:border-line-control hover:bg-surface-hover pointer-coarse:h-row-touch';

/** The key in groups of four, easier to type into an authenticator app. */
const grouped = (secret: string) => secret.replace(/(.{4})(?=.)/g, '$1 ');

export function SetupForm({
  factorId,
  qrCode,
  secret,
  uri,
  next,
}: {
  factorId: string;
  /** An SVG data URL from Supabase Auth: drawn in the page, nothing is fetched. */
  qrCode: string;
  secret: string;
  uri: string;
  next: string;
}) {
  const [state, action, pending] = useActionState(finishTwoStepSetup, initialState);
  return (
    <form action={action} className="flex flex-col gap-5" noValidate>
      {state.error ? <FormMessage tone="danger">{state.error}</FormMessage> : null}
      <input type="hidden" name="factorId" value={factorId} />
      <input type="hidden" name="next" value={next} />

      <section className="flex flex-col gap-2">
        <h2 className="font-semibold text-ink">1. Get an authenticator app</h2>
        <p className="text-ink-secondary">
          Install one on your phone, such as Google Authenticator or Microsoft Authenticator.
        </p>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="font-semibold text-ink">2. Add Clinic Mx to it</h2>
        <p className="text-ink-secondary">
          On this phone, tap the button. On a computer, scan the code with your phone.
        </p>
        <a href={uri} className={secondaryButtonClass}>
          Add to authenticator app
        </a>
        {/* eslint-disable-next-line @next/next/no-img-element -- an inline SVG data URL; next/image cannot optimise it */}
        <img
          src={qrCode}
          alt="QR code to add Clinic Mx to an authenticator app"
          className="size-44 self-center rounded-control border border-line bg-surface p-2"
        />
        <p className="text-sm text-ink-muted">Or type this key:</p>
        <p className="text-md text-ink" data-testid="two-step-key">
          {grouped(secret)}
        </p>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="font-semibold text-ink">3. Enter the code it shows</h2>
        <CodeInput />
      </section>

      <button type="submit" disabled={pending} className={primaryButtonClass}>
        {pending ? 'Checking' : 'Turn on two step verification'}
      </button>
    </form>
  );
}
