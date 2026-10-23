import { beforeEach, describe, expect, it, vi } from 'vitest';
import { processIntakeSubmission } from './pipeline';

// INT-10: the submit pipeline. A submitted form opens its episode and moves it to Awaiting
// consultation, raises the red flag rules of the latest knowledge base version with that version,
// records the precautions ticked, queues the AI sheet and tells the physio; a second run does
// nothing.
const fakeTx = { kind: 'transaction' };
const db = vi.hoisted(() => ({
  withActor: vi.fn(),
  submittedIntake: vi.fn(),
  insertEpisode: vi.fn(),
  updateEpisodeState: vi.fn(),
  linkIntakeEpisode: vi.fn(),
  latestKnowledgeVersion: vi.fn(),
  redFlagRules: vi.fn(),
  insertRedFlagAlerts: vi.fn(),
  insertPrecautions: vi.fn(),
  enqueueJob: vi.fn(),
  insertNotifications: vi.fn(),
}));
vi.mock('@clinic-mx/db', async (importOriginal) => {
  const real: Record<string, unknown> = await importOriginal();
  return { ...db, systemActor: real.systemActor };
});
vi.mock('../../lib/db', () => ({ appDb: () => ({ kind: 'appDb' }) }));
// Test values only; the real ones are the `screening.*` settings rows.
vi.mock('../settings/settings', () => ({ getSetting: vi.fn(() => Promise.resolve(5)) }));

const appointmentId = '00000000-0000-4000-8000-000000000801';
const episodeId = '00000000-0000-4000-8000-000000000e01';
const physioId = '00000000-0000-4000-8000-000000000301';
const versionId = '00000000-0000-4000-8000-000000000b01';
const intake = {
  intakeResponseId: '00000000-0000-4000-8000-000000000c01',
  formVersion: 'hf-3',
  answers: {
    region: 'back',
    sex: 'female',
    back_saddle: true,
    fever_sweats: false,
    health_conditions: ['implant', 'diabetes'],
  },
  submittedAt: new Date(),
  episodeId: null,
  appointmentId,
  patientId: '00000000-0000-4000-8000-000000000501',
  centreId: '00000000-0000-4000-8000-000000000101',
  physioId,
  dateOfBirth: '1980-01-01',
};
const rule = (key: string, over: Record<string, unknown>) => ({
  ruleKey: key,
  name: key,
  regions: [],
  trigger: { any: [{ question: 'back_saddle', is: 'yes' }] },
  triage: 'immediate_emergency',
  action: 'Send to the emergency department.',
  source: 'Framework',
  signedOff: false,
  ...over,
});

