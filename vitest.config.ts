import { defineConfig } from 'vitest/config';

// Unit tests for every workspace package that has its own vitest.config.ts.
export default defineConfig({
  test: {
    projects: ['packages/*/vitest.config.ts', 'apps/*/vitest.config.ts'],
  },
});
