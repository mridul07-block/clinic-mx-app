import type { Db, StaffMember } from '@clinic-mx/db';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NotAllowedError, ReadOnlyError } from '../access/guard';
import { ReassessmentError, loadReassessment, signReassessmentDecision } from './services';

const fakeTx = { kind: 'transaction' };
const db = vi.hoisted(() => ({
  withStaffAccess: vi.fn(),
  logClinicalView: vi.fn(),
  reassessmentById: vi.fn(),
  sessionVisit: vi.fn(),
  signReassessment: vi.fn(),
  staffTreatsNow: vi.fn(),
  frozenBaselineOfEpisode: vi.fn(),
  knowledgeObjective: vi.fn(),
  sessionReadings: vi.fn(),
  reassessmentOfSession: vi.fn(),
}));
vi.mock('@clinic-mx/db', () => db);
vi.mock('../access/staff-db', () => ({
  asStaffViewing: (_actor: unknown, work: (tx: unknown) => unknown) => work(fakeTx),
}));
vi.mock('../settings/settings', () => ({ getSetting: vi.fn() }));

const hsr = '00000000-0000-4000-8000-000000000101';
const reassessmentId = '00000000-0000-4000-8000-000000000a01';
const consultant: StaffMember = {
  id: '00000000-0000-4000-8000-000000000207',
  email: 'consultant@clinicmx.test',
  name: 'Dr Test Consultant',
  role: 'physiotherapist',
  treatsPatients: true,
  consultant: true,
  centreIds: [hsr],
  support: false,
};
const physio: StaffMember = {
  ...consultant,
  id: '00000000-0000-4000-8000-000000000208',
  consultant: false,
};
const otherConsultant: StaffMember = { ...consultant, id: '00000000-0000-4000-8000-000000000209' };
const found = (extra: Record<string, unknown> = {}) => ({
  id: reassessmentId,
  episodeId: 'episode-1',
  sessionId: 'session-4',
  kbVersionId: 'kb-1',
  consultantId: consultant.id,
  consultantName: consultant.name,
  notTested: {},
  decision: null,
  signedByName: null,
  signedAt: null,
  createdAt: new Date(),
  sessionNumber: 4,
  appointmentId: 'visit-4',
  ...extra,
});
const sign = (actor: StaffMember, decision = 'Continue the plan.') =>
  signReassessmentDecision({ db: {} as Db, actor }, { reassessmentId, decision });

// OUT-05: the episode's consultant reviews baseline against session 4 and signs a written
// decision once, with the Treats patients tick read now (decision 7 default).
describe('the reassessment review', () => {
  beforeEach(() => {
    for (const fn of Object.values(db)) fn.mockReset();
    db.withStaffAccess.mockImplementation(
      (_db: Db, _context: unknown, work: (tx: unknown) => unknown) => work(fakeTx),
    );
    db.reassessmentById.mockResolvedValue(found());
    db.sessionVisit.mockResolvedValue({ id: 'visit-4', patientId: 'patient-1' });
    db.frozenBaselineOfEpisode.mockResolvedValue([]);
    db.staffTreatsNow.mockResolvedValue(true);
    db.signReassessment.mockResolvedValue('signed');
  });

  it('lets only the episode’s consultant sign, while unsigned, and logs the view', async () => {
    expect((await loadReassessment(consultant, reassessmentId))?.signs).toBe(true);
    expect(db.logClinicalView).toHaveBeenCalledWith(fakeTx, 'patient', 'patient-1');
    expect((await loadReassessment(otherConsultant, reassessmentId))?.signs).toBe(false);
    expect((await loadReassessment(physio, reassessmentId))?.signs).toBe(false);
    db.reassessmentById.mockResolvedValueOnce(
      found({ decision: 'Done', signedAt: new Date(), signedByName: consultant.name }),
    );
    const signed = await loadReassessment(consultant, reassessmentId);
    expect(signed?.signs).toBe(false);
    expect(signed?.decision?.text).toBe('Done');
    db.reassessmentById.mockResolvedValueOnce(undefined);
    expect(await loadReassessment(consultant, reassessmentId)).toBeUndefined();
    await expect(
      loadReassessment(
        { ...consultant, role: 'front_desk', treatsPatients: false },
        reassessmentId,
      ),
    ).rejects.toThrow(NotAllowedError);
  });

  it('signs the written decision as the consultant', async () => {
    await expect(sign(consultant, '  Strength on track; continue.  ')).resolves.toEqual({
      status: 'signed',
    });
    expect(db.signReassessment).toHaveBeenCalledWith(fakeTx, {
      id: reassessmentId,
      decision: 'Strength on track; continue.',
      by: consultant.id,
    });
  });

  it('refuses another consultant, a physio, no tick, a signed one, an empty decision and support', async () => {
    await expect(sign(otherConsultant)).rejects.toThrow(
      new ReassessmentError('Only the episode’s consultant signs this decision.'),
    );
    await expect(sign(physio)).rejects.toThrow(NotAllowedError);
    db.staffTreatsNow.mockResolvedValueOnce(false);
    await expect(sign(consultant)).rejects.toThrow('Signing needs the Treats patients tick.');
    db.reassessmentById.mockResolvedValueOnce(found({ signedAt: new Date(), decision: 'Done' }));
    await expect(sign(consultant)).rejects.toThrow('This decision is signed already.');
    await expect(sign(consultant, ' ')).rejects.toThrow('Write the decision.');
    await expect(sign({ ...consultant, support: true })).rejects.toThrow(ReadOnlyError);
    expect(db.signReassessment).not.toHaveBeenCalled();
  });
});
