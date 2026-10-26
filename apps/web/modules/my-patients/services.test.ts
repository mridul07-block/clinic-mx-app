import type { Db, StaffMember } from '@clinic-mx/db';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NotAllowedError, ReadOnlyError } from '../access/guard';
import { SchedulingError } from '../scheduling/services';
import { loadColleagues, loadMyPatients, startVisit } from './services';

const fakeTx = { kind: 'transaction' };
const db = vi.hoisted(() => ({
  withStaffAccess: vi.fn(),
  appointmentRecord: vi.fn(),
  visitToStart: vi.fn(),
  openConsultation: vi.fn(),
  startVisit: vi.fn(),
  myPatientsToday: vi.fn(),
  colleaguesToday: vi.fn(),
  sessionProgress: vi.fn(),
  contentVersion: vi.fn(() => 'v1'),
}));
const { NoKnowledgeVersionError } = vi.hoisted(() => ({
  NoKnowledgeVersionError: class NoKnowledgeVersionError extends Error {},
}));
vi.mock('@clinic-mx/db', () => ({ ...db, NoKnowledgeVersionError }));
vi.mock('../access/staff-db', () => ({
  asStaff: (_actor: unknown, work: (tx: unknown) => unknown) => work(fakeTx),
}));
vi.mock('../settings/settings', () => ({ getSetting: vi.fn(() => Promise.resolve(1)) }));
const openSessionNote = vi.hoisted(() => vi.fn(() => Promise.resolve('session-id')));
vi.mock('../sessions/services', () => ({
  openSessionNote,
  SessionError: class SessionError extends Error {},
}));

