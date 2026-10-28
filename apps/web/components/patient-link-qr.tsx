'use client';

import { formatIstDateTime } from '@clinic-mx/schemas';
import QRCode from 'qrcode';
import { useActionState, useEffect, useState } from 'react';
import { FormMessage, secondaryButtonClass } from './forms';

/** What a patient link QR shows after a post: the page to open, already answered, or why not. */
export interface PatientLinkQrState {
  error?: string;
  received?: boolean;
  path?: string;
  expiresAt?: string;
}

const initialState: PatientLinkQrState = {};

/**
 * A patient link shown as a QR at the desk (PAT-01 My plan, PAT-04 Rate your visit): until
 * WhatsApp sends it, the patient scans it with their phone camera. The button posts to `action`
 * with `fields`; the QR is drawn in the browser from `origin` (from the server, as the form also
 * posts before hydration) and the link's path, with its last moment. `id` names the section and
 * its test ids (`<id>-qr`, `<id>-path`).
 */
export function PatientLinkQr({
  id,
  title,
  description,
  buttonLabel,
  alt,
  receivedText,
  action: post,
  fields,
  origin,
}: {
  id: string;
  title: string;
  description: string;
  buttonLabel: string;
  alt: string;
  receivedText?: string;
  action: (state: PatientLinkQrState, form: FormData) => Promise<PatientLinkQrState>;
  fields: Record<string, string>;
  origin: string;
}) {
  const [state, action, pending] = useActionState(post, initialState);
  const [image, setImage] = useState<string | null>(null);
  const url = state.path ? `${origin}${state.path}` : null;
  useEffect(() => {
    if (!url) return;
    let live = true;
    void QRCode.toString(url, { type: 'svg', margin: 2, errorCorrectionLevel: 'M' }).then((svg) => {
      if (live) setImage(`data:image/svg+xml;utf8,${encodeURIComponent(svg)}`);
    });
    return () => {
      live = false;
    };
  }, [url]);
  const heading = `${id}-qr-heading`;
  return (
    <section aria-labelledby={heading} className="flex flex-col gap-2" data-testid={`${id}-qr`}>
      <h2 id={heading} className="font-semibold text-ink">
        {title}
      </h2>
      <p className="text-sm text-ink-secondary">{description}</p>
      {state.error ? <FormMessage tone="danger">{state.error}</FormMessage> : null}
      {state.received && receivedText ? (
        <p className="text-ink" role="status" data-testid={`${id}-received`}>
          {receivedText}
        </p>
      ) : url && image && state.expiresAt ? (
        <figure className="flex flex-col items-center gap-2 rounded-panel border border-line bg-surface p-4">
          {/* eslint-disable-next-line @next/next/no-img-element -- an SVG data URL drawn here; next/image cannot optimise it */}
          <img src={image} alt={alt} width={240} height={240} className="size-60" />
          <figcaption className="text-center text-sm text-ink-secondary">
            Works until {formatIstDateTime(new Date(state.expiresAt))}.
            <span
              className="mt-1 block font-mono text-xs break-all text-ink-muted"
              data-testid={`${id}-path`}
            >
              {state.path}
            </span>
          </figcaption>
        </figure>
      ) : (
        <form action={action}>
          {Object.entries(fields).map(([name, value]) => (
            <input key={name} type="hidden" name={name} value={value} />
          ))}
          <button type="submit" disabled={pending} className={`${secondaryButtonClass} sm:w-auto`}>
            {buttonLabel}
          </button>
        </form>
      )}
    </section>
  );
}
