'use client';

import { kioskStateSchema } from '@clinic-mx/schemas';
import { useEffect, useState } from 'react';

/**
 * How often the waiting tablet asks for a form. How the app works, not a business rule: the
 * front desk sees the form open within this time.
 */
const ASK_EVERY_MS = 3_000;

/**
 * The tablet waiting for a form (IAM-10). It asks the server every few seconds; when the front
 * desk has sent a form, it opens it in place of this page, so Back does not return here with the
 * form still in history.
 */
export function KioskWelcome({ centreName }: { centreName: string }) {
  const [ended, setEnded] = useState(false);

  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const ask = async () => {
      try {
        const response = await fetch('/kiosk/state', { cache: 'no-store' });
        const state = kioskStateSchema.safeParse(await response.json());
        if (stopped || !state.success) return;
        if (state.data.state === 'open') {
          window.location.replace(state.data.path);
          return;
        }
        if (state.data.state === 'ended') {
          setEnded(true);
          return;
        }
      } catch {
        // Offline for a moment: ask again.
      }
      if (!stopped) timer = setTimeout(() => void ask(), ASK_EVERY_MS);
    };
    void ask();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, []);

  if (ended) return <KioskEnded stopped />;
  return (
    <div className="flex flex-col items-center gap-3" data-testid="kiosk-welcome">
      <h1 className="text-title font-semibold text-ink">Welcome to Movementology Clinics</h1>
      <p className="text-lg text-ink-secondary">{centreName}</p>
      <p className="text-ink-secondary">The front desk will open your form here.</p>
    </div>
  );
}

/**
 * This browser is not a kiosk, or no longer one. Asking once removes a stopped tablet's cookie,
 * so staff can sign in on it again.
 */
export function KioskEnded({ stopped }: { stopped: boolean }) {
  useEffect(() => {
    if (stopped) void fetch('/kiosk/state', { cache: 'no-store' }).catch(() => undefined);
  }, [stopped]);
  return (
    <div className="flex flex-col items-center gap-3" data-testid="kiosk-ended">
      <h1 className="text-title font-semibold text-ink">
        {stopped ? 'This tablet is no longer a kiosk' : 'This tablet is not set up as a kiosk'}
      </h1>
      <p className="text-ink-secondary">
        Staff can set it up again from Kiosk tablets in Clinic Mx.
      </p>
      <a
        href="/app/sign-in"
        className="inline-flex h-target-patient items-center text-accent underline underline-offset-2"
      >
        Staff sign in
      </a>
    </div>
  );
}
