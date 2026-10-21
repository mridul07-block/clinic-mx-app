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
  env: {
    // The service worker URL carries the build's commit, so each deployment updates it.
    NEXT_PUBLIC_BUILD_ID: process.env.VERCEL_GIT_COMMIT_SHA ?? 'local',
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
        source: '/p/:path*',
        headers: [
          { key: 'Referrer-Policy', value: 'no-referrer' },
          { key: 'Cache-Control', value: 'private, no-store' },
          { key: 'X-Robots-Tag', value: 'noindex, nofollow' },
        ],
      },
    ]);
  },
};

export default nextConfig;
