import type { Db, StaffMember } from '@clinic-mx/db';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NotAllowedError } from '../access/guard';
import { ConsultationFeeError, setConsultationFeeService } from './services';

const fakeTx = { kind: 'transaction' };
const db = vi.hoisted(() => ({
  withStaffAccess: vi.fn(),
  consultationFeeOptions: vi.fn(),
  setConsultationFee: vi.fn(),
  staffRecord: vi.fn(),
}));
vi.mock('@clinic-mx/db', () => db);
// Test value only; the real one is the `billing.consultation_price_items` row.
vi.mock('../settings/settings', () => ({
  getSetting: vi.fn(() => Promise.resolve(['consultation', 'senior_consultation'])),
}));

const staffUserId = '00000000-0000-4000-8000-000000000207';
const consultation = '00000000-0000-4000-8000-000000000701';
const session = '00000000-0000-4000-8000-000000000702';
const admin: StaffMember = {
  id: '00000000-0000-4000-8000-000000000201',
  email: 'admin@clinicmx.test',
  name: 'Test Super Admin',
  role: 'super_admin',
  treatsPatients: false,
  consultant: false,
  centreIds: [],
  support: false,
};
const context = (actor = admin) => ({ db: {} as Db, actor });

// SCH-05 (decision G4): the Super Admin sets a consultant's consultation fee from the listed
// price items, or clears it.
describe('consultation fees', () => {
  beforeEach(() => {
    for (const fn of Object.values(db)) fn.mockReset();
    db.withStaffAccess.mockImplementation(
      (_db: Db, _context: unknown, work: (tx: unknown) => unknown) => work(fakeTx),
    );
    db.staffRecord.mockResolvedValue({ id: staffUserId, consultant: true });
    db.consultationFeeOptions.mockResolvedValue([{ id: consultation }]);
    db.setConsultationFee.mockResolvedValue(true);
  });

  it('sets a listed fee for a consultant, or clears it', async () => {
    await setConsultationFeeService(context(), { staffUserId, priceItemId: consultation });
    expect(db.consultationFeeOptions).toHaveBeenCalledWith(fakeTx, [
      'consultation',
      'senior_consultation',
    ]);
    expect(db.setConsultationFee).toHaveBeenCalledWith(fakeTx, staffUserId, consultation);
    await setConsultationFeeService(context(), { staffUserId, priceItemId: '' });
    expect(db.setConsultationFee).toHaveBeenLastCalledWith(fakeTx, staffUserId, null);
  });

  it('refuses another price item, someone who is not a consultant, and other roles', async () => {
    await expect(
      setConsultationFeeService(context(), { staffUserId, priceItemId: session }),
    ).rejects.toThrow('Choose one of the consultation fees listed.');
    db.staffRecord.mockResolvedValueOnce({ id: staffUserId, consultant: false });
    await expect(
      setConsultationFeeService(context(), { staffUserId, priceItemId: consultation }),
    ).rejects.toThrow(ConsultationFeeError);
    await expect(
      setConsultationFeeService(context({ ...admin, role: 'centre_manager', centreIds: [] }), {
        staffUserId,
        priceItemId: consultation,
      }),
    ).rejects.toThrow(NotAllowedError);
    expect(db.setConsultationFee).not.toHaveBeenCalled();
  });
});
