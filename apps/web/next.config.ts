import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
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
    ]);
  },
};

export default nextConfig;
