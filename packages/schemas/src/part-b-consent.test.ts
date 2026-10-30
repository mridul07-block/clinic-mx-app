import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  modalityStatement,
  parsePartB,
  partBGate,
  partBStatements,
  partBStatementsFor,
  partBStatus,
  partBText,
} from './part-b-consent';

// BIL-03: Part B consent. The statements are the client's wording (Blueprint Module 3, Part B),
// pinned: a change is a new version, never an edit.
describe('Part B consent', () => {
  it('keeps the published wording', () => {
    const digest = createHash('sha256').update(JSON.stringify(partBStatements)).digest('hex');
    expect(digest).toBe('4c671a30c8c78192e810f06989ee7f2624e7f71e4aa08d5e6ce079ec6451ef30');
    for (const statement of Object.values(partBStatements)) {
      expect(statement.stage).toBe('B');
      expect(statement.text.length).toBeGreaterThan(20);
    }
  });

  it('asks the general terms always, package terms with a package, one card per planned modality', () => {
    const keys = (plan: { package: boolean; modalities: string[] }) =>
      partBStatementsFor(plan).map((statement) => statement.key);
    expect(keys({ package: false, modalities: [] })).toEqual([
      'part_b.plan',
      'part_b.right_to_decline',
    ]);
    expect(keys({ package: true, modalities: ['laser', 'pemf'] })).toEqual([
      'part_b.plan',
      'part_b.right_to_decline',
      'part_b.package_validity',
      'part_b.package_reschedule',
      'part_b.package_refund',
      'part_b.modality.laser',
      'part_b.modality.pemf',
    ]);
    // A modality without a card asks nothing.
    expect(keys({ package: false, modalities: ['unknown_thing'] })).toHaveLength(2);
    expect(modalityStatement('dry_needling')?.awaitingWording).toBe(true);
  });

  it('fills the plan statement from the consultation and the plan', () => {
    const plan = partBStatements['part_b.plan'];
    expect(partBText(plan, { diagnosis: 'Test diagnosis', modalities: ['Laser', 'PEMF'] })).toBe(
      'I understand the diagnosis (Test diagnosis) and the treatment plan explained to me, including exercise, the recovery process, and the physiotherapy interventions and modalities proposed to me (Laser, PEMF).',
    );
    expect(partBText(plan, { diagnosis: 'Test diagnosis', modalities: [] })).toMatch(
      /proposed to me\.$/,
    );
  });

  it('records declines unsigned and signs what is agreed', () => {
    const keys = ['part_b.plan', 'part_b.modality.laser'];
    expect(
      parsePartB(keys, { 'part_b.plan': 'decline', 'part_b.modality.laser': 'decline' }),
    ).toEqual({
      ok: true,
      decisions: { 'part_b.plan': false, 'part_b.modality.laser': false },
    });
    // One agreed: a signature is needed.
    expect(
      parsePartB(keys, { 'part_b.plan': 'agree', 'part_b.modality.laser': 'decline' }),
    ).toEqual({
      ok: false,
      errors: { signature: 'Please sign in the box.' },
    });
    expect(
      parsePartB(keys, {
        'part_b.plan': 'agree',
        'part_b.modality.laser': 'decline',
        typedName: 'Test Patient',
      }),
    ).toEqual({
      ok: true,
      decisions: { 'part_b.plan': true, 'part_b.modality.laser': false },
      signature: { kind: 'typed', name: 'Test Patient' },
    });
    expect(parsePartB(keys, { 'part_b.plan': 'agree' }).ok).toBe(false);
  });

  it('lets treatment start once all is decided, no general term and no package term declined', () => {
    const asked = partBStatementsFor({ package: true, modalities: ['laser'] });
    const all = (accepted: boolean) =>
      Object.fromEntries(asked.map((statement) => [statement.key, accepted]));
    const gate = (latest: Record<string, boolean>, choice = true) =>
      partBGate(partBStatus(asked, latest), { package: choice });
    expect(gate({})).toEqual({ met: false, message: 'Part B consent is needed.' });
    expect(gate(all(true)).met).toBe(true);
    // A declined modality leaves only that modality out.
    const laserDeclined = partBStatus(asked, { ...all(true), 'part_b.modality.laser': false });
    expect(laserDeclined.modalitiesDeclined).toEqual(['laser']);
    expect(partBGate(laserDeclined, { package: true }).met).toBe(true);
    expect(gate({ ...all(true), 'part_b.right_to_decline': false }).met).toBe(false);
    expect(gate({ ...all(true), 'part_b.package_refund': false }).message).toContain('package');
    // A package term declined, then per session chosen: the package terms no longer apply.
    const perSession = partBStatementsFor({ package: false, modalities: ['laser'] });
    expect(
      partBGate(partBStatus(perSession, { ...all(true), 'part_b.package_refund': false }), {
        package: false,
      }).met,
    ).toBe(true);
  });
});
