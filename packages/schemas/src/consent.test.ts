import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  ANSWER_AGE,
  CHOOSE_ONE,
  CHOOSE_SIGNER,
  SIGN_HERE,
  TYPE_NAME,
  consentStatements,
  latestConsent,
  minorStatus,
  parseConsent,
  parseSigner,
  partAStatements,
  signatureMaxBytes,
} from './consent';

// INT-06: Part A consent. The statements are the client's wording, pinned; each needs a
// decision; agreeing to all needs a signature, drawn or typed; a decline needs none; the latest
// decision for each statement counts.
const png = (extra = 0) =>
  `data:image/png;base64,${Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.alloc(16 + extra),
  ]).toString('base64')}`;

describe('Part A consent', () => {
  it('keeps the client wording as published: a change is a new version', () => {
    const digest = createHash('sha256').update(JSON.stringify(consentStatements)).digest('hex');
    expect(digest).toBe('071e1405280c05967ebd5defa57e117d59075254b2759819b89ee729af3fecb2');
    expect(partAStatements.map((key) => consentStatements[key].version)).toEqual([1, 1]);
  });

  it('needs a decision on each statement', () => {
    expect(parseConsent(partAStatements, { 'part_a.screening': 'agree' })).toEqual({
      ok: false,
      errors: { 'part_a.contact': CHOOSE_ONE },
    });
  });

  it('records a decline without a signature', () => {
    expect(
      parseConsent(partAStatements, { 'part_a.screening': 'agree', 'part_a.contact': 'decline' }),
    ).toEqual({ ok: true, decisions: { 'part_a.screening': true, 'part_a.contact': false } });
  });

  it('needs a drawn or typed signature to agree to all', () => {
    const agree = { 'part_a.screening': 'agree', 'part_a.contact': 'agree' };
    expect(parseConsent(partAStatements, agree)).toEqual({
      ok: false,
      errors: { signature: SIGN_HERE },
    });
    expect(parseConsent(partAStatements, { ...agree, typedName: ' ' })).toEqual({
      ok: false,
      errors: { signature: TYPE_NAME },
    });
    expect(parseConsent(partAStatements, { ...agree, typedName: '  Test   Patient ' })).toEqual({
      ok: true,
      decisions: { 'part_a.screening': true, 'part_a.contact': true },
      signature: { kind: 'typed', name: 'Test Patient' },
    });
    const drawn = parseConsent(partAStatements, { ...agree, signature: png() });
    expect(drawn.ok && drawn.signature?.kind).toBe('drawn');
    for (const bad of [
      'data:image/jpeg;base64,AAAA',
      'data:image/png;base64,not base64!',
      `data:image/png;base64,${Buffer.from('GIF89a-not-a-png').toString('base64')}`,
      png(signatureMaxBytes),
    ]) {
      expect(parseConsent(partAStatements, { ...agree, signature: bad })).toEqual({
        ok: false,
        errors: { signature: SIGN_HERE },
      });
    }
  });

  it('counts the latest decision for each statement', () => {
    const at = (minutes: number) => new Date(Date.UTC(2026, 9, 23, 10, minutes));
    const declined = [
      { statementKey: 'part_a.screening', accepted: true, createdAt: at(0) },
      { statementKey: 'part_a.contact', accepted: false, createdAt: at(0) },
    ];
    expect(latestConsent(declined)).toEqual({
      latest: { 'part_a.screening': true, 'part_a.contact': false },
      declined: true,
    });
    const changed = [
      ...declined,
      { statementKey: 'part_a.screening', accepted: true, createdAt: at(2) },
      { statementKey: 'part_a.contact', accepted: true, createdAt: at(2) },
    ];
    expect(latestConsent(changed).declined).toBe(false);
    expect(latestConsent([]).declined).toBe(false);
  });
});

// INT-07: under the adult age a guardian on file signs; without a date of birth the screen asks.
describe('who signs Part A', () => {
  const guardianIds = ['00000000-0000-4000-8000-000000000a01'];

  it('knows a minor from the date of birth and the adult age, or does not know', () => {
    expect(minorStatus('2014-10-24', 18, '2026-10-23')).toBe('minor');
    expect(minorStatus('2008-10-23', 18, '2026-10-23')).toBe('adult');
    expect(minorStatus('2008-10-24', 18, '2026-10-23')).toBe('minor');
    expect(minorStatus(null, 18, '2026-10-23')).toBe('unknown');
  });

  it('lets an adult sign, and asks when the age is unknown', () => {
    expect(parseSigner({ status: 'adult', guardianIds }, {})).toEqual({
      ok: true,
      signer: 'patient',
    });
    expect(parseSigner({ status: 'unknown', guardianIds }, {})).toEqual({
      ok: false,
      errors: { minor: ANSWER_AGE },
    });
    expect(parseSigner({ status: 'unknown', guardianIds }, { minor: 'no' })).toEqual({
      ok: true,
      signer: 'patient',
    });
  });

  it('has a guardian on file sign for a minor, or asks for reception without one', () => {
    for (const [status, posted] of [
      ['minor', {}],
      ['unknown', { minor: 'yes' }],
    ] as const) {
      expect(parseSigner({ status, guardianIds }, posted)).toEqual({
        ok: false,
        errors: { guardian: CHOOSE_SIGNER },
      });
      expect(parseSigner({ status, guardianIds }, { ...posted, guardian: guardianIds[0] })).toEqual(
        { ok: true, signer: 'guardian', guardianId: guardianIds[0] },
      );
      expect(
        parseSigner({ status, guardianIds }, { ...posted, guardian: crypto.randomUUID() }),
      ).toEqual({ ok: false, errors: { guardian: CHOOSE_SIGNER } });
      expect(parseSigner({ status, guardianIds: [] }, posted)).toEqual({
        ok: false,
        guardianNeeded: true,
      });
    }
  });
});
