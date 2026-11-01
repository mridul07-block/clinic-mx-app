'use client';

import { Button } from '@clinic-mx/ui/components/button';
import { ErrorState } from '@clinic-mx/ui/components/error-state';
import { Page } from '@clinic-mx/ui/components/page';
import * as Sentry from '@sentry/nextjs';
import { useEffect } from 'react';

/** The digest Next gives a server error, matching the server logs; none for browser errors. */
function digestOf(error: unknown): string | undefined {
  if (error instanceof Error && 'digest' in error && typeof error.digest === 'string') {
    return error.digest;
  }
  return undefined;
}

// A signed in page that fails to render (UIX-11), inside the navigation and the sheet so the
// person can go elsewhere. The error is reported, scrubbed of patient data
// (lib/monitoring/scrub.ts); the page shows only a reference, never the error itself. "Load
// again" fetches and renders the page again.
export default function SignedInError({ error, retry }: { error: unknown; retry: () => void }) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <Page width="form">
      <ErrorState
        kind="error"
        title="This page did not open"
        reference={digestOf(error)}
        action={<Button onClick={retry}>Load again</Button>}
      >
        Load it again. If it still does not open, tell the clinic manager and give them the
        reference below.
      </ErrorState>
    </Page>
  );
}
