import type { Db, StaffMember } from '@clinic-mx/db';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NotAllowedError, ReadOnlyError } from '../access/guard';
import { ConsultationError, loadConsultation, saveConsultation } from './services';

const fakeTx = { kind: 'transaction' };
const db = vi.hoisted(() => ({
  withStaffAccess: vi.fn(),
  consultationRecord: vi.fn(),
  saveConsultationSections: vi.fn(),
}));
vi.mock('@clinic-mx/db', () => db);
vi.mock('../access/staff-db', () => ({
  asStaff: (_actor: unknown, work: (tx: unknown) => unknown) => work(fakeTx),
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
const record = (extra: Record<string, unknown> = {}) => ({
  id: consultationId,
  physioId: consultant().id,
  status: 'draft',
  version: 3,
  sections: { subjective: { notes: 'Saved before' } },
  ...extra,
});
const sections = {
  subjective: { notes: 'Pain on stairs' },
  screening: { notes: '' },
  objective: { notes: '' },
  assessment: { notes: '' },
  plan: { notes: '' },
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
    db.saveConsultationSections.mockResolvedValue({ status: 'saved', version: 4 });
  });

  it('opens the consultant’s own consultation with every section', async () => {
    const view = await loadConsultation(consultant(), consultationId);
    expect(view?.sections.subjective.notes).toBe('Saved before');
    expect(view?.sections.plan.notes).toBe('');
    db.consultationRecord.mockResolvedValue(record({ physioId: 'someone-else' }));
    await expect(loadConsultation(consultant(), consultationId)).resolves.toBeUndefined();
    await expect(loadConsultation(consultant(), 'not-an-id')).resolves.toBeUndefined();
    await expect(
      loadConsultation(consultant({ consultant: false }), consultationId),
    ).rejects.toThrow(NotAllowedError);
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
});
