import type { Db, StaffMember } from '@clinic-mx/db';
import { emptySessionNote, type SessionNote } from '@clinic-mx/schemas';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NotAllowedError, ReadOnlyError } from '../access/guard';
import {
  SessionError,
  closeSession,
  loadSession,
  openSessionNote,
  saveSessionNote,
} from './services';

const fakeTx = { kind: 'transaction' };
const db = vi.hoisted(() => ({
  withStaffAccess: vi.fn(),
  sessionNoteOf: vi.fn(),
  planForSession: vi.fn(),
  saveSessionNote: vi.fn(),
  signSession: vi.fn(),
  staffTreatsNow: vi.fn(),
  lastSignedSessionNote: vi.fn(),
  latestKnowledgeVersion: vi.fn(),
  newestPlanOfCareId: vi.fn(),
  openSession: vi.fn(),
  sessionVisit: vi.fn(),
  sessionProgress: vi.fn(),
  episodeRecord: vi.fn(),
  signedNotesOf: vi.fn(),
  patientAlertHistory: vi.fn(),
  episodePlan: vi.fn(),
  episodePrecautions: vi.fn(),
  nextVisitOf: vi.fn(),
  logClinicalView: vi.fn(),
}));
vi.mock('@clinic-mx/db', () => db);
vi.mock('../access/staff-db', () => ({
  asStaffViewing: (_actor: unknown, work: (tx: unknown) => unknown) => work(fakeTx),
}));

const hsr = '00000000-0000-4000-8000-000000000101';
const appointmentId = '00000000-0000-4000-8000-000000000901';
const patientId = '00000000-0000-4000-8000-000000000301';
const episodeId = '00000000-0000-4000-8000-000000000501';
const staff = (extra: Partial<StaffMember> = {}): StaffMember => ({
  id: '00000000-0000-4000-8000-000000000204',
  email: 'physio@clinicmx.test',
  name: 'Test Physio',
  role: 'physiotherapist',
  treatsPatients: true,
  consultant: false,
  centreIds: [hsr],
  support: false,
  ...extra,
});
const otherPhysio = staff({ id: '00000000-0000-4000-8000-000000000205' });
const superAdmin = staff({
  id: '00000000-0000-4000-8000-000000000201',
  role: 'super_admin',
  treatsPatients: false,
  centreIds: [],
});
const visit = (extra: Record<string, unknown> = {}) => ({
  id: appointmentId,
  physioId: staff().id,
  physioName: 'Test Physio',
  status: 'in_progress',
  startsAt: new Date(),
  episodeId,
  typeKey: 'session',
  typeName: 'Session',
  patientId,
  ...extra,
});

