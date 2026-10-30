import type { Db, StaffMember } from '@clinic-mx/db';
import {
  emptySessionNote,
  partBStatements,
  type KnowledgeMeasure,
  type SessionNote,
} from '@clinic-mx/schemas';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NotAllowedError, ReadOnlyError } from '../access/guard';
import { baselineView } from './baseline';
import { reassessmentView } from './reassessment';
import {
  SessionError,
  addSessionAddendum,
  closeSession,
  loadSession,
  openSessionNote,
  saveSessionNote,
} from './services';

const fakeTx = { kind: 'transaction' };
const adherence = {
  from: '2026-10-21',
  to: '2026-10-27',
  since: 'last_session' as const,
  days: 7,
  daysDone: 5,
  tracked: true,
};
/** An episode's Part B with every treatment card decided `accepted`. */
const partB = (accepted: boolean, planned = true) => ({
  planned,
  latest: Object.fromEntries(
    Object.values(partBStatements).flatMap((statement) =>
      statement.group === 'modality' ? [[statement.key, accepted]] : [],
    ),
  ),
});
const db = vi.hoisted(() => ({
  withStaffAccess: vi.fn(),
  sessionNoteOf: vi.fn(),
  sessionNoteById: vi.fn(),
  sessionAddenda: vi.fn(),
  addSessionAddendum: vi.fn(),
  signedSessionNotesOf: vi.fn(),
  planForSession: vi.fn(),
  partBForEpisode: vi.fn(),
  saveSessionNote: vi.fn(),
  signSession: vi.fn(),
  sessionAdherence: vi.fn(),
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
  sessionModalities: vi.fn(),
  nextVisitOf: vi.fn(),
  logClinicalView: vi.fn(),
  knowledgeObjective: vi.fn(),
  signedConsultationOf: vi.fn(),
  consultationIntake: vi.fn(),
  consultationMeasuresBetween: vi.fn(),
  frozenBaseline: vi.fn(),
  recordBaseline: vi.fn(),
  frozenBaselineOfEpisode: vi.fn(),
  reassessmentOfSession: vi.fn(),
  sessionReadings: vi.fn(),
  recordReassessment: vi.fn(),
}));
vi.mock('@clinic-mx/db', () => db);
// Test values only; the real ones are the settings rows.
const settings: Record<string, number> = {
  'clinical.baseline_reuse_days': 7,
  'clinical.reassessment_session': 4,
};
vi.mock('../settings/settings', () => ({
  getSetting: (key: string) =>
    key in settings ? Promise.resolve(settings[key]) : Promise.reject(new Error(key)),
}));
// OUT-04: the card's phase line comes from the phase stepper (its own tests).
vi.mock('../phases/phases', () => ({
  episodePhaseLine: () => Promise.resolve('Phase 1 of 4: Restore & Activate'),
}));
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
const shockwave = {
  key: 'radial_shockwave',
  name: 'Radial Shockwave (RSW)',
  precautions: [{ precaution: 'pregnancy', source: 'SOP 12.3' }],
  parameters: [{ key: 'area', label: 'Area treated', kind: 'text' as const, source: 's' }],
};
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
  startedBy: staff().id,
  startedByName: 'Test Physio',
  centreId: hsr,
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
    const signedAt = new Date('2026-10-20T05:00:00Z');
    db.signedNotesOf.mockResolvedValue([
      {
        kind: 'consultation',
        id: 'c1',
        episodeId,
        centreId: hsr,
        signedBy: 'consultant',
        signedAt,
      },
      {
        kind: 'consultation',
        id: 'c0',
        episodeId: 'older',
        centreId: hsr,
        signedBy: 'consultant',
        signedAt: new Date('2026-09-01T05:00:00Z'),
      },
    ]);
    db.signedSessionNotesOf.mockResolvedValue([
      {
        kind: 'session',
        id: 's2',
        number: 2,
        episodeId,
        centreId: hsr,
        signedBy: 'p',
        signedAt: new Date('2026-10-24T05:00:00Z'),
      },
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
    expect(screen?.phase).toBe('Phase 1 of 4: Restore & Activate');
    expect(db.episodeRecord).toHaveBeenCalledWith(fakeTx, episodeId);
    expect(db.episodePlan).toHaveBeenCalledWith(fakeTx, episodeId);
    expect(screen?.summary).toMatchObject({
      plan: { sessionsPerWeek: 2, weeks: 6 },
      precautions: [{ key: 'pregnancy', label: 'Pregnancy' }],
      consultation: { id: 'c1' },
      lastNote: { id: 's2' },
      openAlerts: 1,
    });
    expect(db.logClinicalView).toHaveBeenCalledWith(fakeTx, 'patient', patientId);
  });

  it('refuses a physio elsewhere and Velyx support; colleagues and the Super Admin read it', async () => {
    await expect(
      loadSession(staff({ id: otherPhysio.id, centreIds: ['another-centre'] }), appointmentId),
    ).rejects.toThrow(NotAllowedError);
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
    // SES-08: a colleague at the centre reads it.
    expect(await loadSession(otherPhysio, appointmentId)).toMatchObject({
      readOnly: true,
      writerName: 'Test Physio',
      coveredBy: null,
    });
  });

  // SES-08: covered by a colleague, the note is theirs; the booked physio reads it.
  it('gives a covered session to the colleague who started it', async () => {
    db.sessionVisit.mockResolvedValue(
      visit({ startedBy: otherPhysio.id, startedByName: 'Other Physio' }),
    );
    expect(await loadSession(otherPhysio, appointmentId)).toMatchObject({
      readOnly: false,
      writerName: 'Other Physio',
      coveredBy: 'Other Physio',
    });
    expect(await loadSession(staff(), appointmentId)).toMatchObject({
      readOnly: true,
      coveredBy: 'Other Physio',
    });
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
    treatment: {
      interventions: ['exercise'],
      modalities: [],
      note: '',
      parameters: {},
      reasons: {},
    },
    response: { rating: 'better', note: '', adverseEvent: { reported: false, description: '' } },
    nextSession: { plan: 'progress', note: '' },
  });
  const stored = (extra: Record<string, unknown> = {}) => ({
    id: sessionId,
    appointmentId,
    episodeId,
    centreId: hsr,
    physioId: staff().id,
    number: 3,
    kbVersionId: 'kb-1',
    planOfCareId: 'plan-1',
    note: complete(),
    status: 'draft' as 'draft' | 'signed',
    signedAt: null,
    signedByName: null,
    packageId: null,
    version: 4,
    startedAt: new Date('2026-11-10T04:30:00Z'),
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
    db.sessionNoteById.mockResolvedValue(stored({ status: 'signed' }));
    db.sessionModalities.mockResolvedValue([shockwave]);
    db.episodePrecautions.mockResolvedValue([]);
    db.sessionAddenda.mockResolvedValue([]);
    db.addSessionAddendum.mockResolvedValue({ id: 'addendum-1' });
    db.staffTreatsNow.mockResolvedValue(true);
    db.signSession.mockResolvedValue('signed');
    // PAT-02: the adherence a draft shows, kept with the note at signing (version 4, then 5).
    db.sessionAdherence.mockResolvedValue(adherence);
    db.saveSessionNote.mockResolvedValue({ status: 'saved', version: 5 });
    db.latestKnowledgeVersion.mockResolvedValue({ id: 'kb-1' });
    db.openSession.mockResolvedValue(sessionId);
    // BIL-04: every treatment's Part B card agreed, unless a test says otherwise.
    db.partBForEpisode.mockResolvedValue(partB(true));
  });

  it('opens prefilled from the last signed note, or from the plan the first time', async () => {
    const lastTreatment = {
      interventions: ['manual_therapy'],
      modalities: ['laser'],
      note: 'Grade III',
      parameters: {},
      reasons: {},
    };
    db.lastSignedSessionNote.mockResolvedValueOnce({
      number: 2,
      signedAt: new Date(),
      note: { ...complete(), treatment: lastTreatment },
    });
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
      parameters: {},
      reasons: {},
    });
    // BIL-04: a treatment the patient declined in Part B does not carry over, nor its parameters.
    db.lastSignedSessionNote.mockResolvedValueOnce({
      number: 2,
      signedAt: new Date(),
      note: {
        ...complete(),
        treatment: { ...lastTreatment, parameters: { laser: { area: 'Knee' } } },
      },
    });
    db.partBForEpisode.mockResolvedValueOnce(partB(false));
    await openSessionNote(fakeTx as never, opening);
    const withoutLaser = db.openSession.mock.lastCall?.[1] as { note: SessionNote } | undefined;
    expect(withoutLaser?.note.treatment).toMatchObject({ modalities: [], parameters: {} });
    // Consented on paper (no signed plan here, an opening entry): carried over as it was.
    db.lastSignedSessionNote.mockResolvedValueOnce({
      number: 2,
      signedAt: new Date(),
      note: { ...complete(), treatment: lastTreatment },
    });
    db.partBForEpisode.mockResolvedValueOnce(partB(false, false));
    await openSessionNote(fakeTx as never, opening);
    const onPaper = db.openSession.mock.lastCall?.[1] as { note: SessionNote } | undefined;
    expect(onPaper?.note.treatment.modalities).toEqual(['laser']);
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
    db.signedSessionNotesOf.mockResolvedValue([]);
    db.patientAlertHistory.mockResolvedValue([]);
    db.episodePrecautions.mockResolvedValue([]);
    const own = await loadSession(staff(), appointmentId);
    expect(own?.note).toMatchObject({
      id: sessionId,
      version: 4,
      editable: true,
      value: complete(),
      lastTime: null,
      addenda: [],
      addsAddenda: false,
      adherence,
    });
    expect(db.sessionAdherence).toHaveBeenCalledWith(fakeTx, sessionId);
    expect(db.sessionAddenda).not.toHaveBeenCalled();

    // SES-04: the previous signed note, for "Same as last time", only while the physio writes.
    const signedAt = new Date('2026-10-24T05:00:00Z');
    db.lastSignedSessionNote.mockResolvedValue({ number: 2, signedAt, note: complete() });
    expect((await loadSession(staff(), appointmentId))?.note?.lastTime).toEqual({
      number: 2,
      signedAt,
      note: complete(),
    });
    expect(db.lastSignedSessionNote).toHaveBeenLastCalledWith(fakeTx, episodeId);
    expect((await loadSession(superAdmin, appointmentId))?.note?.lastTime).toBeNull();
    expect((await loadSession(superAdmin, appointmentId))?.note?.editable).toBe(false);
    db.sessionNoteOf.mockResolvedValue(
      stored({ status: 'signed', signedAt: new Date(), signedByName: 'Test Physio' }),
    );
    db.sessionAddenda.mockResolvedValue([{ id: 'a1', text: 'Pain 4 at rest, not 2.' }]);
    expect((await loadSession(staff(), appointmentId))?.note).toMatchObject({
      editable: false,
      lastTime: null,
      signed: { by: 'Test Physio' },
      addenda: [{ id: 'a1' }],
      addsAddenda: true,
      // Signed: as kept in the note, never worked out again (here, before PAT-02: none).
      adherence: null,
    });
    expect(db.sessionAddenda).toHaveBeenCalledWith(fakeTx, sessionId);
    // The Super Admin reads it; without the Treats patients tick they add nothing.
    expect((await loadSession(superAdmin, appointmentId))?.note?.addsAddenda).toBe(false);
  });

  // The follow up of 26 October 2026: a signed note changes only by addenda.
  it('adds an addendum to a signed note, with the tick, and names the visit', async () => {
    const add = (actor = staff()) =>
      addSessionAddendum(context(actor), { sessionId, text: ' Pain 4 at rest, not 2. ' });
    await expect(add()).resolves.toEqual({ id: 'addendum-1', appointmentId });
    expect(db.addSessionAddendum).toHaveBeenCalledWith(fakeTx, {
      sessionId,
      episodeId,
      text: 'Pain 4 at rest, not 2.',
      authorId: staff().id,
    });
    db.sessionNoteById.mockResolvedValueOnce(undefined);
    await expect(add()).rejects.toThrow('That session was not found.');
    db.sessionNoteById.mockResolvedValueOnce(stored());
    await expect(add()).rejects.toThrow('Addenda are added once the session is closed.');
    db.staffTreatsNow.mockResolvedValueOnce(false);
    await expect(add()).rejects.toThrow('Adding an addendum needs the Treats patients tick.');
    await expect(add(staff({ role: 'front_desk', treatsPatients: false }))).rejects.toThrow(
      NotAllowedError,
    );
    await expect(add(staff({ support: true }))).rejects.toThrow(ReadOnlyError);
    expect(db.addSessionAddendum).toHaveBeenCalledOnce();
  });

  it("saves only the physio's own draft, at the version they saw", async () => {
    const save = (actor = staff()) =>
      saveSessionNote(context(actor), { appointmentId, value: complete(), baseVersion: 4 });
    db.saveSessionNote.mockResolvedValueOnce({ status: 'saved', version: 5 });
    await expect(save()).resolves.toEqual({ status: 'saved', version: 5 });
    // Adherence is never typed: whatever is posted, a draft holds none (PAT-02).
    expect(db.saveSessionNote).toHaveBeenCalledWith(fakeTx, sessionId, 4, {
      ...complete(),
      adherence: null,
    });
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
    // The adherence is kept with the note first, then the note is signed at that version.
    expect(db.saveSessionNote).toHaveBeenCalledWith(fakeTx, sessionId, 4, {
      ...complete(),
      adherence,
    });
    expect(db.signSession).toHaveBeenCalledWith(fakeTx, {
      sessionId,
      baseVersion: 5,
      by: staff().id,
      pain: { rest: 2, activity: 4, after: 1 },
    });
    expect(db.recordBaseline, 'only session 1 records the baseline').not.toHaveBeenCalled();
    expect(db.recordReassessment, 'only session 4 reassesses').not.toHaveBeenCalled();
  });

  // OUT-05 done when: the treating physio records the markers at session 4 and the consultant
  // reviews and signs. Decisions (user, 26 October 2026): exactly the baseline's measures, each
  // recorded or Not tested with a reason before closing.
  describe('the session 4 reassessment', () => {
    const marker = (extra: Partial<KnowledgeMeasure>): KnowledgeMeasure => ({
      key: 'knee.marker.primary_task_pain_nrs_0_10', // gitleaks:allow
      region: 'knee',
      section: 'RE-TESTABLE MARKERS — BASELINE vs CURRENT',
      name: 'Primary task pain (NRS 0-10)',
      unit: '/10',
      kind: 'marker',
      inverted: false,
      rule: { kind: 'none' },
      direction: 'Lower is better',
      note: null,
      ...extra,
    });
    const pain = marker({});
    const quadriceps = marker({
      key: 'knee.lsi.quadriceps', // gitleaks:allow
      section: 'STRENGTH',
      name: 'Quadriceps',
      unit: 'kg',
      kind: 'lsi',
      rule: { kind: 'lsi', passAt: 0.9 },
      direction: null,
    });
    const takenAt = new Date('2026-11-01T04:30:00Z');
    const fourth = (reassessment: SessionNote['reassessment'] = {}) =>
      stored({ number: 4, note: { ...complete(), reassessment } });

    beforeEach(() => {
      db.knowledgeObjective.mockResolvedValue({ measures: [quadriceps, pain], specialTests: [] });
      db.frozenBaselineOfEpisode.mockResolvedValue([
        {
          key: pain.key,
          consultationId: 'c1',
          notTestedReason: null,
          readings: [{ limb: null, value: 6, takenAt }],
        },
        {
          key: quadriceps.key,
          consultationId: 'c1',
          notTestedReason: null,
          readings: [
            { limb: 'involved', value: 32, takenAt },
            { limb: 'uninvolved', value: 40, takenAt },
          ],
        },
      ]);
    });

    it('asks session 4 for the baseline’s measures, in the workbook’s order', async () => {
      const view = await reassessmentView(fakeTx as never, fourth());
      expect(view?.items.map((item) => [item.measure.key, item.baseline])).toEqual([
        [quadriceps.key, 'Involved 32 kg, uninvolved 40 kg · LSI 80% · Not yet'],
        [pain.key, '6/10'],
      ]);
      expect(view?.rows, 'no readings before signing').toBeNull();
      expect(await reassessmentView(fakeTx as never, stored()), 'session 3').toBeNull();
    });

    it('holds Close session until each is recorded, then writes the reassessment after signing', async () => {
      const close = () => closeSession(context(), { appointmentId, baseVersion: 4 });
      db.sessionNoteOf.mockResolvedValueOnce(fourth());
      await expect(close()).rejects.toThrow(
        'Record both sides of Quadriceps, or mark it Not tested with a reason. Record Primary task pain (NRS 0-10), or mark it Not tested with a reason.',
      );
      expect(db.signSession).not.toHaveBeenCalled();
      const order: string[] = [];
      db.signSession.mockImplementationOnce(() => {
        order.push('sign');
        return Promise.resolve('signed');
      });
      db.recordReassessment.mockImplementationOnce(() => {
        order.push('reassessment');
        return Promise.resolve('r1');
      });
      db.sessionNoteOf.mockResolvedValueOnce(
        fourth({
          [quadriceps.key]: {
            involved: 36,
            uninvolved: 39,
            value: null,
            notTested: false,
            reason: '',
          },
          [pain.key]: {
            involved: null,
            uninvolved: null,
            value: null,
            notTested: true,
            reason: 'Not assessable',
          },
        }),
      );
      await expect(close()).resolves.toEqual({ status: 'signed' });
      expect(order).toEqual(['sign', 'reassessment']);
      expect(db.recordReassessment).toHaveBeenCalledWith(fakeTx, {
        sessionId,
        episodeId,
        kbVersionId: 'kb-1',
        by: staff().id,
        readings: [
          { key: quadriceps.key, limb: 'involved', value: 36, unit: 'kg' },
          { key: quadriceps.key, limb: 'uninvolved', value: 39, unit: 'kg' },
        ],
        notTested: { [pain.key]: 'Not assessable' },
      });
    });

    it('asks nothing when session 1 recorded no baseline', async () => {
      db.frozenBaselineOfEpisode.mockResolvedValue([]);
      db.sessionNoteOf.mockResolvedValueOnce(fourth());
      await expect(closeSession(context(), { appointmentId, baseVersion: 4 })).resolves.toEqual({
        status: 'signed',
      });
      expect(db.recordReassessment).not.toHaveBeenCalled();
    });

    it('shows baseline against session 4 once signed, with the consultant’s review', async () => {
      const signedAt = new Date('2026-11-12T06:00:00Z');
      db.reassessmentOfSession.mockResolvedValue({
        id: 'r1',
        notTested: { [pain.key]: 'Not assessable' },
        decision: 'Continue the plan.',
        signedByName: 'Dr Test Consultant',
        signedAt,
        consultantName: 'Dr Test Consultant',
      });
      db.sessionReadings.mockResolvedValue([
        { key: quadriceps.key, limb: 'involved', value: 36 },
        { key: quadriceps.key, limb: 'uninvolved', value: 39 },
      ]);
      const view = await reassessmentView(fakeTx as never, stored({ number: 4, status: 'signed' }));
      expect(
        view?.rows?.map((row) => [row.measure.key, row.now, row.nowNotTested, row.change]),
      ).toEqual([
        [
          quadriceps.key,
          'Involved 36 kg, uninvolved 39 kg · LSI 92% · Pass',
          null,
          'LSI 80% → 92%',
        ],
        [pain.key, null, 'Not assessable', ''],
      ]);
      expect(view?.decision).toEqual({
        text: 'Continue the plan.',
        by: 'Dr Test Consultant',
        at: signedAt,
      });
      expect(view?.reassessmentId).toBe('r1');
    });
  });

  // OUT-01 done when: consultation measures within 7 days are reused; missing markers are asked
  // for at session 1, recorded or not tested with a reason before it closes.
  describe('session 1’s baseline', () => {
    const marker = (extra: Partial<KnowledgeMeasure>): KnowledgeMeasure => ({
      key: 'knee.marker.primary_task_pain_nrs_0_10', // gitleaks:allow
      region: 'knee',
      section: 'RE-TESTABLE MARKERS — BASELINE vs CURRENT',
      name: 'Primary task pain (NRS 0-10)',
      unit: '/10',
      kind: 'marker',
      inverted: false,
      rule: { kind: 'none' },
      direction: 'Lower is better',
      note: null,
      ...extra,
    });
    const pain = marker({});
    const effusion = marker({
      key: 'knee.marker.effusion_grade_0_3', // gitleaks:allow
      name: 'Effusion grade (0-3)',
      unit: 'grade',
      kind: 'grade',
    });
    const quadriceps = marker({
      key: 'knee.lsi.quadriceps', // gitleaks:allow
      section: 'STRENGTH',
      name: 'Quadriceps',
      unit: 'kg',
      kind: 'lsi',
      rule: { kind: 'lsi', passAt: 0.9 },
      direction: null,
    });
    const startedAt = new Date('2026-11-10T04:30:00Z');
    const takenAt = new Date('2026-11-07T06:00:00Z');
    const first = (baseline: SessionNote['baseline'] = {}) =>
      stored({ number: 1, note: { ...complete(), baseline } });

    beforeEach(() => {
      db.knowledgeObjective.mockResolvedValue({
        measures: [quadriceps, pain, effusion],
        specialTests: [],
      });
      db.signedConsultationOf.mockResolvedValue({
        id: 'c1',
        appointmentId: 'consultation-visit',
        sections: { objective: { region: 'knee' } },
      });
      db.consultationIntake.mockResolvedValue(undefined);
      db.consultationMeasuresBetween.mockResolvedValue([
        { key: quadriceps.key, limb: 'involved', value: 32, takenAt, consultationId: 'c1' },
        { key: quadriceps.key, limb: 'uninvolved', value: 40, takenAt, consultationId: 'c1' },
      ]);
    });

    it('reuses the consultation’s readings from the setting’s days and asks for the markers', async () => {
      const view = await baselineView(fakeTx as never, first());
      expect(db.consultationMeasuresBetween).toHaveBeenCalledWith(
        fakeTx,
        episodeId,
        new Date('2026-11-03T04:30:00Z'),
        startedAt,
      );
      expect(view).toEqual({
        reuseDays: 7,
        items: [
          expect.objectContaining({
            key: quadriceps.key,
            source: 'consultation',
            reading: 'Involved 32 kg, uninvolved 40 kg · LSI 80% · Not yet',
            takenAt,
          }),
          expect.objectContaining({ key: pain.key, source: 'requested', reading: null }),
          expect.objectContaining({ key: effusion.key, source: 'requested', kind: 'grade' }),
        ],
      });
      expect(await baselineView(fakeTx as never, stored()), 'session 3').toBeNull();
    });

    it('holds Close session until each is recorded or not tested, then freezes it after signing', async () => {
      const close = () => closeSession(context(), { appointmentId, baseVersion: 4 });
      db.sessionNoteOf.mockResolvedValueOnce(first());
      await expect(close()).rejects.toThrow(
        'Record Primary task pain (NRS 0-10), or mark it Not tested with a reason. Record Effusion grade (0-3), or mark it Not tested with a reason.',
      );
      db.sessionNoteOf.mockResolvedValueOnce(
        first({
          [pain.key]: { value: 6, notTested: false, reason: '' },
          [effusion.key]: { value: null, notTested: true, reason: '' },
        }),
      );
      await expect(close()).rejects.toThrow('Give the reason Effusion grade (0-3) was not tested.');
      expect(db.signSession).not.toHaveBeenCalled();

      const order: string[] = [];
      db.signSession.mockImplementationOnce(() => {
        order.push('sign');
        return Promise.resolve('signed');
      });
      db.recordBaseline.mockImplementationOnce(() => {
        order.push('baseline');
        return Promise.resolve();
      });
      db.sessionNoteOf.mockResolvedValueOnce(
        first({
          [pain.key]: { value: 6, notTested: false, reason: '' },
          [effusion.key]: { value: null, notTested: true, reason: 'Swelling not assessable' },
        }),
      );
      await expect(close()).resolves.toEqual({ status: 'signed' });
      expect(order).toEqual(['sign', 'baseline']);
      expect(db.recordBaseline).toHaveBeenCalledWith(fakeTx, {
        sessionId,
        episodeId,
        kbVersionId: 'kb-1',
        by: staff().id,
        reused: [{ key: quadriceps.key, consultationId: 'c1' }],
        recordings: [
          { key: pain.key, value: 6, unit: '/10' },
          { key: effusion.key, notTestedReason: 'Swelling not assessable' },
        ],
      });
    });

    it('shows the frozen baseline once signed, in the workbook’s order', async () => {
      db.frozenBaseline.mockResolvedValue([
        { key: effusion.key, consultationId: null, notTestedReason: 'Swelling', readings: [] },
        {
          key: quadriceps.key,
          consultationId: 'c1',
          notTestedReason: null,
          readings: [
            { limb: 'involved', value: 32, takenAt },
            { limb: 'uninvolved', value: 40, takenAt },
          ],
        },
        {
          key: pain.key,
          consultationId: null,
          notTestedReason: null,
          readings: [{ limb: null, value: 6, takenAt: startedAt }],
        },
      ]);
      const view = await baselineView(fakeTx as never, stored({ number: 1, status: 'signed' }));
      expect(view?.items.map((item) => [item.key, item.source, item.reading, item.reason])).toEqual(
        [
          [
            quadriceps.key,
            'consultation',
            'Involved 32 kg, uninvolved 40 kg · LSI 80% · Not yet',
            null,
          ],
          [pain.key, 'session', '6/10', null],
          [effusion.key, 'not_tested', null, 'Swelling'],
        ],
      );
      expect(
        db.consultationMeasuresBetween,
        'a signed baseline is never worked out again',
      ).not.toHaveBeenCalled();
    });
  });

  // SES-05: each ticked modality's parameters, and a reason when it warns about a precaution.
  it('gives the note its modalities with the episode’s precautions, and closes only when filled', async () => {
    db.planForSession.mockResolvedValue({ interventions: [], modalities: [], homeProgramme: [] });
    db.sessionVisit.mockResolvedValue(visit());
    db.sessionProgress.mockResolvedValue(
      new Map([[appointmentId, { number: 3, planned: 12, episodeStatus: 'active' }]]),
    );
    db.episodeRecord.mockResolvedValue({ id: episodeId, status: 'active', centreId: hsr });
    db.signedNotesOf.mockResolvedValue([]);
    db.signedSessionNotesOf.mockResolvedValue([]);
    db.patientAlertHistory.mockResolvedValue([]);
    db.episodePrecautions.mockResolvedValue([{ key: 'pregnancy', label: 'Pregnancy' }]);
    const screen = await loadSession(staff(), appointmentId);
    expect(screen?.note?.modalities).toEqual([
      {
        key: 'radial_shockwave',
        name: 'Radial Shockwave (RSW)',
        parameters: shockwave.parameters,
        warnings: [{ label: 'Pregnancy', source: 'SOP 12.3' }],
        consent: 'agreed',
      },
    ]);
    expect(db.sessionModalities).toHaveBeenCalledWith(fakeTx, 'kb-1');

    const ticked = (extra: Partial<SessionNote['treatment']>) =>
      stored({
        note: {
          ...complete(),
          treatment: { ...complete().treatment, modalities: ['radial_shockwave'], ...extra },
        },
      });
    const close = () => closeSession(context(), { appointmentId, baseVersion: 4 });
    db.sessionNoteOf.mockResolvedValueOnce(ticked({}));
    await expect(close()).rejects.toThrow('Fill the parameters for Radial Shockwave (RSW).');
    db.sessionNoteOf.mockResolvedValueOnce(
      ticked({ parameters: { radial_shockwave: { area: 'Achilles' } } }),
    );
    await expect(close()).rejects.toThrow(
      'Give a reason for Radial Shockwave (RSW) despite Pregnancy.',
    );
    db.sessionNoteOf.mockResolvedValueOnce(
      ticked({
        parameters: { radial_shockwave: { area: 'Achilles' } },
        reasons: { radial_shockwave: 'Postpartum, cleared by the obstetrician' },
      }),
    );
    await expect(close()).resolves.toEqual({ status: 'signed' });
    // BIL-04: declined in Part B, it is not given.
    db.partBForEpisode.mockResolvedValueOnce(partB(false));
    db.sessionNoteOf.mockResolvedValueOnce(
      ticked({
        parameters: { radial_shockwave: { area: 'Achilles' } },
        reasons: { radial_shockwave: 'Postpartum, cleared by the obstetrician' },
      }),
    );
    await expect(close()).rejects.toThrow(
      'The patient declined Radial Shockwave (RSW) in Part B consent: untick it.',
    );
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
