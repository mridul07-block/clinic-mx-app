import { beforeEach, describe, expect, it, vi } from 'vitest';
import { healthForms, visibleFields } from '@clinic-mx/schemas';
import { reviewHealthFormDetails, saveHealthFormScreen, submitHealthForm } from './services';

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
  insertPatientReport: vi.fn(),
  submitIntakeResponse: vi.fn(),
  enqueueIntakeSubmitted: vi.fn(),
  healthFormCarrySource: vi.fn(),
  saveDetailsReview: vi.fn(),
}));
const pipeline = vi.hoisted(() => ({
  processIntakeSubmission: vi.fn(),
  prepareSheetNow: vi.fn(),
}));
const later = vi.hoisted(() => ({ after: vi.fn() }));
vi.mock('next/server', () => later);
vi.mock('./pipeline', () => pipeline);
vi.mock('@clinic-mx/db', () => db);
vi.mock('../../lib/db', () => ({ appDb: () => ({ kind: 'appDb' }) }));
const links = vi.hoisted(() => ({ verifyPatientLink: vi.fn(), completePatientLink: vi.fn() }));
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
const reportFiles = { put: vi.fn(), remove: vi.fn(), get: vi.fn() };
/** A form on version 2 with Part A consent accepted and signed. */
const consented = {
  id: 'response',
  formVersion: 'hf-2',
  answers: {},
  doneScreens: ['consent'],
  submittedAt: null,
};
const save = (screen: string, posted: Record<string, string | string[]>) =>
  saveHealthFormScreen('token', screen, posted, { signatures: store });
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
    for (const fn of [
      ...Object.values(db),
      ...Object.values(links),
      ...Object.values(store),
      ...Object.values(reportFiles),
      ...Object.values(pipeline),
    ]) {
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
        next: 'about_you',
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
        expect.objectContaining({ formVersion: 'hf-3', doneScreens: ['consent'] }),
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
        next: 'about_you',
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

  // INT-05: report photos on History and Check and submit.
  describe('on version 3', () => {
    const all = ['consent', 'about_you', 'problem', 'warning_signs', 'health_check', 'activity'];
    const atHistory = {
      id: 'response',
      formVersion: 'hf-3',
      answers: {
        sex: 'female',
        region: 'knee',
        // Every warning sign shown for a knee answered no (numbers 0).
        ...Object.fromEntries(
          visibleFields(
            healthForms['hf-3']?.screens.find((screen) => screen.key === 'warning_signs') ??
              ({ fields: [] } as never),
            { region: 'knee' },
          ).map((field) => [field.key, field.kind === 'number' ? 0 : false]),
        ),
        health_conditions: ['none'],
      },
      doneScreens: all,
      submittedAt: null,
    };
    const photo = (bytes: number[], type = 'image/png', name = 'report.png') =>
      new File([new Uint8Array([...bytes, ...new Array<number>(20).fill(0)])], name, { type });
    const pngBytes = [0x89, 0x50, 0x4e, 0x47];
    const withFiles = (files: File[], posted: Record<string, string> = {}) =>
      saveHealthFormScreen('token', 'history', posted, { files, reports: reportFiles });

    it('stores a report photo, then records it with the screen as the patient', async () => {
      db.ownIntakeResponse.mockResolvedValue(atHistory);
      expect(await withFiles([photo(pngBytes)], { injuries: 'Sprain' })).toEqual({
        status: 'saved',
        next: 'end',
      });
      expect(reportFiles.put).toHaveBeenCalledTimes(1);
      const [path, , type] = reportFiles.put.mock.calls[0] as [string, Uint8Array, string];
      expect(path.startsWith(`${link.patientId}/`) && path.endsWith('.png')).toBe(true);
      expect(type).toBe('image/png');
      expect(db.insertPatientReport).toHaveBeenCalledWith(fakeTx, {
        id: expect.any(String) as string,
        filePath: path,
        contentType: 'image/png',
        sizeBytes: 24,
        patientId: link.patientId,
        appointmentId,
        patientLinkId: link.id,
      });
      expect(reportFiles.remove).not.toHaveBeenCalled();
    });

    it('refuses a file that is not a photo or PDF, storing nothing', async () => {
      db.ownIntakeResponse.mockResolvedValue(atHistory);
      expect(await withFiles([photo([0x47, 0x49, 0x46], 'image/png', 'fake.png')])).toEqual({
        status: 'invalid',
        errors: { reports: 'fake.png is not a photo or PDF.' },
      });
      expect(await withFiles([photo(pngBytes, 'image/gif', 'a.gif')])).toEqual({
        status: 'invalid',
        errors: { reports: 'a.gif is not a photo or PDF.' },
      });
      expect(reportFiles.put).not.toHaveBeenCalled();
      expect(db.saveIntakeResponse).not.toHaveBeenCalled();
    });

    it('removes the stored photo when recording fails', async () => {
      db.ownIntakeResponse.mockResolvedValue(atHistory);
      db.insertPatientReport.mockRejectedValueOnce(new Error('refused'));
      await expect(withFiles([photo(pngBytes)])).rejects.toThrow('refused');
      const [path] = reportFiles.put.mock.calls[0] as [string];
      expect(reportFiles.remove).toHaveBeenCalledWith([path]);
    });

    it('takes no photos on another screen', async () => {
      db.ownIntakeResponse.mockResolvedValue({ ...atHistory, doneScreens: all.slice(0, 5) });
      expect(
        await saveHealthFormScreen(
          'token',
          'activity',
          {},
          { files: [photo(pngBytes)], reports: reportFiles },
        ),
      ).toEqual({ status: 'saved', next: 'history' });
      expect(reportFiles.put).not.toHaveBeenCalled();
      expect(db.insertPatientReport).not.toHaveBeenCalled();
    });

    it('submits once every screen is complete, and completes the link', async () => {
      db.ownIntakeResponse.mockResolvedValue({ ...atHistory, doneScreens: [...all, 'history'] });
      db.submitIntakeResponse.mockResolvedValue(true);
      expect(await submitHealthForm('token')).toEqual({ status: 'submitted' });
      expect(db.submitIntakeResponse).toHaveBeenCalledWith(fakeTx);
      expect(links.completePatientLink).toHaveBeenCalledWith(fakeTx, link);
      // INT-10: the pipeline is queued with the submit, then run straight after it.
      expect(db.enqueueIntakeSubmitted).toHaveBeenCalledWith(fakeTx, appointmentId);
      expect(pipeline.processIntakeSubmission).toHaveBeenCalledWith(appointmentId);
    });

    it('makes the AI preparation sheet after the answer, for the episode (AI-03)', async () => {
      db.ownIntakeResponse.mockResolvedValue({ ...atHistory, doneScreens: [...all, 'history'] });
      db.submitIntakeResponse.mockResolvedValue(true);
      pipeline.processIntakeSubmission.mockResolvedValueOnce({
        status: 'already',
        episodeId: 'e-1',
      });
      later.after.mockClear();
      expect(await submitHealthForm('token')).toEqual({ status: 'submitted' });
      expect(later.after).toHaveBeenCalledTimes(1);
      const [task] = later.after.mock.calls[0] as [() => Promise<void>];
      await task();
      expect(pipeline.prepareSheetNow).toHaveBeenCalledWith('e-1');
    });

    it('keeps the submit when the pipeline fails: its job runs it again', async () => {
      db.ownIntakeResponse.mockResolvedValue({ ...atHistory, doneScreens: [...all, 'history'] });
      db.submitIntakeResponse.mockResolvedValue(true);
      pipeline.processIntakeSubmission.mockRejectedValueOnce(new Error('database away'));
      expect(await submitHealthForm('token')).toEqual({ status: 'submitted' });
      expect(db.enqueueIntakeSubmitted).toHaveBeenCalledTimes(1);
    });

    it('does not submit before the end, after the visit, or twice', async () => {
      db.ownIntakeResponse.mockResolvedValue(atHistory);
      expect(await submitHealthForm('token')).toEqual({ status: 'elsewhere', resume: 'history' });
      db.healthFormVisit.mockResolvedValue({ ...visit, status: 'completed' });
      expect(await submitHealthForm('token')).toEqual({ status: 'closed' });
      expect(db.submitIntakeResponse).not.toHaveBeenCalled();
      links.verifyPatientLink.mockResolvedValue({ status: 'used', purpose: 'health_form' });
      expect(await submitHealthForm('token')).toEqual({ status: 'submitted' });
      expect(links.completePatientLink).not.toHaveBeenCalled();
      expect(pipeline.processIntakeSubmission).not.toHaveBeenCalled();
    });
  });

  // INT-08: a returning patient answers "Has anything changed?" after Part A, before anything else.
  describe('a returning patient', () => {
    const sourceId = '00000000-0000-4000-8000-000000000802';
    const source = {
      id: sourceId,
      submittedAt: new Date('2026-06-01T05:00:00Z'),
      answers: { sex: 'female', dominant_side: 'right', injuries: 'Ankle sprain' },
    };
    const started = {
      ...consented,
      formVersion: 'hf-3',
      carriedFromId: null,
      detailsChanged: null,
    };
    const review = (changed: boolean) => reviewHealthFormDetails('token', changed);

    beforeEach(() => {
      db.healthFormCarrySource.mockResolvedValue(source);
      db.saveDetailsReview.mockResolvedValue(true);
    });

    it('saves no other screen, and submits nothing, until the review is answered', async () => {
      db.ownIntakeResponse.mockResolvedValue(started);
      expect(await save('about_you', { sex: 'female' })).toEqual({
        status: 'elsewhere',
        resume: 'changes',
      });
      expect(await submitHealthForm('token')).toEqual({ status: 'elsewhere', resume: 'changes' });
      expect(db.saveIntakeResponse).not.toHaveBeenCalled();
      expect(db.submitIntakeResponse).not.toHaveBeenCalled();
    });

    it('No changes keeps the details and counts About you and History as sent', async () => {
      db.ownIntakeResponse.mockResolvedValue(started);
      expect(await review(false)).toEqual({ status: 'saved', next: 'problem' });
      expect(db.saveDetailsReview).toHaveBeenCalledWith(fakeTx, {
        carriedFromId: sourceId,
        detailsChanged: false,
        // The date of birth on the record joins them (INT-05: the record wins).
        answers: {
          date_of_birth: '1990-01-01',
          sex: 'female',
          dominant_side: 'right',
          injuries: 'Ankle sprain',
        },
        doneScreens: ['consent', 'about_you', 'history'],
      });
      // The months come from the setting; the earlier form is found again, as the patient.
      expect(db.healthFormCarrySource).toHaveBeenCalledWith(
        fakeTx,
        expect.arrayContaining(['dominant_side', 'injuries']),
        18,
        null,
      );
    });

    it('Something changed opens the carried screens again, filled in', async () => {
      const carried = {
        date_of_birth: '1990-01-01',
        sex: 'female',
        dominant_side: 'right',
        injuries: 'Ankle sprain',
      };
      db.ownIntakeResponse.mockResolvedValue({
        ...started,
        answers: carried,
        doneScreens: ['consent', 'about_you', 'history'],
        carriedFromId: sourceId,
        detailsChanged: false,
      });
      expect(await review(true)).toEqual({ status: 'saved', next: 'about_you' });
      // About you and History, still exactly as No changes filled them, are to be sent again.
      expect(db.saveDetailsReview).toHaveBeenCalledWith(fakeTx, {
        carriedFromId: sourceId,
        detailsChanged: true,
        answers: carried,
        doneScreens: ['consent'],
      });
      // The one already reviewed is asked for again, not the newest.
      expect(db.healthFormCarrySource).toHaveBeenCalledWith(
        fakeTx,
        expect.any(Array),
        18,
        sourceId,
      );
    });

    it('changes nothing when the same answer is given again', async () => {
      db.ownIntakeResponse.mockResolvedValue({
        ...started,
        doneScreens: ['consent', 'about_you', 'problem'],
        answers: { sex: 'female', region: 'knee' },
        carriedFromId: sourceId,
        detailsChanged: true,
      });
      expect(await review(true)).toEqual({ status: 'saved', next: 'warning_signs' });
      expect(db.saveDetailsReview).not.toHaveBeenCalled();
    });

    it('takes no review before Part A, after submit, or without an earlier form', async () => {
      db.ownIntakeResponse.mockResolvedValue({ ...started, doneScreens: [] });
      expect(await review(false)).toEqual({ status: 'elsewhere', resume: 'consent' });
      db.ownIntakeResponse.mockResolvedValue({ ...started, submittedAt: new Date() });
      expect((await review(false)).status).toBe('elsewhere');
      db.ownIntakeResponse.mockResolvedValue(started);
      db.healthFormCarrySource.mockResolvedValue(undefined);
      expect(await review(false)).toEqual({ status: 'elsewhere', resume: 'about_you' });
      // An earlier form whose details are all gone from the form is no earlier form.
      db.healthFormCarrySource.mockResolvedValue({ ...source, answers: { goals: 'Run' } });
      expect(await review(false)).toEqual({ status: 'elsewhere', resume: 'about_you' });
      expect(db.saveDetailsReview).not.toHaveBeenCalled();
      db.healthFormVisit.mockResolvedValue({ ...visit, status: 'completed' });
      expect(await review(false)).toEqual({ status: 'closed' });
      links.verifyPatientLink.mockResolvedValue({ status: 'used', purpose: 'health_form' });
      expect(await review(false)).toEqual({ status: 'link' });
    });

    it('lets the screens open once answered', async () => {
      db.ownIntakeResponse.mockResolvedValue({
        ...started,
        carriedFromId: sourceId,
        detailsChanged: true,
      });
      expect(await save('about_you', { sex: 'female' })).toEqual({
        status: 'saved',
        next: 'problem',
      });
    });
  });
});