// SES-02 done when: the physio who starts a session sees the summary card of its episode, from the
// signed plan, with no AI sheet; only they open it, and the Super Admin reads it.
describe('loadSession', () => {
  beforeEach(() => {
    for (const fn of Object.values(db)) fn.mockReset();
    db.sessionVisit.mockResolvedValue(visit());
    db.sessionProgress.mockResolvedValue(
      new Map([[appointmentId, { number: 3, planned: 12, episodeStatus: 'active' }]]),
    );
    db.episodeRecord.mockResolvedValue({ id: episodeId, status: 'active', centreId: hsr });
    db.signedNotesOf.mockResolvedValue([
      { id: 'c1', episodeId, centreId: hsr, signedBy: 'consultant', addenda: [] },
      { id: 'c0', episodeId: 'older', centreId: hsr, signedBy: 'consultant', addenda: [] },
    ]);
    db.patientAlertHistory.mockResolvedValue([
      { id: 'a1', episodeId, status: 'raised' },
      { id: 'a2', episodeId: 'older', status: 'raised' },
    ]);
    db.episodePlan.mockResolvedValue({ version: 1, sessionsPerWeek: 2, weeks: 6 });
    db.episodePrecautions.mockResolvedValue([{ key: 'pregnancy', label: 'Pregnancy' }]);
    db.nextVisitOf.mockResolvedValue(undefined);
    db.sessionNoteOf.mockResolvedValue(undefined);
  });

  it('gives the own physio the card of the session’s episode, and logs the view', async () => {
    const screen = await loadSession(staff(), appointmentId);
    expect(screen?.readOnly).toBe(false);
    expect(screen?.session.label).toBe('Session 3 of 12');
    expect(db.episodeRecord).toHaveBeenCalledWith(fakeTx, episodeId);
    expect(db.episodePlan).toHaveBeenCalledWith(fakeTx, episodeId);
    expect(screen?.summary).toMatchObject({
      plan: { sessionsPerWeek: 2, weeks: 6 },
      precautions: [{ key: 'pregnancy', label: 'Pregnancy' }],
      lastNote: { id: 'c1' },
      openAlerts: 1,
    });
    expect(db.logClinicalView).toHaveBeenCalledWith(fakeTx, 'patient', patientId);
  });

  it('refuses another physio and Velyx support; the Super Admin reads it', async () => {
    await expect(loadSession(otherPhysio, appointmentId)).rejects.toThrow(NotAllowedError);
    await expect(loadSession(staff({ support: true }), appointmentId)).rejects.toThrow(
      NotAllowedError,
    );
    await expect(
      loadSession(staff({ role: 'front_desk', treatsPatients: false }), appointmentId),
    ).rejects.toThrow(NotAllowedError);
    expect(db.logClinicalView).not.toHaveBeenCalled();
    const screen = await loadSession(superAdmin, appointmentId);
    expect(screen?.readOnly).toBe(true);
    expect(db.logClinicalView).toHaveBeenCalledOnce();
  });

  it('is not found for a missing appointment or one that is not a session', async () => {
    db.sessionVisit.mockResolvedValueOnce(undefined);
    await expect(loadSession(staff(), appointmentId)).resolves.toBeUndefined();
    db.sessionVisit.mockResolvedValueOnce(visit({ typeKey: 'consultation' }));
    db.sessionProgress.mockResolvedValueOnce(new Map());
    await expect(loadSession(staff(), appointmentId)).resolves.toBeUndefined();
    expect(db.logClinicalView).not.toHaveBeenCalled();
  });

  it('shows no card for a session outside an episode', async () => {
    db.sessionVisit.mockResolvedValueOnce(visit({ episodeId: null }));
    db.sessionProgress.mockResolvedValueOnce(
      new Map([[appointmentId, { number: null, planned: null, episodeStatus: null }]]),
    );
    const screen = await loadSession(staff(), appointmentId);
    expect(screen?.summary).toBeUndefined();
    expect(screen?.session.gate.message).toBe('Not part of an episode yet.');
    expect(db.episodeRecord).not.toHaveBeenCalled();
  });
});

