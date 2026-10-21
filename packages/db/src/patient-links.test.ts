import { describe, expect, it } from 'vitest';
import { readPatientLink, signPatientLink, type PatientLinkClaim } from './patient-links';

// IAM-09: a patient link is signed; any change to it, or another key, makes it not valid.
const secret = 'test-only-patient-link-secret-0123456789';
const other = 'another-test-only-patient-link-secret-xyz';
const claim: PatientLinkClaim = {
  linkId: '6f1c2b3a-4d5e-4f60-8a7b-9c0d1e2f3a4b',
  purpose: 'my_plan',
  expiresAt: new Date('2026-11-21T09:00:00Z'),
};

/** The token with one character changed at `index`. */
const changed = (token: string, index: number) =>
  token.slice(0, index) + (token[index] === 'A' ? 'B' : 'A') + token.slice(index + 1);

describe('patient link tokens', () => {
  it('carry the link, its purpose and its expiry, in about 51 URL safe characters', () => {
    const token = signPatientLink(claim, secret);
    expect(token).toMatch(/^[A-Za-z0-9_-]{51}$/);
    expect(readPatientLink(token, { current: secret })).toEqual(claim);
  });

  it('keep the expiry to the second', () => {
    const token = signPatientLink(
      { ...claim, expiresAt: new Date('2026-11-21T09:00:00.987Z') },
      secret,
    );
    expect(readPatientLink(token, { current: secret })?.expiresAt).toEqual(claim.expiresAt);
  });

  it('are refused when any character changes, in the payload or the signature', () => {
    const token = signPatientLink(claim, secret);
    for (let index = 0; index < token.length; index++) {
      expect(readPatientLink(changed(token, index), { current: secret }), String(index)).toBeNull();
    }
  });

  it('have one spelling: the spare bits of the last character must stay zero', () => {
    const token = signPatientLink(claim, secret);
    const last = token.charCodeAt(token.length - 1);
    // base64url letters: flipping the lowest bit changes only a spare bit of the last character.
    const respelled = token.slice(0, -1) + String.fromCharCode(last ^ 1);
    expect(Buffer.from(respelled, 'base64url')).toEqual(Buffer.from(token, 'base64url'));
    expect(readPatientLink(respelled, { current: secret })).toBeNull();
  });

  it('are refused under another key, and still read with the previous key while it rotates', () => {
    const token = signPatientLink(claim, other);
    expect(readPatientLink(token, { current: secret })).toBeNull();
    expect(readPatientLink(token, { current: secret, previous: other })).toEqual(claim);
  });

  it('refuse junk, wrong lengths and characters outside base64url', () => {
    const token = signPatientLink(claim, secret);
    for (const bad of [
      '',
      'abc',
      token.slice(0, -1),
      `${token}A`,
      `${token.slice(0, -1)}=`,
      'a/b+c',
    ]) {
      expect(readPatientLink(bad, { current: secret }), bad).toBeNull();
    }
  });

  it('refuse another version, even signed with the key', () => {
    const bytes = Buffer.from(signPatientLink(claim, secret), 'base64url');
    bytes.writeUInt8(2, 0);
    // Re-signing needs the internals, so a changed version byte with the old mac must fail.
    expect(readPatientLink(bytes.toString('base64url'), { current: secret })).toBeNull();
  });

  it('give each purpose its own token for the same link', () => {
    const plan = signPatientLink(claim, secret);
    const form = signPatientLink({ ...claim, purpose: 'health_form' }, secret);
    expect(form).not.toBe(plan);
    expect(readPatientLink(form, { current: secret })?.purpose).toBe('health_form');
  });
});