const hsr = '00000000-0000-4000-8000-000000000101';
const appointmentId = '00000000-0000-4000-8000-000000000901';
const physio = (extra: Partial<StaffMember> = {}): StaffMember => ({
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
const context = (actor = physio()) => ({ db: {} as Db, actor });
const visit = (extra: Record<string, unknown> = {}) => ({
  id: appointmentId,
  centreId: hsr,
  physioId: physio().id,
  status: 'checked_in',
  startsAt: new Date(),
  episodeId: '00000000-0000-4000-8000-000000000501',
  typeKey: 'session',
  ...extra,
});
/** The appointment as the target check and Start read it. */
const found = (value: ReturnType<typeof visit> | undefined) => {
  db.appointmentRecord.mockResolvedValue(value);
  db.visitToStart.mockResolvedValue(value);
  // As the database: progress only for a session type, in an Active episode by default (SES-01).
  db.sessionProgress.mockResolvedValue(
    value?.typeKey === 'session'
      ? new Map([[value.id, { number: 1, planned: 12, episodeStatus: 'active' }]])
      : new Map(),
  );
};
const consultationId = '00000000-0000-4000-8000-000000000a01';

// CLN-01: a treating physio's own visits today; Start marks their checked in visit In progress.
describe('my patients today', () => {
  beforeEach(() => {
    for (const fn of Object.values(db)) fn.mockReset();
    db.openConsultation.mockResolvedValue(consultationId);
    db.withStaffAccess.mockImplementation(
      (_db: Db, _context: unknown, work: (tx: unknown) => unknown) => work(fakeTx),
    );
    db.contentVersion.mockReturnValue('v1');
    db.startVisit.mockResolvedValue({ id: appointmentId });
    // A session in an Active episode by default: its gate is met (SES-01).
    db.sessionProgress.mockImplementation((_tx: unknown, ids: string[]) =>
      Promise.resolve(
        new Map(ids.map((id) => [id, { number: 1, planned: 12, episodeStatus: 'active' }])),
      ),
    );
  });

  it('lists the person’s own visits today, for those with the Treats patients tick', async () => {
    db.myPatientsToday.mockResolvedValue([]);
    const view = await loadMyPatients(physio());
    expect(view.version).toBe('v1');
    expect(db.myPatientsToday).toHaveBeenCalledWith(fakeTx, {
      staffId: physio().id,
      date: view.date,
    });
    await expect(loadMyPatients(physio({ treatsPatients: false }))).rejects.toThrow(
      NotAllowedError,
    );
    await expect(
      loadMyPatients(physio({ role: 'front_desk', treatsPatients: false })),
    ).rejects.toThrow(NotAllowedError);
  });

  it('starts the physio’s own checked in visit, as them, and opens its session screen', async () => {
    found(visit());
    await expect(startVisit(context(), { appointmentId })).resolves.toEqual({
      sessionAppointmentId: appointmentId,
    });
    expect(db.openConsultation).not.toHaveBeenCalled();
    // SES-03: the session's note opens with it.
    expect(openSessionNote).toHaveBeenCalledWith(fakeTx, {
      id: appointmentId,
      episodeId: '00000000-0000-4000-8000-000000000501',
      physioId: physio().id,
    });
    expect(db.startVisit).toHaveBeenCalledWith(
      fakeTx,
      expect.objectContaining({ appointmentId, by: physio().id }),
    );
  });

  it('starts a session only once its gate is met (SES-01); consultations have none', async () => {
    found(visit());
    const progress = (episodeStatus: string | null) =>
      db.sessionProgress.mockResolvedValueOnce(
        new Map([[appointmentId, { number: 2, planned: 12, episodeStatus }]]),
      );
    progress('plan_proposed');
    await expect(startVisit(context(), { appointmentId })).rejects.toThrow(
      new SchedulingError('Consent and payment are needed before the first session.'),
    );
    progress('on_hold');
    await expect(startVisit(context(), { appointmentId })).rejects.toThrow(
      'The episode is On hold.',
    );
    progress(null);
    await expect(startVisit(context(), { appointmentId })).rejects.toThrow(
      'Not part of an episode yet.',
    );
    expect(db.startVisit).not.toHaveBeenCalled();
    progress('under_review');
    await expect(startVisit(context(), { appointmentId })).resolves.toEqual({
      sessionAppointmentId: appointmentId,
    });
    // Not a session type: no progress, no gate.
    db.sessionProgress.mockResolvedValueOnce(new Map());
    await expect(startVisit(context(), { appointmentId })).resolves.toEqual({});
  });

  it('refuses someone else’s visit, one not checked in, one started, and another day', async () => {
    const refused = async (extra: Record<string, unknown>, message: string) => {
      found(visit(extra));
      await expect(startVisit(context(), { appointmentId })).rejects.toThrow(message);
    };
    await refused(
      { physioId: 'someone-else', typeKey: 'consultation' },
      'Only the physio of this appointment can start it.',
    );
    await refused({ status: 'booked' }, 'Check the patient in first.');
    await refused({ status: 'in_progress' }, 'This visit has started already.');
    await refused(
      // eslint-disable-next-line no-restricted-syntax -- two days back on purpose: another day
      { startsAt: new Date(Date.now() - 2 * 24 * 3600_000) },
      'A visit is started on its own day.',
    );
    found(undefined);
    await expect(startVisit(context(), { appointmentId })).rejects.toThrow(SchedulingError);
    expect(db.startVisit).not.toHaveBeenCalled();
  });

  // SES-08 done when: physios see colleagues' patients in their centres; notes signed by the
  // writer. Decisions (user, 26 October 2026): a colleague's session is started here to cover it.
  it('lets a physio at its centre cover a colleague’s session, and nothing else', async () => {
    found(visit({ physioId: 'someone-else' }));
    await expect(startVisit(context(), { appointmentId })).resolves.toEqual({
      sessionAppointmentId: appointmentId,
    });
    // The note is the covering physio's own.
    expect(openSessionNote).toHaveBeenLastCalledWith(fakeTx, {
      id: appointmentId,
      episodeId: '00000000-0000-4000-8000-000000000501',
      physioId: physio().id,
    });
    // At another centre the access check refuses it first.
    found(visit({ physioId: 'someone-else', centreId: 'another-centre' }));
    await expect(startVisit(context(), { appointmentId })).rejects.toThrow(NotAllowedError);
    expect(db.startVisit).toHaveBeenCalledOnce();
  });

  it('lists colleagues’ visits at the person’s centres, for those who treat patients', async () => {
    db.colleaguesToday.mockResolvedValue([
      { id: 'a1', centreId: hsr, physioId: 'p2' },
      { id: 'a2', centreId: 'another-centre', physioId: 'p3' },
    ]);
    const rows = await loadColleagues(physio());
    expect(rows.map((row) => row.id)).toEqual(['a1']);
    expect(rows[0]?.session?.label).toBe('Session 1 of 12');
    await expect(loadColleagues(physio({ support: true }))).rejects.toThrow(NotAllowedError);
    expect(db.colleaguesToday).toHaveBeenCalledOnce();
  });

  // CLN-02: Start consultation opens the consultation, for a consultant once the form is in.
  it('opens the consultation when a consultant starts one', async () => {
    const consultant = physio({ consultant: true });
    found(visit({ typeKey: 'consultation' }));
    await expect(startVisit(context(consultant), { appointmentId })).resolves.toEqual({
      consultationId,
    });
    expect(db.openConsultation).toHaveBeenCalledWith(fakeTx, {
      appointmentId,
      episodeId: '00000000-0000-4000-8000-000000000501',
      physioId: consultant.id,
    });
  });

  it('refuses a consultation without the Consultant tick or before the health form', async () => {
    found(visit({ typeKey: 'consultation' }));
    await expect(startVisit(context(), { appointmentId })).rejects.toThrow(
      'Only a consultant starts a consultation.',
    );
    found(visit({ typeKey: 'consultation', episodeId: null }));
    await expect(
      startVisit(context(physio({ consultant: true })), { appointmentId }),
    ).rejects.toThrow('The health form is needed before the consultation.');
    expect(db.startVisit).not.toHaveBeenCalled();
    expect(db.openConsultation).not.toHaveBeenCalled();
  });

  it('says so when the knowledge base is not loaded', async () => {
    found(visit({ typeKey: 'consultation' }));
    db.openConsultation.mockRejectedValue(new NoKnowledgeVersionError());
    await expect(
      startVisit(context(physio({ consultant: true })), { appointmentId }),
    ).rejects.toThrow('The knowledge base is not loaded yet.');
  });

  it('refuses those without the tick, and Velyx support, who only reads', async () => {
    await expect(
      startVisit(context(physio({ treatsPatients: false })), { appointmentId }),
    ).rejects.toThrow(NotAllowedError);
    await expect(
      startVisit(context(physio({ role: 'super_admin', support: true })), { appointmentId }),
    ).rejects.toThrow(ReadOnlyError);
  });
});
