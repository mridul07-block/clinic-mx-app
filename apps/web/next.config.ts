import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Workspace packages export TypeScript source; Next compiles them with the app.
  transpilePackages: ['@clinic-mx/schemas', '@clinic-mx/ui', '@clinic-mx/db'],
};

export default nextConfig;
