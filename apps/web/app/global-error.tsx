'use client';

import * as Sentry from '@sentry/nextjs';
import { useEffect } from 'react';
import { fontClasses } from './fonts';
import './globals.css';

// Shown when the app itself fails to render (FND-12). The error is reported, scrubbed of patient
// data (lib/monitoring/scrub.ts); the page says nothing about what went wrong.
export default function GlobalError({ error }: { error: Error & { digest?: string } }) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="en" className={fontClasses}>
      <body>
        <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-4 px-4 py-6">
          <h1 className="text-title font-semibold">Something went wrong</h1>
          <p className="text-ink-secondary">
            The page could not open. Reload it; if it happens again, tell the clinic manager.
          </p>
          {/* Primary button recipe, design system v2 section 8, as on the offline page. */}
          <button
            type="button"
            onClick={() => {
              window.location.reload();
            }}
            className="inline-flex h-row items-center justify-center rounded-control border border-transparent bg-accent px-3.5 font-medium text-on-accent shadow-xs transition-colors duration-[var(--duration-quick)] hover:bg-accent-hover pointer-coarse:h-row-touch"
          >
            Reload
          </button>
        </main>
      </body>
    </html>
  );
}
