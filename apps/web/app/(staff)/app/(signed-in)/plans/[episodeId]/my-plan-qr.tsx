'use client';

import { formatIstDateTime } from '@clinic-mx/schemas';
import QRCode from 'qrcode';
import { useActionState, useEffect, useState } from 'react';
import { FormMessage, secondaryButtonClass } from '../../../../../../components/forms';
import {
  showMyPlanAction,
  type MyPlanQrState,
} from '../../../../../../modules/patient-links/actions';

const initialState: MyPlanQrState = {};

/**
 * Show My plan QR (PAT-01): until WhatsApp sends it, the patient scans their My plan link at the
 * desk with their phone camera. The episode's working link, or a new one; it works for
 * `links.my_plan_days`. `origin` comes from the server (the form also posts before hydration).
 */
export function MyPlanQr({ episodeId, origin }: { episodeId: string; origin: string }) {
  const [state, action, pending] = useActionState(showMyPlanAction, initialState);
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
  return (
    <section aria-labelledby="my-plan-qr" className="flex flex-col gap-2" data-testid="my-plan-qr">
      <h2 id="my-plan-qr" className="font-semibold text-ink">
        My plan for the patient
      </h2>
      <p className="text-sm text-ink-secondary">
        The patient&apos;s page with their next visit, exercises, package and pain. They scan it
        with their phone camera.
      </p>
      {state.error ? <FormMessage tone="danger">{state.error}</FormMessage> : null}
      {url && image && state.expiresAt ? (
        <figure className="flex flex-col items-center gap-2 rounded-panel border border-line bg-surface p-4">
          {/* eslint-disable-next-line @next/next/no-img-element -- an SVG data URL drawn here; next/image cannot optimise it */}
          <img
            src={image}
            alt="QR code for the patient’s My plan"
            width={240}
            height={240}
            className="size-60"
          />
          <figcaption className="text-center text-sm text-ink-secondary">
            Works until {formatIstDateTime(new Date(state.expiresAt))}.
            <span
              className="mt-1 block font-mono text-xs break-all text-ink-muted"
              data-testid="my-plan-path"
            >
              {state.path}
            </span>
          </figcaption>
        </figure>
      ) : (
        <form action={action}>
          <input type="hidden" name="episodeId" value={episodeId} />
          <button type="submit" disabled={pending} className={`${secondaryButtonClass} sm:w-auto`}>
            Show My plan QR
          </button>
        </form>
      )}
    </section>
  );
}