describe('the submit pipeline', () => {
  beforeEach(() => {
    for (const fn of Object.values(db)) fn.mockReset();
    db.withActor.mockImplementation(
      (_db: unknown, _actor: string, work: (tx: unknown) => unknown) => work(fakeTx),
    );
    db.submittedIntake.mockResolvedValue(intake);
    db.insertEpisode.mockResolvedValue(episodeId);
    db.updateEpisodeState.mockResolvedValue(true);
    db.latestKnowledgeVersion.mockResolvedValue({ id: versionId, number: 2, status: 'draft' });
    db.redFlagRules.mockResolvedValue([
      rule('back.cauda_equina', { regions: ['back'], signedOff: true }),
      rule('knee.only', { regions: ['knee'] }),
      rule('everywhere.fever', {
        trigger: { any: [{ question: 'fever_sweats', is: 'yes' }] },
        triage: 'urgent_medical_referral',
      }),
    ]);
  });

  it('opens the episode, raises the rules, records precautions, queues the sheet, tells the physio', async () => {
    expect(await processIntakeSubmission(appointmentId)).toEqual({
      status: 'done',
      episodeId,
      alerts: 1,
      precautions: 2,
    });
    expect(db.withActor).toHaveBeenCalledWith(
      { kind: 'appDb' },
      'system:intake',
      expect.any(Function),
    );
    expect(db.insertEpisode).toHaveBeenCalledWith(fakeTx, {
      patientId: intake.patientId,
      centreId: intake.centreId,
      bodyRegion: 'back',
    });
    expect(db.updateEpisodeState).toHaveBeenCalledWith(fakeTx, episodeId, 'intake_pending', {
      status: 'awaiting_consultation',
      pausedFrom: null,
    });
    expect(db.linkIntakeEpisode).toHaveBeenCalledWith(fakeTx, {
      appointmentId,
      intakeResponseId: intake.intakeResponseId,
      episodeId,
    });
    expect(db.insertRedFlagAlerts).toHaveBeenCalledWith(fakeTx, [
      {
        episodeId,
        appointmentId,
        kbVersionId: versionId,
        ruleKey: 'back.cauda_equina',
        name: 'back.cauda_equina',
        triage: 'immediate_emergency',
        display: 'emergency',
        action: 'Send to the emergency department.',
        signedOff: true,
      },
    ]);
    expect(db.insertPrecautions).toHaveBeenCalledWith(fakeTx, [
      expect.objectContaining({ key: 'implant', episodeId, formVersion: 'hf-3' }),
      expect.objectContaining({ key: 'diabetes', label: 'Diabetes' }),
    ]);
    expect(db.enqueueJob).toHaveBeenCalledWith(fakeTx, {
      kind: 'ai.preparation_sheet',
      payload: { episodeId },
      idempotencyKey: `ai.preparation_sheet:${episodeId}`,
    });
    expect(db.insertNotifications).toHaveBeenCalledWith(fakeTx, [
      { staffUserId: physioId, kind: 'health_form_submitted', appointmentId, episodeId },
      { staffUserId: physioId, kind: 'red_flag_emergency', appointmentId, episodeId },
    ]);
  });

  it('raises nothing and records no precautions for an all clear form', async () => {
    db.submittedIntake.mockResolvedValue({
      ...intake,
      answers: { region: 'back', back_saddle: false, health_conditions: ['none'] },
    });
    expect(await processIntakeSubmission(appointmentId)).toMatchObject({
      alerts: 0,
      precautions: 0,
    });
    expect(db.insertRedFlagAlerts).toHaveBeenCalledWith(fakeTx, []);
    expect(db.insertNotifications).toHaveBeenCalledWith(fakeTx, [
      expect.objectContaining({ kind: 'health_form_submitted' }),
    ]);
  });

  it('does nothing for a form that has its episode, and refuses one not submitted', async () => {
    db.submittedIntake.mockResolvedValue({ ...intake, episodeId });
    expect(await processIntakeSubmission(appointmentId)).toEqual({ status: 'already', episodeId });
    expect(db.insertEpisode).not.toHaveBeenCalled();
    db.submittedIntake.mockResolvedValue({ ...intake, submittedAt: null });
    await expect(processIntakeSubmission(appointmentId)).rejects.toThrow('not submitted');
    db.submittedIntake.mockResolvedValue(undefined);
    await expect(processIntakeSubmission(appointmentId)).rejects.toThrow('not submitted');
  });

  it('records the episode without alerts before any knowledge base version', async () => {
    db.latestKnowledgeVersion.mockResolvedValue(undefined);
    expect(await processIntakeSubmission(appointmentId)).toMatchObject({ alerts: 0 });
    expect(db.insertRedFlagAlerts).not.toHaveBeenCalled();
    expect(db.insertNotifications).toHaveBeenCalledWith(fakeTx, [
      expect.objectContaining({ kind: 'health_form_submitted' }),
    ]);
  });

  it('stops when the episode cannot move on', async () => {
    db.updateEpisodeState.mockResolvedValue(false);
    await expect(processIntakeSubmission(appointmentId)).rejects.toThrow('Awaiting consultation');
    expect(db.insertNotifications).not.toHaveBeenCalled();
  });
});
