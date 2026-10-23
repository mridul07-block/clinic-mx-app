import { beforeEach, describe, expect, it, vi } from 'vitest';
import { saveHealthFormScreen } from './services';

// INT-04: saving a health form screen. The link is checked first; then, as the patient, the visit
// must be on, the screen reachable and every shown field answered; answers a change has hidden
// are dropped, and a saved form keeps its version.
const fakeTx = { kind: 'transaction' };
const db = vi.hoisted(() => ({
  withPatientAccess: vi.fn(),
  healthFormVisit: vi.fn(),
  ownIntakeResponse: vi.fn(),
  saveIntakeResponse: vi.fn(),
  insertConsentRecords: vi.fn(),
  ownConsentDecisions: vi.fn(),
  ownGuardians: vi.fn(),
}));
vi.mock('@clinic-mx/db', () => db);
vi.mock('../../lib/db', () => ({ appDb: () => ({ kind: 'appDb' }) }));
const links = vi.hoisted(() => ({ verifyPatientLink: vi.fn() }));
vi.mock('../patient-links/services', () => links);
// Test value only; the real one is the `patients.adult_age_years` row.
vi.mock('../settings/settings', () => ({ getSetting: vi.fn(() => Promise.resolve(18)) }));

const appointmentId = '00000000-0000-4000-8000-000000000801';
const link = {
  id: '00000000-0000-4000-8000-000000000901',
  patientId: '00000000-0000-4000-8000-000000000501',
  purpose: 'health_form' as const,
  appointmentId,
  episodeId: null,
  expiresAt: new Date('2030-01-01T00:00:00Z'),
};
const visit = { appointmentId, status: 'checked_in', dateOfBirth: '1990-01-01' };
const guardianId = '00000000-0000-4000-8000-000000000a01';
const store = { put: vi.fn(), remove: vi.fn() };
/** A form on version 2 with Part A consent accepted and signed. */
const consented = {
  id: 'response',
  formVersion: 'hf-2',
  answers: {},
  doneScreens: ['consent'],
  submittedAt: null,
};
const save = (screen: string, posted: Record<string, string | string[]>) =>
  saveHealthFormScreen('token', screen, posted, undefined, store);
const agree = { 'part_a.screening': 'agree', 'part_a.contact': 'agree' };
const png = `data:image/png;base64,${Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(24),
]).toString('base64')}`;
const noToBack = Object.fromEntries(
  [
    'weight_loss',
    'fever_sweats',
    'night_pain',
    'cancer_history',
    'recent_infection_surgery',
    'immune_diabetes_steroids',
    'recent_trauma',
    'fatigue_weakness',
    'bowel_bladder_change',
    'saddle_numbness',
    'dizziness_balance',
    'progressive_weakness',
    'hot_swollen_joint',
    'calf_chest_breath',
    'rapidly_worsening',
    'back_bladder',
    'back_bowel',
    'back_saddle',
    'back_both_legs',
  ].map((key) => [key, 'no']),
);

