import type { Db, StaffMember } from '@clinic-mx/db';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NotAllowedError } from '../access/guard';
import { makeConsultationBill } from './bills';

const fakeTx = { kind: 'transaction' };
const db = vi.hoisted(() => ({
  withStaffAccess: vi.fn(),
  episodeRecord: vi.fn(),
  consultationFeeState: vi.fn(),
  consultationBillNow: vi.fn(),
}));
vi.mock('@clinic-mx/db', () => db);
const timing = vi.hoisted(() => ({ value: 'after_consultation' }));
vi.mock('../settings/settings', () => ({ getSetting: () => Promise.resolve(timing.value) }));

const hsr = '00000000-0000-4000-8000-000000000101';
const koramangala = '00000000-0000-4000-8000-000000000102';
const episodeId = '00000000-0000-4000-8000-000000000501';
const appointmentId = '00000000-0000-4000-8000-000000000601';
const desk = (extra: Partial<StaffMember> = {}): StaffMember => ({
  id: '00000000-0000-4000-8000-000000000203',
  email: 'desk@clinicmx.test',
  name: 'Test Desk',
  role: 'front_desk',
  treatsPatients: false,
  consultant: false,
  centreIds: [hsr],
  support: false,
  ...extra,
});
const context = (actor = desk()) => ({ db: {} as Db, actor });
const visit = (extra = {}) => ({
  appointmentId,
  status: 'completed',
  consultantName: 'Test Consultant',
  feeLabel: 'Consultation',
  billed: false,
  ...extra,
});

// BIL-05: once the consultant's fee is set, the desk makes the consultation bill the database
// would have made; never before it is due, never twice, never at another centre.
describe('making the consultation bill', () => {
  beforeEach(() => {
    for (const fn of Object.values(db)) fn.mockReset();
    timing.value = 'after_consultation';
    db.withStaffAccess.mockImplementation(
      (_db: Db, _context: unknown, work: (tx: unknown) => unknown) => work(fakeTx),
    );
    db.episodeRecord.mockResolvedValue({ id: episodeId, centreId: hsr });
    db.consultationFeeState.mockResolvedValue(visit());
    db.consultationBillNow.mockResolvedValue('bill');
  });

  it('makes it for the visit once due and the fee is set', async () => {
    await expect(makeConsultationBill(context(), { episodeId })).resolves.toBe('bill');
    expect(db.consultationBillNow).toHaveBeenCalledWith(fakeTx, appointmentId);
  });

  it('says whose fee is not set, and refuses a visit not due or already billed', async () => {
    db.consultationFeeState.mockResolvedValue(visit({ feeLabel: null }));
    await expect(makeConsultationBill(context(), { episodeId })).rejects.toThrow(
      'Consultation fee not set for Test Consultant. Ask the Super Admin to set it on Staff.',
    );
    db.consultationFeeState.mockResolvedValue(visit({ status: 'checked_in' }));
    await expect(makeConsultationBill(context(), { episodeId })).rejects.toThrow(
      'The consultation fee is not due yet.',
    );
    timing.value = 'at_check_in';
    await expect(makeConsultationBill(context(), { episodeId })).resolves.toBe('bill');
    db.consultationFeeState.mockResolvedValue(visit({ billed: true }));
    await expect(makeConsultationBill(context(), { episodeId })).rejects.toThrow(
      'The consultation is already billed.',
    );
  });

  it('refuses the desk at another centre and a physio', async () => {
    await expect(
      makeConsultationBill(context(desk({ centreIds: [koramangala] })), { episodeId }),
    ).rejects.toThrow(NotAllowedError);
    await expect(
      makeConsultationBill(context(desk({ role: 'physiotherapist', treatsPatients: true })), {
        episodeId,
      }),
    ).rejects.toThrow(NotAllowedError);
    expect(db.consultationBillNow).not.toHaveBeenCalled();
  });
});
