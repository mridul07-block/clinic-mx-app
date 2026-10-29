import { withSentryConfig } from '@sentry/nextjs/config';
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // proxy.ts sees requests as sent, router headers included, so it can tell a link prefetch from a
  // page someone opened: IAM-07 activity and the IAM-08 log of what Velyx support opened. It
  // drops the router's `_rsc` query itself.
  skipProxyUrlNormalize: true,
  // Workspace packages export TypeScript source; Next compiles them with the app.
  transpilePackages: ['@clinic-mx/schemas', '@clinic-mx/ui', '@clinic-mx/db'],
  // Report photos and scans are posted to a server action (INT-02): up to `reports.max_file_mb`
  // (at most 4 MB, the hosted request limit), so the default 1 MB body is too small.
  experimental: {
    serverActions: { bodySizeLimit: '5mb' },
  },
  // The PDF fonts are read from disk when a document is rendered (ALT-05): ship them with the
  // functions that render, the letterhead preview, the paper forms (OPS-05) and the jobs that
  // generate documents.
  outputFileTracingIncludes: {
    '/app/centres/[centreId]/letterhead': ['./modules/documents/fonts/*'],
    '/app/centres/[centreId]/paper-forms': ['./modules/documents/fonts/*'],
    '/api/jobs/tick': ['./modules/documents/fonts/*'],
  },
  env: {
    // The service worker URL carries the build's commit, so each deployment updates it.
    NEXT_PUBLIC_BUILD_ID: process.env.VERCEL_GIT_COMMIT_SHA ?? 'local',
    // The environment the browser's error reports carry (FND-12).
    NEXT_PUBLIC_DEPLOY_ENV: process.env.VERCEL_ENV ?? 'local',
  },
  headers() {
    return Promise.resolve([
      {
        // Browsers must always fetch the latest service worker script.
        source: '/sw.js',
        headers: [
          { key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' },
          { key: 'Content-Type', value: 'application/javascript; charset=utf-8' },
        ],
      },
      {
        // Patient links (IAM-09): the token in the address never goes on to another site, the
        // page is never kept by a browser or proxy cache, and search engines leave it alone.
        // same-origin, not no-referrer (INT-04): a plain form post must carry its own origin,
        // or the server refuses the health form's server action without scripts.
        source: '/p/:path*',
        headers: [
          { key: 'Referrer-Policy', value: 'same-origin' },
          { key: 'Cache-Control', value: 'private, no-store' },
          { key: 'X-Robots-Tag', value: 'noindex, nofollow' },
        ],
      },
      {
        // The clinic tablet's welcome screen and its state (IAM-10): the same, so the form it
        // opens is never kept or passed on.
        source: '/kiosk/:path*',
        headers: [
          { key: 'Referrer-Policy', value: 'same-origin' },
          { key: 'Cache-Control', value: 'private, no-store' },
          { key: 'X-Robots-Tag', value: 'noindex, nofollow' },
        ],
      },
    ]);
  },
};

// Error reports (FND-12, docs/runbooks/monitoring.md). The browser posts them to /monitoring on our
// own domain, which forwards them to Sentry, so no page calls sentry.io. Source maps are uploaded
// (and removed from the deployment) only when the build has SENTRY_AUTH_TOKEN.
export default withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  tunnelRoute: '/monitoring',
  telemetry: false,
  silent: true,
  sourcemaps: { disable: !process.env.SENTRY_AUTH_TOKEN, deleteSourcemapsAfterUpload: true },
  // Errors only: no tracing, so no router transition spans or route names.
  suppressOnRouterTransitionStartWarning: true,
  routeManifestInjection: false,
});
