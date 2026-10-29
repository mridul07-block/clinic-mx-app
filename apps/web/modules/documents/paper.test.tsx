import type { StaffMember } from '@clinic-mx/db';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { paperFormsPdf } from './paper';

const db = vi.hoisted(() => ({ centreRecord: vi.fn() }));
vi.mock('@clinic-mx/db', () => db);
vi.mock('../access/staff-db', () => ({
  asStaff: (_actor: unknown, work: (tx: unknown) => unknown): unknown => work({}),
}));
vi.mock('../settings/settings', () => ({ getSetting: () => Promise.resolve(18) }));

const hsr = '00000000-0000-4000-8000-000000000101';
const koramangala = '00000000-0000-4000-8000-000000000102';
const member = (extra: Partial<StaffMember> = {}): StaffMember => ({
  id: '00000000-0000-4000-8000-000000000204',
  email: 'frontdesk@clinicmx.test',
  name: 'Test Front Desk',
  role: 'front_desk',
  treatsPatients: false,
  consultant: false,
  centreIds: [hsr],
  support: false,
  ...extra,
});

// OPS-05: the paper health form and Part A consent, for those who check patients in at the centre.
describe('the paper forms', () => {
  beforeEach(() => {
    db.centreRecord.mockReset();
    db.centreRecord.mockResolvedValue({
      id: hsr,
      name: 'HSR Layout',
      code: 'HSR',
      address: '27th Main, HSR Layout',
      phone: '+918041234567',
    });
  });

  it('renders an A4 PDF of several pages on the centre’s letterhead for the desk there', async () => {
    const bytes = await paperFormsPdf(member(), hsr, new Date('2026-10-29T05:00:00Z'));
    expect(bytes).toBeDefined();
    const text = Buffer.from(bytes ?? new Uint8Array()).toString('latin1');
    expect(text.startsWith('%PDF-')).toBe(true);
    expect(text).toMatch(/\/MediaBox \[0 0 595\.2\d* 841\.8\d*\]/);
    expect(text).toMatch(/\/Type \/Pages[^>]*\/Count ([3-9]|\d\d)/);
    expect(text).toMatch(/\/BaseFont \/[A-Z]{6}\+IBMPlexSans\b/);
    expect(db.centreRecord).toHaveBeenCalledWith({}, hsr);
  }, 30_000);

  it('is for the Super Admin and a Centre Manager too, and nobody else', async () => {
    for (const actor of [
      member({ role: 'super_admin', centreIds: [] }),
      member({ role: 'centre_manager' }),
    ]) {
      expect(await paperFormsPdf(actor, hsr), actor.role).toBeDefined();
    }
    for (const actor of [
      member({ centreIds: [koramangala] }),
      member({ role: 'physiotherapist', treatsPatients: true }),
      member({ role: 'finance', centreIds: [] }),
    ]) {
      expect(await paperFormsPdf(actor, hsr), actor.role).toBeUndefined();
    }
    db.centreRecord.mockResolvedValue(undefined);
    expect(await paperFormsPdf(member(), hsr), 'no such centre').toBeUndefined();
  }, 60_000);
});