describe('saving a health form screen', () => {
  beforeEach(() => {
    for (const fn of [...Object.values(db), ...Object.values(links), ...Object.values(store)]) {
      fn.mockReset();
    }
    db.withPatientAccess.mockImplementation(
      (_db: unknown, _context: unknown, work: (tx: unknown) => unknown) => work(fakeTx),
    );
    links.verifyPatientLink.mockResolvedValue({ status: 'valid', link });
    db.healthFormVisit.mockResolvedValue(visit);
    db.saveIntakeResponse.mockResolvedValue({ id: 'response' });
    db.ownGuardians.mockResolvedValue([]);
  });

  it('saves a screen after consent and opens the next one', async () => {
    db.ownIntakeResponse.mockResolvedValue(consented);
    expect(await save('problem', { region: 'back' })).toEqual({
      status: 'saved',
      next: 'warning_signs',
    });
    expect(db.withPatientAccess).toHaveBeenCalledWith(
      { kind: 'appDb' },
      { link, ip: undefined },
      expect.any(Function),
    );
    expect(db.saveIntakeResponse).toHaveBeenCalledWith(fakeTx, {
      appointmentId,
      patientId: link.patientId,
      patientLinkId: link.id,
      formVersion: 'hf-2',
      answers: { region: 'back' },
      doneScreens: ['consent', 'problem'],
    });
  });

  it('asks for every shown answer and saves nothing until then', async () => {
    db.ownIntakeResponse.mockResolvedValue(consented);
    expect(await save('problem', {})).toEqual({
      status: 'invalid',
      errors: { region: 'Answer this question.' },
    });
    expect(db.saveIntakeResponse).not.toHaveBeenCalled();
  });

  it('drops the answers a changed region has hidden, and keeps the saved version', async () => {
    db.ownIntakeResponse.mockResolvedValue({
      id: 'response',
      formVersion: 'hf-1',
      answers: {
        region: 'back',
        ...Object.fromEntries(Object.keys(noToBack).map((k) => [k, false])),
        morning_stiffness_minutes: 0,
      },
      doneScreens: ['problem', 'warning_signs'],
      submittedAt: null,
    });
    expect(await save('problem', { region: 'knee' })).toEqual({
      status: 'saved',
      next: 'warning_signs',
    });
    const saved = db.saveIntakeResponse.mock.calls[0]?.[1] as { answers: Record<string, unknown> };
    expect(saved.answers.region).toBe('knee');
    expect(saved.answers).not.toHaveProperty('back_bladder');
    expect(saved.answers.fever_sweats).toBe(false);
  });

  it('opens nothing before Part A consent, and no screen before the ones it follows', async () => {
    db.ownIntakeResponse.mockResolvedValue(undefined);
    expect(await save('problem', { region: 'back' })).toEqual({
      status: 'elsewhere',
      resume: 'consent',
    });
    db.ownIntakeResponse.mockResolvedValue(consented);
    expect(await save('warning_signs', noToBack)).toEqual({
      status: 'elsewhere',
      resume: 'problem',
    });
    expect(await save('no_such_screen', {})).toEqual({ status: 'elsewhere', resume: 'problem' });
    expect(db.saveIntakeResponse).not.toHaveBeenCalled();
  });

  it('saves nothing for a visit not on, or a link that is not a working health form link', async () => {
    db.healthFormVisit.mockResolvedValue({ ...visit, status: 'booked' });
    expect(await save('problem', { region: 'back' })).toEqual({
      status: 'closed',
    });
    links.verifyPatientLink.mockResolvedValue({ status: 'expired', purpose: 'health_form' });
    expect(await save('problem', { region: 'back' })).toEqual({
      status: 'link',
    });
    links.verifyPatientLink.mockResolvedValue({
      status: 'valid',
      link: { ...link, purpose: 'consent' },
    });
    expect(await save('problem', { region: 'back' })).toEqual({
      status: 'link',
    });
    expect(db.saveIntakeResponse).not.toHaveBeenCalled();
  });

  // INT-06: Part A consent.
  describe('Part A consent', () => {
    beforeEach(() => {
      db.ownIntakeResponse.mockResolvedValue(undefined);
    });

    it('records a decline, unsigned, and blocks the form', async () => {
      expect(
        await save('consent', { 'part_a.screening': 'agree', 'part_a.contact': 'decline' }),
      ).toEqual({ status: 'declined' });
      expect(db.insertConsentRecords).toHaveBeenCalledWith(fakeTx, [
        {
          patientId: link.patientId,
          appointmentId,
          patientLinkId: link.id,
          stage: 'A',
          signer: 'patient',
          guardianId: null,
          statementKey: 'part_a.contact',
          statementVersion: 1,
          accepted: false,
        },
      ]);
      expect(store.put).not.toHaveBeenCalled();
      expect(db.saveIntakeResponse).not.toHaveBeenCalled();
    });

    it('stores a drawn signature, records both statements and opens the questions', async () => {
      expect(await save('consent', { ...agree, signature: png })).toEqual({
        status: 'saved',
        next: 'problem',
      });
      const [path, bytes, type] = store.put.mock.calls[0] as [string, Uint8Array, string];
      expect(path.startsWith(`${link.patientId}/`) && path.endsWith('.png')).toBe(true);
      expect(bytes[0]).toBe(0x89);
      expect(type).toBe('image/png');
      const rows = db.insertConsentRecords.mock.calls[0]?.[1] as Record<string, unknown>[];
      expect(
        rows.map((r) => [r.statementKey, r.accepted, r.signatureKind, r.signatureFile]),
      ).toEqual([
        ['part_a.screening', true, 'drawn', path],
        ['part_a.contact', true, 'drawn', path],
      ]);
      expect(db.saveIntakeResponse).toHaveBeenCalledWith(
        fakeTx,
        expect.objectContaining({ formVersion: 'hf-2', doneScreens: ['consent'] }),
      );
      expect(store.remove).not.toHaveBeenCalled();
    });

    it('takes a typed name when the pad cannot run', async () => {
      await save('consent', { ...agree, typedName: 'Test Patient' });
      const rows = db.insertConsentRecords.mock.calls[0]?.[1] as Record<string, unknown>[];
      expect(rows.map((r) => [r.signatureKind, r.typedName, r.signatureFile])).toEqual([
        ['typed', 'Test Patient', null],
        ['typed', 'Test Patient', null],
      ]);
      expect(store.put).not.toHaveBeenCalled();
    });

    it('asks for a signature, and removes a stored one when recording does not happen', async () => {
      expect(await save('consent', agree)).toEqual({
        status: 'invalid',
        errors: { signature: 'Please sign in the box.' },
      });
      expect(await save('consent', { ...agree, signature: 'data:image/png;base64,QUJD' })).toEqual({
        status: 'invalid',
        errors: { signature: 'Please sign in the box.' },
      });
      // The visit closes between the check and the record: the stored signature goes.
      db.healthFormVisit
        .mockResolvedValueOnce(visit)
        .mockResolvedValueOnce({ ...visit, status: 'booked' });
      expect(await save('consent', { ...agree, signature: png })).toEqual({ status: 'closed' });
      expect(store.remove).toHaveBeenCalledWith([store.put.mock.calls[0]?.[0]]);
      expect(db.insertConsentRecords).not.toHaveBeenCalled();
    });
  });

  // INT-07: under the adult age a guardian on file signs; without a date of birth the screen asks.
  describe('who signs Part A', () => {
    beforeEach(() => {
      db.ownIntakeResponse.mockResolvedValue(undefined);
      db.ownGuardians.mockResolvedValue([
        { id: guardianId, name: 'Test Guardian', relationship: 'mother' },
      ]);
    });
    const minor = { ...visit, dateOfBirth: '2014-05-04' };
    const typed = { ...agree, typedName: 'Test Guardian' };
    const signers = () =>
      (db.insertConsentRecords.mock.calls[0]?.[1] as Record<string, unknown>[]).map((r) => [
        r.signer,
        r.guardianId,
      ]);

    it('has the guardian on file sign for a minor, never the minor', async () => {
      db.healthFormVisit.mockResolvedValue(minor);
      expect(await save('consent', typed)).toEqual({
        status: 'invalid',
        errors: { guardian: 'Choose who is signing.' },
      });
      expect(await save('consent', { ...typed, guardian: crypto.randomUUID() })).toEqual({
        status: 'invalid',
        errors: { guardian: 'Choose who is signing.' },
      });
      expect(db.insertConsentRecords).not.toHaveBeenCalled();
      expect(await save('consent', { ...typed, guardian: guardianId })).toEqual({
        status: 'saved',
        next: 'problem',
      });
      expect(signers()).toEqual([
        ['guardian', guardianId],
        ['guardian', guardianId],
      ]);
    });

    it('asks the age without a date of birth: no lets the patient sign', async () => {
      db.healthFormVisit.mockResolvedValue({ ...visit, dateOfBirth: null });
      expect(await save('consent', typed)).toEqual({
        status: 'invalid',
        errors: { minor: 'Answer this question.' },
      });
      await save('consent', { ...typed, minor: 'no' });
      expect(signers()).toEqual([
        ['patient', null],
        ['patient', null],
      ]);
    });

    it('asks for reception when a minor has no guardian on file, recording nothing', async () => {
      db.ownGuardians.mockResolvedValue([]);
      db.healthFormVisit.mockResolvedValue({ ...visit, dateOfBirth: null });
      expect(await save('consent', { ...typed, minor: 'yes' })).toEqual({
        status: 'guardian_needed',
      });
      db.healthFormVisit.mockResolvedValue(minor);
      expect(await save('consent', typed)).toEqual({ status: 'guardian_needed' });
      expect(db.insertConsentRecords).not.toHaveBeenCalled();
      expect(store.put).not.toHaveBeenCalled();
    });
  });
});
