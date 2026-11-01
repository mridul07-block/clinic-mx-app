'use client';

import { Button } from '@clinic-mx/ui/components/button';
import { ErrorState } from '@clinic-mx/ui/components/error-state';
import * as Sentry from '@sentry/nextjs';
import { useEffect } from 'react';

/** The digest Next gives a server error, matching the server logs; none for browser errors. */
function digestOf(error: unknown): string | undefined {
  if (error instanceof Error && 'digest' in error && typeof error.digest === 'string') {
    return error.digest;
  }
  return undefined;
}

// A patient page or the kiosk failing to render (UIX-11), in the patient voice: 16 px, plain
// words, a calm grey well (nothing alarming), the gold action and no staff links. The error is
// reported, scrubbed of patient data (lib/monitoring/scrub.ts).
export default function PatientError({ error, retry }: { error: unknown; retry: () => void }) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <main data-voice="patient" className="min-h-dvh bg-surface px-4 py-6">
      <div className="mx-auto flex w-full max-w-[40rem] flex-col gap-6">
        <p className="font-semibold text-ink-secondary">Movementology Clinics</p>
        <ErrorState
          kind="error"
          calm
          title="This page did not open"
          reference={digestOf(error)}
          action={
            <Button variant="patient" size="lg" onClick={retry}>
              Try again
            </Button>
          }
        >
          Please try again. If it still does not open, show this page to the clinic team and they
          will help.
        </ErrorState>
      </div>
    </main>
  );
}
