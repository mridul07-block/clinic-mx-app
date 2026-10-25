import type { Db, StaffMember } from '@clinic-mx/db';
import { screeningItems } from '@clinic-mx/schemas';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NotAllowedError, ReadOnlyError } from '../access/guard';
import {
  ConsultationError,
  addAddendumService,
  loadConsultation,
  saveConsultation,
  signConsultationService,
} from './services';

const fakeTx = { kind: 'transaction' };
const db = vi.hoisted(() => ({
  withStaffAccess: vi.fn(),
  consultationRecord: vi.fn(),
  consultationIntake: vi.fn(),
  knowledgeObjective: vi.fn(),
  knowledgeAssessment: vi.fn(),
  knowledgePlan: vi.fn(),
  treatingPhysios: vi.fn(),
  saveConsultationSections: vi.fn(),
  consultationAddenda: vi.fn(),
  staffTreatsNow: vi.fn(),
  signConsultation: vi.fn(),
  addAddendum: vi.fn(),
  logClinicalView: vi.fn(),
  recordStaffName: vi.fn(),
  episodeRecord: vi.fn(),
  updateEpisodeState: vi.fn(),
}));
vi.mock('@clinic-mx/db', () => db);
const settings: Record<string, number> = {
  'assessment.irritability_high_above': 5,
  'assessment.irritability_low_below': 3,
  'assessment.acute_weeks_below': 3,
  'assessment.chronic_weeks_above': 12,
  'clinical.review_weeks': 6,
};
vi.mock('../settings/settings', () => ({
  getSetting: (key: string) => Promise.resolve(settings[key]),
}));
vi.mock('../access/staff-db', () => ({
  asStaffViewing: (_actor: unknown, work: (tx: unknown) => unknown) => work(fakeTx),
}));

const consultationId = '00000000-0000-4000-8000-000000000a01';
const consultant = (extra: Partial<StaffMember> = {}): StaffMember => ({
  id: '00000000-0000-4000-8000-000000000204',
  email: 'consultant@clinicmx.test',
  name: 'Test Consultant',
  role: 'physiotherapist',
  treatsPatients: true,
  consultant: true,
  centreIds: ['00000000-0000-4000-8000-000000000101'],
  support: false,
  ...extra,
});
const context = (actor = consultant()) => ({ db: {} as Db, actor });
const centreId = '00000000-0000-4000-8000-000000000101';
const record = (extra: Record<string, unknown> = {}) => ({
  id: consultationId,
  centreId,
  // 10:00 IST on 24 October 2026.
  startsAt: new Date('2026-10-24T04:30:00Z'),
  physioId: consultant().id,
  kbVersionId: 'kb-version-1',
  episodeId: 'episode-1',
  appointmentId: 'visit-1',
  signedByName: null,
  status: 'draft',
  version: 3,
  sections: { subjective: { notes: 'Saved before' } },
  ...extra,
});
const sections = {
  subjective: { notes: 'Pain on stairs', confirmed: {} },
  screening: { notes: '', confirmed: {} },
  objective: { notes: '', region: '' as const, side: '' as const, measures: {}, tests: [] },
  assessment: {
    notes: '',
    conditionId: 'KNE-001',
    movement: 'Dynamic valgus',
    irritability: 'moderate' as const,
    stage: 'subacute' as const,
    categoryCode: '',
    provisional: true,
  },
  plan: {
    notes: '',
    goals: [],
    interventions: [],
    modalities: [],
    sessionsPerWeek: null,
    weeks: null,
    homeProgramme: [],
    reviewDate: '',
    questionnaires: null,
    treatingPhysioId: '',
    investigations: '',
    referral: '',
  },
};
const save = (actor = consultant()) =>
  saveConsultation(context(actor), { consultationId, value: sections, baseVersion: 3 });

