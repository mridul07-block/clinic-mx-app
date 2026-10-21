import { fileURLToPath } from 'node:url';
import { defineProject } from 'vitest/config';

export default defineProject({
  resolve: {
    // `server-only` throws outside React server code; unit tests run server modules directly.
    alias: { 'server-only': fileURLToPath(new URL('./test/server-only.ts', import.meta.url)) },
  },
  test: {
    name: 'web',
    environment: 'node',
    include: ['{app,lib,modules}/**/*.test.{ts,tsx}', 'playwright.config.test.ts'],
  },
});
