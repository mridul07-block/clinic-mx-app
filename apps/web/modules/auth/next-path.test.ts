import { describe, expect, it } from 'vitest';
import { publicStaffPath, safeNextPath } from './next-path';

describe('safeNextPath', () => {
  it('returns to the staff page that was asked for', () => {
    expect(safeNextPath('/app/calendar?day=2026-10-21')).toBe('/app/calendar?day=2026-10-21');
    expect(safeNextPath('/app')).toBe('/app');
  });

  it('never leaves the staff app', () => {
    for (const next of [
      'https://evil.example/app',
      '//evil.example/app',
      '/\\evil.example',
      '/app\\..\\evil',
      'javascript:alert(1)',
      '/p/some-token',
      '/application',
      '',
      null,
      42,
    ]) {
      expect(safeNextPath(next)).toBe('/app');
    }
  });

  it('never returns to a sign in page', () => {
    expect(safeNextPath('/app/sign-in')).toBe('/app');
    expect(safeNextPath('/app/reset-password?token_hash=x')).toBe('/app');
    expect(safeNextPath('/app/two-step')).toBe('/app');
    expect(safeNextPath('/app/two-step/setup?next=%2Fapp')).toBe('/app');
  });
});

describe('publicStaffPath', () => {
  it('opens only the sign in, reset and offline pages without a session', () => {
    expect(publicStaffPath.test('/app/sign-in')).toBe(true);
    expect(publicStaffPath.test('/app/forgot-password')).toBe(true);
    expect(publicStaffPath.test('/app/reset-password')).toBe(true);
    expect(publicStaffPath.test('/app/offline')).toBe(true);
    expect(publicStaffPath.test('/app')).toBe(false);
    expect(publicStaffPath.test('/app/sign-in-as-admin')).toBe(false);
    expect(publicStaffPath.test('/app/patients')).toBe(false);
  });
});
