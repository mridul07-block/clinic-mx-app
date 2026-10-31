import { describe, expect, it } from 'vitest';
import { signLiveToken, verifyLiveToken } from '../src/token';

// FND-09: the connect token the app signs and the relay checks. Generated ids only.
const secret = 't'.repeat(40);
const now = Date.parse('2026-10-31T12:00:00Z');
const claims = {
  staffId: '00000000-0000-4000-8000-0000000000a1',
  centres: ['00000000-0000-4000-8000-000000000101', '00000000-0000-4000-8000-000000000102'],
  expiresAt: now + 60_000,
};

describe('the live relay token', () => {
  it('carries who and which centres, until it expires', async () => {
    const token = await signLiveToken(claims, secret);
    expect(await verifyLiveToken(token, secret, now)).toEqual(claims);
    expect(await verifyLiveToken(token, secret, claims.expiresAt)).toBeNull();
  });

  it('is refused with another secret, changed, or not a token at all', async () => {
    const token = await signLiveToken(claims, secret);
    expect(await verifyLiveToken(token, 'u'.repeat(40), now)).toBeNull();
    const [body, signature] = token.split('.');
    const other = await signLiveToken({ ...claims, centres: [claims.centres[0] ?? ''] }, secret);
    const [otherBody] = other.split('.');
    expect(await verifyLiveToken([otherBody, signature].join('.'), secret, now)).toBeNull();
    expect(await verifyLiveToken([body, signature, 'x'].join('.'), secret, now)).toBeNull();
    for (const junk of ['', '.', 'abc', 'a.b', '%%%.%%%', [body, ''].join('.')]) {
      expect(await verifyLiveToken(junk, secret, now)).toBeNull();
    }
  });

  it('names only real ids, and needs a long secret', async () => {
    const bad = await signLiveToken({ ...claims, centres: ['HSR Layout'] }, secret);
    expect(await verifyLiveToken(bad, secret, now)).toBeNull();
    const many = await signLiveToken(
      { ...claims, centres: Array.from({ length: 21 }, () => crypto.randomUUID()) },
      secret,
    );
    expect(await verifyLiveToken(many, secret, now)).toBeNull();
    await expect(signLiveToken(claims, 'short')).rejects.toThrow('too short');
  });
});