// SES-03 done when: the physio writes the note (prefilled, autosaved) and Close session signs it.
describe('the session note', () => {
  const sessionId = '00000000-0000-4000-8000-000000000a01';
  const complete = (): SessionNote => ({
    ...emptySessionNote(),
    newSymptoms: { answer: 'no', description: '' },
    pain: { rest: 2, activity: 4, after: 1 },
    treatment: { interventions: ['exercise'], modalities: [], note: '' },
    response: { rating: 'better', note: '' },
    nextSession: { plan: 'progress', note: '' },
  });
  const stored = (extra: Record<string, unknown> = {}) => ({
    id: sessionId,
    appointmentId,
    episodeId,
    physioId: staff().id,
    number: 3,
    planOfCareId: 'plan-1',
    note: complete(),
    status: 'draft',
    signedAt: null,
    signedByName: null,
    packageId: null,
    version: 4,
    ...extra,
  });
  const context = (actor = staff()) => ({ db: {} as Db, actor });
  const opening = { id: appointmentId, episodeId, physioId: staff().id };

  beforeEach(() => {
    for (const fn of Object.values(db)) fn.mockReset();
    db.withStaffAccess.mockImplementation(
      (_db: Db, _context: unknown, work: (tx: unknown) => unknown) => work(fakeTx),
    );
    db.sessionNoteOf.mockResolvedValue(stored());
    db.staffTreatsNow.mockResolvedValue(true);
    db.signSession.mockResolvedValue('signed');
    db.latestKnowledgeVersion.mockResolvedValue({ id: 'kb-1' });
    db.openSession.mockResolvedValue(sessionId);
  });

  it('opens prefilled from the last signed note, or from the plan the first time', async () => {
    const lastTreatment = {
      interventions: ['manual_therapy'],
      modalities: ['laser'],
      note: 'Grade III',
    };
    db.lastSignedSessionNote.mockResolvedValueOnce({ ...complete(), treatment: lastTreatment });
    await openSessionNote(fakeTx as never, opening);
    expect(db.openSession).toHaveBeenLastCalledWith(fakeTx, {
      appointmentId,
      physioId: staff().id,
      kbVersionId: 'kb-1',
      note: { ...emptySessionNote(), treatment: lastTreatment },
    });
    db.lastSignedSessionNote.mockResolvedValueOnce(undefined);
    db.newestPlanOfCareId.mockResolvedValueOnce('plan-1');
    db.planForSession.mockResolvedValueOnce({
      interventions: ['exercise'],
      modalities: [{ key: 'pemf', name: 'PEMF' }],
      homeProgramme: [],
    });
    await openSessionNote(fakeTx as never, opening);
    const opened = db.openSession.mock.lastCall?.[1] as { note: SessionNote } | undefined;
    expect(opened?.note.treatment).toEqual({
      interventions: ['exercise'],
      modalities: ['pemf'],
      note: '',
    });
    db.latestKnowledgeVersion.mockResolvedValueOnce(undefined);
    await expect(openSessionNote(fakeTx as never, opening)).rejects.toThrow(
      'The knowledge base is not loaded yet.',
    );
  });

  it('shows the note to its physio to write, and to the Super Admin to read', async () => {
    db.planForSession.mockResolvedValue({
      interventions: ['exercise'],
      modalities: [],
      homeProgramme: [],
    });
    db.sessionVisit.mockResolvedValue(visit());
    db.sessionProgress.mockResolvedValue(
      new Map([[appointmentId, { number: 3, planned: 12, episodeStatus: 'active' }]]),
    );
    db.episodeRecord.mockResolvedValue({ id: episodeId, status: 'active', centreId: hsr });
    db.signedNotesOf.mockResolvedValue([]);
    db.patientAlertHistory.mockResolvedValue([]);
    db.episodePrecautions.mockResolvedValue([]);
    const own = await loadSession(staff(), appointmentId);
    expect(own?.note).toMatchObject({ version: 4, editable: true, value: complete() });
    expect((await loadSession(superAdmin, appointmentId))?.note?.editable).toBe(false);
    db.sessionNoteOf.mockResolvedValue(
      stored({ status: 'signed', signedAt: new Date(), signedByName: 'Test Physio' }),
    );
    expect((await loadSession(staff(), appointmentId))?.note).toMatchObject({
      editable: false,
      signed: { by: 'Test Physio' },
    });
  });

  it("saves only the physio's own draft, at the version they saw", async () => {
    const save = (actor = staff()) =>
      saveSessionNote(context(actor), { appointmentId, value: complete(), baseVersion: 4 });
    db.saveSessionNote.mockResolvedValueOnce({ status: 'saved', version: 5 });
    await expect(save()).resolves.toEqual({ status: 'saved', version: 5 });
    expect(db.saveSessionNote).toHaveBeenCalledWith(fakeTx, sessionId, 4, complete());
    db.saveSessionNote.mockResolvedValueOnce({
      status: 'conflict',
      version: 6,
      row: { note: emptySessionNote() },
    });
    await expect(save()).resolves.toEqual({
      status: 'conflict',
      version: 6,
      value: emptySessionNote(),
    });
    await expect(save(otherPhysio)).rejects.toThrow(
      new SessionError('That session was not found.', 'not_found'),
    );
    db.sessionNoteOf.mockResolvedValueOnce(stored({ status: 'signed' }));
    await expect(save()).rejects.toThrow('This session is closed. Its note is signed.');
    await expect(save(staff({ role: 'front_desk', treatsPatients: false }))).rejects.toThrow(
      NotAllowedError,
    );
    await expect(save(staff({ support: true }))).rejects.toThrow(ReadOnlyError);
  });

  it("closes the physio's own complete note at its version, with the pain readings", async () => {
    await expect(closeSession(context(), { appointmentId, baseVersion: 4 })).resolves.toEqual({
      status: 'signed',
    });
    expect(db.signSession).toHaveBeenCalledWith(fakeTx, {
      sessionId,
      baseVersion: 4,
      by: staff().id,
      pain: { rest: 2, activity: 4, after: 1 },
    });
  });

  it("refuses to close what is missing, someone else's, a stale version, or without the tick", async () => {
    const close = (actor = staff(), baseVersion = 4) =>
      closeSession(context(actor), { appointmentId, baseVersion });
    db.sessionNoteOf.mockResolvedValueOnce(stored({ note: emptySessionNote() }));
    await expect(close()).rejects.toThrow('Answer "Any new symptoms?".');
    await expect(close(otherPhysio)).rejects.toThrow('That session was not found.');
    await expect(close(staff(), 3)).rejects.toThrow('Your latest changes are still saving.');
    db.staffTreatsNow.mockResolvedValueOnce(false);
    await expect(close()).rejects.toThrow('Closing a session needs the Treats patients tick.');
    db.sessionNoteOf.mockResolvedValueOnce(stored({ status: 'signed' }));
    await expect(close()).rejects.toThrow('This session is closed.');
    db.signSession.mockResolvedValueOnce('stale');
    await expect(close()).rejects.toThrow('Your latest changes are still saving.');
    expect(db.signSession).toHaveBeenCalledOnce();
  });
});