// CLN-02: only its own consultant writes a consultation, at the version they started from.
describe('consultation', () => {
  beforeEach(() => {
    for (const fn of Object.values(db)) fn.mockReset();
    db.withStaffAccess.mockImplementation(
      (_db: Db, _context: unknown, work: (tx: unknown) => unknown) => work(fakeTx),
    );
    db.consultationRecord.mockResolvedValue(record());
    db.consultationIntake.mockResolvedValue({
      formVersion: 'hf-3',
      answers: { complaint: 'Pain' },
    });
    db.knowledgeObjective.mockResolvedValue({ measures: [], specialTests: [] });
    db.knowledgeAssessment.mockResolvedValue({ conditions: [], categories: [] });
    db.knowledgePlan.mockResolvedValue({ modalities: [], questionnaires: [] });
    db.treatingPhysios.mockResolvedValue([{ id: consultant().id, name: 'Test Consultant' }]);
    db.saveConsultationSections.mockResolvedValue({ status: 'saved', version: 4 });
    db.consultationAddenda.mockResolvedValue([]);
    db.staffTreatsNow.mockResolvedValue(true);
    db.signConsultation.mockResolvedValue('signed');
    db.addAddendum.mockResolvedValue({ id: 'addendum-1' });
    db.recordStaffName.mockResolvedValue('Treating Physio Elsewhere');
  });

  it('opens the consultant’s own consultation with every section', async () => {
    const view = await loadConsultation(consultant(), consultationId);
    expect(view?.sections.subjective.notes).toBe('Saved before');
    expect(view?.sections.plan.notes).toBe('');
    expect(view?.patientAnswers).toEqual({ complaint: 'Pain' });
    expect(view?.objectiveCatalog).toEqual({ measures: [], specialTests: [] });
    expect(db.knowledgeObjective).toHaveBeenCalledWith(fakeTx, 'kb-version-1');
    expect(view?.assessmentCatalog).toEqual({ conditions: [], categories: [] });
    expect(db.knowledgeAssessment).toHaveBeenCalledWith(fakeTx, 'kb-version-1');
    expect(view?.assessmentSettings).toEqual({
      irritabilityHighAbove: 5,
      irritabilityLowBelow: 3,
      acuteWeeksBelow: 3,
      chronicWeeksAbove: 12,
    });
    expect(view?.sections.assessment.provisional).toBe(true);
    // CLN-07: the plan catalog, who can treat at the centre, and the plan's defaults.
    expect(db.knowledgePlan).toHaveBeenCalledWith(fakeTx, 'kb-version-1');
    expect(db.treatingPhysios).toHaveBeenCalledWith(fakeTx, centreId);
    expect(view?.treatingPhysios).toEqual([{ id: consultant().id, name: 'Test Consultant' }]);
    // A consultant not assigned to the centre is still offered, as the default.
    db.treatingPhysios.mockResolvedValue([{ id: 'other', name: 'Another Physio' }]);
    expect((await loadConsultation(consultant(), consultationId))?.treatingPhysios).toEqual([
      { id: 'other', name: 'Another Physio' },
      { id: consultant().id, name: 'Test Consultant' },
    ]);
    expect(view?.planDefaults).toEqual({
      visitDate: '2026-10-24',
      reviewWeeks: 6,
      consultantId: consultant().id,
    });
    db.consultationIntake.mockResolvedValue(undefined);
    expect((await loadConsultation(consultant(), consultationId))?.patientAnswers).toEqual({});
    expect(view?.editable).toBe(true);
    db.consultationRecord.mockResolvedValue(record({ physioId: 'someone-else' }));
    await expect(loadConsultation(consultant(), consultationId)).resolves.toBeUndefined();
    await expect(loadConsultation(consultant(), 'not-an-id')).resolves.toBeUndefined();
    // Someone else's draft stays theirs; a front desk reads no consultation.
    await expect(
      loadConsultation(consultant({ consultant: false }), consultationId),
    ).resolves.toBeUndefined();
    await expect(
      loadConsultation(
        consultant({ role: 'front_desk', treatsPatients: false, consultant: false }),
        consultationId,
      ),
    ).rejects.toThrow(NotAllowedError);
  });

  // CLN-09: once signed, clinicians at its centre read it and add addenda.
  it('opens a signed consultation read only, with its addenda, to a colleague', async () => {
    db.consultationRecord.mockResolvedValue(
      record({ status: 'signed', physioId: 'someone-else', signedByName: 'Dr Signer' }),
    );
    db.consultationAddenda.mockResolvedValue([{ id: 'a1', text: 'Seen again' }]);
    const view = await loadConsultation(consultant({ consultant: false }), consultationId);
    expect(view).toMatchObject({ editable: false, addsAddenda: true });
    expect(view?.addenda).toEqual([{ id: 'a1', text: 'Seen again' }]);
    expect(db.consultationAddenda).toHaveBeenCalledWith(fakeTx, consultationId);
    // CLN-12: logged as a record view; its consultant's own opening is not.
    expect(db.logClinicalView).toHaveBeenCalledWith(fakeTx, 'consultation', consultationId);
    db.logClinicalView.mockClear();
    db.consultationRecord.mockResolvedValue(record({ status: 'signed' }));
    await loadConsultation(consultant(), consultationId);
    expect(db.logClinicalView).not.toHaveBeenCalled();
  });

  // CLN-12: clinicians read a signed consultation at any centre; addenda stay with its centre.
  it('opens a signed consultation at another centre without the addendum form', async () => {
    const treating = '00000000-0000-4000-8000-000000000299';
    db.consultationRecord.mockResolvedValue(
      record({
        status: 'signed',
        physioId: 'someone-else',
        centreId: '00000000-0000-4000-8000-000000000102',
        sections: { plan: { treatingPhysioId: treating } },
      }),
    );
    const view = await loadConsultation(consultant({ consultant: false }), consultationId);
    expect(view).toMatchObject({ editable: false, addsAddenda: false });
    expect(view?.treatingPhysios).toContainEqual({
      id: treating,
      name: 'Treating Physio Elsewhere',
    });
    expect(db.logClinicalView).toHaveBeenCalledWith(fakeTx, 'consultation', consultationId);
    // The Super Admin reads it without the tick, and adds no addendum without it.
    const admin = consultant({ role: 'super_admin', treatsPatients: false, consultant: false });
    expect(await loadConsultation(admin, consultationId)).toMatchObject({ addsAddenda: false });
  });

  it('saves the sections at the version the draft started from', async () => {
    await expect(save()).resolves.toEqual({ status: 'saved', version: 4 });
    expect(db.saveConsultationSections).toHaveBeenCalledWith(fakeTx, consultationId, 3, sections);
  });

  it('answers a conflict with what is saved', async () => {
    db.saveConsultationSections.mockResolvedValue({
      status: 'conflict',
      version: 5,
      row: record({ version: 5, sections: { plan: { notes: 'Elsewhere' } } }),
    });
    const result = await save();
    expect(result.status).toBe('conflict');
    expect(result.status === 'conflict' && result.value.plan.notes).toBe('Elsewhere');
  });

  it('refuses someone else’s consultation, a signed one, and those who cannot write', async () => {
    db.consultationRecord.mockResolvedValue(record({ physioId: 'someone-else' }));
    await expect(save()).rejects.toThrow(ConsultationError);
    db.consultationRecord.mockResolvedValue(record({ status: 'signed' }));
    await expect(save()).rejects.toThrow('This consultation is signed. Changes are addenda.');
    expect(db.saveConsultationSections).not.toHaveBeenCalled();
    await expect(save(consultant({ consultant: false }))).rejects.toThrow(NotAllowedError);
    await expect(save(consultant({ role: 'super_admin', support: true }))).rejects.toThrow(
      ReadOnlyError,
    );
  });

  describe('signing', () => {
    // Every screening item answered and the four parts filled: nothing holds signing back.
    const confirmed = Object.fromEntries(
      screeningItems(undefined, undefined, {}).map((item) => [
        item.key,
        item.input === 'number' ? 0 : false,
      ]),
    );
    const ready = { ...sections, screening: { notes: '', confirmed } };
    const sign = (actor = consultant(), baseVersion = 3) =>
      signConsultationService(context(actor), { consultationId, baseVersion });

    beforeEach(() => {
      db.consultationRecord.mockResolvedValue(record({ sections: ready }));
      db.consultationIntake.mockResolvedValue({ formVersion: 'hf-3', answers: {} });
      db.knowledgeAssessment.mockResolvedValue({
        conditions: [
          {
            conditionId: 'KNE-001',
            name: 'Patellofemoral Pain Syndrome',
            synonyms: [],
            homeRegion: 'knee',
            categoryCode: null,
            listings: [],
          },
        ],
        categories: [],
      });
    });

    it('signs at the version seen and writes the rows of the record', async () => {
      db.episodeRecord.mockResolvedValue({ id: 'episode-1', status: 'awaiting_consultation' });
      db.updateEpisodeState.mockResolvedValue(true);
      await expect(sign()).resolves.toEqual({ status: 'signed' });
      // BIL-01: the episode moves on to Plan proposed.
      expect(db.updateEpisodeState).toHaveBeenCalledWith(
        fakeTx,
        'episode-1',
        'awaiting_consultation',
        expect.objectContaining({ status: 'plan_proposed' }),
        undefined,
      );
      expect(db.staffTreatsNow).toHaveBeenCalledWith(fakeTx, consultant().id);
      const [tx, request] = db.signConsultation.mock.calls[0] as [unknown, unknown];
      expect(tx).toBe(fakeTx);
      expect(request).toMatchObject({
        consultationId,
        baseVersion: 3,
        by: consultant().id,
        episodeId: 'episode-1',
        appointmentId: 'visit-1',
        kbVersionId: 'kb-version-1',
        rows: {
          diagnosis: { conditionId: 'KNE-001', stage: 'subacute' },
          plan: { reviewDate: '2026-12-05', treatingPhysioId: consultant().id },
        },
      });
    });

    it('leaves an episode a red flag put On hold where it is', async () => {
      db.episodeRecord.mockResolvedValue({
        id: 'episode-1',
        status: 'on_hold',
        pausedFrom: 'awaiting_consultation',
      });
      await expect(sign()).resolves.toEqual({ status: 'signed' });
      expect(db.updateEpisodeState).not.toHaveBeenCalled();
    });

    it('refuses without the tick now, with anything held back, or at an older version', async () => {
      db.staffTreatsNow.mockResolvedValue(false);
      await expect(sign()).rejects.toThrow('Signing needs the Treats patients tick.');
      db.staffTreatsNow.mockResolvedValue(true);
      await expect(sign(consultant(), 2)).rejects.toThrow(
        'Your latest changes are still saving. Try again.',
      );
      db.consultationRecord.mockResolvedValue(record());
      await expect(sign()).rejects.toThrow('Signing needs every screening item confirmed');
      db.consultationRecord.mockResolvedValue(
        record({
          sections: { ...ready, assessment: { ...ready.assessment, conditionId: 'KNE-999' } },
        }),
      );
      await expect(sign()).rejects.toThrow('Condition "KNE-999" is not in this consultation');
      expect(db.signConsultation).not.toHaveBeenCalled();
      db.consultationRecord.mockResolvedValue(record({ sections: ready }));
      db.signConsultation.mockResolvedValue('stale');
      await expect(sign()).rejects.toThrow('Your latest changes are still saving. Try again.');
    });

    it('refuses another consultant, a signed one, and anyone without the ticks', async () => {
      db.consultationRecord.mockResolvedValue(record({ physioId: 'someone-else' }));
      await expect(sign()).rejects.toThrow('That consultation was not found.');
      db.consultationRecord.mockResolvedValue(record({ status: 'signed' }));
      await expect(sign()).rejects.toThrow('This consultation is signed. Changes are addenda.');
      await expect(sign(consultant({ treatsPatients: false }))).rejects.toThrow(NotAllowedError);
      expect(db.signConsultation).not.toHaveBeenCalled();
    });
  });

  it('adds an addendum to a signed consultation only, with the tick now', async () => {
    const add = (actor = consultant({ consultant: false })) =>
      addAddendumService(context(actor), { consultationId, text: ' Seen again ' });
    db.consultationRecord.mockResolvedValue(record({ status: 'signed' }));
    await expect(add()).resolves.toEqual({ id: 'addendum-1' });
    expect(db.addAddendum).toHaveBeenCalledWith(fakeTx, {
      consultationId,
      episodeId: 'episode-1',
      text: 'Seen again',
      authorId: consultant().id,
    });
    db.staffTreatsNow.mockResolvedValue(false);
    await expect(add()).rejects.toThrow('Adding an addendum needs the Treats patients tick.');
    db.staffTreatsNow.mockResolvedValue(true);
    db.consultationRecord.mockResolvedValue(record());
    await expect(add()).rejects.toThrow('Addenda are added once the consultation is signed.');
    await expect(
      add(consultant({ role: 'front_desk', treatsPatients: false, consultant: false })),
    ).rejects.toThrow(NotAllowedError);
  });
});
