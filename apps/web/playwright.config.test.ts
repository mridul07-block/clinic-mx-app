import { describe, expect, it } from 'vitest';

import config from './playwright.config';

describe('Playwright webServer', () => {
  // pnpm 12.6 runs scripts in their own process group. Playwright stops the web server
  // with SIGKILL to its process group, so a server started through pnpm survives,
  // keeps Playwright's output pipe open, and the run never finishes (CI hung on FND-01).
  it('starts Next.js directly, not through a package manager', () => {
    const servers = [config.webServer ?? []].flat();
    expect(servers.length).toBeGreaterThan(0);
    for (const server of servers) {
      expect(server.command).not.toMatch(/\b(pnpm|npm|yarn|npx|bun)\b/);
    }
  });
});
