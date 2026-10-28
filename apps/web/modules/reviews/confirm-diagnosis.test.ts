import type { Db, StaffMember } from '@clinic-mx/db';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NotAllowedError, ReadOnlyError } from '../access/guard';
import { confirmDiagnosisView, confirmEpisodeDiagnosis } from './confirm-diagnosis';
import { ReviewError } from './errors';

const fakeTx = { kind: 'transaction' };
const db = vi.hoisted(() => ({
  withStaffAccess: vi.fn(),
  episodeRecord: vi.fn(),
  episodeReviewed: vi.fn(),
  knowledgeAssessment: vi.fn(),
  latestConfirmedDiagnosis: vi.fn(),
  latestSignedDiagnosis: vi.fn(),
  recordConfirmedDiagnosis: vi.fn(),
  staffTreatsNow: vi.fn(),
}));
vi.mock('@clinic-mx/db', () => db);

const hsr = '00000000-0000-4000-8000-000000000101';
const episodeId = '00000000-0000-4000-8000-000000000501';
const consultant: StaffMember = {
  id: '00000000-0000-4000-8000-000000000207',
  email: 'consultant@clinicmx.test',
  name: 'Test Consultant',
  role: 'physiotherapist',
  treatsPatients: true,
  consultant: true,
  centreIds: [hsr],
  support: false,
};
const physio: StaffMember = { ...consultant, consultant: false };
const context = (actor: StaffMember) => ({ db: {} as Db, actor });
const signed = { id: 'd1', kbVersionId: 'v1', conditionId: 'KNE-001', name: 'Fake condition 1' };
const condition = (conditionId: string) => ({
  conditionId,
  name: `Fake ${conditionId}`,
  synonyms: [],
  homeRegion: 'knee',
  categoryCode: null,
  listings: [{ region: 'knee', rowNumber: 1, name: `Fake ${conditionId}` }],
});

// AI-05: the diagnosis confirmed at review or discharge, by a consultant with the Treats patients
// tick, from the signed diagnosis's knowledge base version; the database stamps the stage.
describe('the confirmed diagnosis', () => {
  beforeEach(() => {
    for (const fn of Object.values(db)) fn.mockReset();
    db.withStaffAccess.mockImplementation(
      (_db: Db, _context: unknown, work: (tx: unknown) => unknown) => work(fakeTx),
    );
    db.episodeRecord.mockResolvedValue({ id: episodeId, status: 'active' });
    db.staffTreatsNow.mockResolvedValue(true);
    db.episodeReviewed.mockResolvedValue(true);
    db.latestSignedDiagnosis.mockResolvedValue(signed);
    db.latestConfirmedDiagnosis.mockResolvedValue(undefined);
    db.knowledgeAssessment.mockResolvedValue({
      conditions: [condition('KNE-001'), condition('KNE-002')],
      categories: [],
    });
    db.recordConfirmedDiagnosis.mockResolvedValue('review');
  });

  it('confirms or changes the signed diagnosis within its version', async () => {
    expect(
      await confirmEpisodeDiagnosis(context(consultant), { episodeId, conditionId: 'KNE-002' }),
    ).toEqual({ stage: 'review' });
    expect(db.recordConfirmedDiagnosis).toHaveBeenCalledWith(fakeTx, {
      episodeId,
      source: signed,
      conditionId: 'KNE-002',
      by: consultant.id,
    });
    expect(db.knowledgeAssessment).toHaveBeenCalledWith(fakeTx, 'v1');
  });

  it('is refused without the ticks, a signed diagnosis or a condition of its version', async () => {
    const confirm = (actor = consultant, conditionId = 'KNE-001') =>
      confirmEpisodeDiagnosis(context(actor), { episodeId, conditionId });
    await expect(confirm(physio)).rejects.toThrow(NotAllowedError);
    await expect(confirm({ ...consultant, support: true })).rejects.toThrow(ReadOnlyError);
    db.staffTreatsNow.mockResolvedValueOnce(false);
    await expect(confirm()).rejects.toThrow('needs the Treats patients tick');
    db.latestSignedDiagnosis.mockResolvedValueOnce(undefined);
    await expect(confirm()).rejects.toThrow('Sign the consultation');
    await expect(confirm(consultant, 'KNE-999')).rejects.toThrow(ReviewError);
    // Never the first impression: only once the episode has been reviewed or discharged.
    db.episodeReviewed.mockResolvedValueOnce(false);
    await expect(confirm()).rejects.toThrow('confirmed at review or discharge');
    await expect(
      confirmEpisodeDiagnosis(context(consultant), { episodeId, conditionId: '' }),
    ).rejects.toThrow('Choose the condition.');
    expect(db.recordConfirmedDiagnosis).not.toHaveBeenCalled();
  });

  it('shows the signed and confirmed diagnoses, and the picker only to consultants', async () => {
    const at = new Date('2026-10-29T05:00:00Z');
    db.latestConfirmedDiagnosis.mockResolvedValue({
      conditionId: 'KNE-002',
      name: 'Fake KNE-002',
      stage: 'discharge',
      changed: true,
      confirmedByName: 'Test Consultant',
      confirmedAt: at,
    });
    const view = await confirmDiagnosisView(fakeTx as never, consultant, episodeId);
    expect(view).toMatchObject({
      signed: { conditionId: 'KNE-001', name: 'Fake condition 1' },
      confirmed: { conditionId: 'KNE-002', stage: 'discharge', changed: true, at },
      confirms: true,
      region: 'knee',
    });
    expect(view.catalog?.conditions).toHaveLength(2);
    const read = await confirmDiagnosisView(fakeTx as never, physio, episodeId);
    expect(read).toMatchObject({ confirms: false, waitsForReview: false, catalog: null });
    db.episodeReviewed.mockResolvedValueOnce(false);
    expect(await confirmDiagnosisView(fakeTx as never, consultant, episodeId)).toMatchObject({
      confirms: false,
      waitsForReview: true,
      catalog: null,
    });
    db.latestSignedDiagnosis.mockResolvedValue(undefined);
    expect(await confirmDiagnosisView(fakeTx as never, consultant, episodeId)).toMatchObject({
      signed: null,
      confirms: false,
    });
  });
});
