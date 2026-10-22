import type { Db, StaffMember } from '@clinic-mx/db';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { centreColours } from '@clinic-mx/schemas';
import { z } from 'zod';
import { NotAllowedError, ReadOnlyError } from '../access/guard';
import { CentreError, addCentre, editCentre, setCentreActiveService } from './services';

const fakeTx = { kind: 'transaction' };
const db = vi.hoisted(() => ({
  withStaffAccess: vi.fn(),
  activeCentreWithColour: vi.fn(),
  centreCodeTaken: vi.fn(),
  centreList: vi.fn(),
  centreNameTaken: vi.fn(),
  centreRecord: vi.fn(),
  insertCentre: vi.fn(),
  setCentreActive: vi.fn(),
  updateCentre: vi.fn(),
}));
vi.mock('@clinic-mx/db', () => db);

const hsr = '00000000-0000-4000-8000-000000000101';
const whitefield = '00000000-0000-4000-8000-000000000103';
const newId = '00000000-0000-4000-8000-000000000109';
const [blue, violet, teal] = centreColours.map((colour) => colour.value) as [
  string,
  string,
  string,
];
const member = (extra: Partial<StaffMember> = {}): StaffMember => ({
  id: '00000000-0000-4000-8000-000000000201',
  email: 'admin@clinicmx.test',
  name: 'Test Super Admin',
  role: 'super_admin',
  treatsPatients: false,
  consultant: false,
  centreIds: [],
  support: false,
  ...extra,
});
const context = (actor = member()) => ({ db: {} as Db, actor });
const details = {
  name: 'Indiranagar',
  code: 'ind',
  address: '100 Feet Rd, Indiranagar, Bengaluru 560038',
  phone: '080 4123 4567',
  mapLink: 'https://maps.app.goo.gl/abc123',
  colour: teal,
};
const centre = (id: string, name: string, colour: string, active = true) => ({
  id,
  name,
  code: name.slice(0, 3).toUpperCase(),
  colour,
  active,
  address: null,
  phone: null,
  mapLink: null,
});

// SET-01 done when: address, map link, phone and chart colour per centre, kept by the Super Admin.
describe('centres', () => {
  beforeEach(() => {
    for (const fn of Object.values(db)) fn.mockReset();
    db.withStaffAccess.mockImplementation(
      (_db: Db, _context: unknown, work: (tx: unknown) => unknown) => work(fakeTx),
    );
    db.centreList.mockResolvedValue([
      centre(hsr, 'HSR Layout', blue),
      centre(whitefield, 'Whitefield', violet),
    ]);
    db.centreNameTaken.mockResolvedValue(false);
    db.centreCodeTaken.mockResolvedValue(false);
    db.activeCentreWithColour.mockResolvedValue(undefined);
    db.insertCentre.mockResolvedValue(newId);
    db.centreRecord.mockResolvedValue(centre(hsr, 'HSR Layout', blue));
    db.setCentreActive.mockResolvedValue(true);
  });

  it('adds a centre with its details, the phone stored as +91', async () => {
    expect(await addCentre(context(), details)).toBe(newId);
    expect(db.insertCentre).toHaveBeenCalledWith(fakeTx, {
      ...details,
      code: 'IND',
      phone: '+918041234567',
    });
  });

  it('refuses a code another centre has, or none (SCH-01: codes start OP numbers)', async () => {
    db.centreCodeTaken.mockResolvedValueOnce(true);
    await expect(addCentre(context(), details)).rejects.toThrow(
      'Another centre has the code IND. Choose another code.',
    );
    await expect(addCentre(context(), { ...details, code: '' })).rejects.toThrow(z.ZodError);
    expect(db.insertCentre).not.toHaveBeenCalled();
  });

  it('is for the Super Admin only, and read only for Velyx support', async () => {
    for (const role of ['centre_manager', 'front_desk', 'physiotherapist', 'finance'] as const) {
      await expect(addCentre(context(member({ role })), details)).rejects.toThrow(NotAllowedError);
    }
    await expect(addCentre(context(member({ support: true })), details)).rejects.toThrow(
      ReadOnlyError,
    );
    expect(db.insertCentre).not.toHaveBeenCalled();
  });

  it('refuses a colour another active centre uses, and says which', async () => {
    db.activeCentreWithColour.mockResolvedValueOnce({ id: whitefield, name: 'Whitefield' });
    await expect(addCentre(context(), { ...details, colour: violet })).rejects.toThrow(
      'Violet is used by Whitefield. Choose another colour.',
    );
    expect(db.insertCentre).not.toHaveBeenCalled();
  });

  it('refuses a new centre when every colour is in use', async () => {
    db.centreList.mockResolvedValueOnce([
      centre(hsr, 'HSR Layout', blue),
      centre(whitefield, 'Whitefield', violet),
      centre(newId, 'Koramangala', teal),
    ]);
    await expect(addCentre(context(), details)).rejects.toThrow('All centre colours are in use.');
  });

  it('refuses a name in use, and bad details before writing', async () => {
    db.centreNameTaken.mockResolvedValueOnce(true);
    await expect(addCentre(context(), details)).rejects.toThrow(CentreError);
    await expect(addCentre(context(), { ...details, phone: '12345' })).rejects.toThrow(z.ZodError);
    await expect(
      addCentre(context(), { ...details, mapLink: 'https://example.com/hsr' }),
    ).rejects.toThrow(z.ZodError);
    await expect(addCentre(context(), { ...details, colour: 'not a colour' })).rejects.toThrow(
      z.ZodError,
    );
    expect(db.insertCentre).not.toHaveBeenCalled();
  });

  it('edits a centre, checking the colour against the other active centres', async () => {
    // The code is left out: it never changes once the centre is added.
    await editCentre(context(), { centreId: hsr, ...details, name: 'HSR Layout', colour: blue });
    expect(db.activeCentreWithColour).toHaveBeenCalledWith(fakeTx, blue, hsr);
    expect(db.updateCentre).toHaveBeenCalledWith(fakeTx, hsr, {
      ...details,
      code: undefined,
      name: 'HSR Layout',
      colour: blue,
      phone: '+918041234567',
    });
  });

  it('lets an inactive centre keep a colour in use until it is reactivated', async () => {
    db.centreRecord.mockResolvedValue(centre(whitefield, 'Whitefield', blue, false));
    db.activeCentreWithColour.mockResolvedValue({ id: hsr, name: 'HSR Layout' });
    await editCentre(context(), { centreId: whitefield, ...details, colour: blue });
    expect(db.updateCentre).toHaveBeenCalled();
    await expect(
      setCentreActiveService(context(), { centreId: whitefield, active: true }),
    ).rejects.toThrow(
      'Blue is used by HSR Layout. Choose another colour for Whitefield before reactivating it.',
    );
    expect(db.setCentreActive).not.toHaveBeenCalled();
  });

  it('deactivates and reactivates once each', async () => {
    await setCentreActiveService(context(), { centreId: hsr, active: false });
    expect(db.setCentreActive).toHaveBeenCalledWith(fakeTx, hsr, false);
    db.setCentreActive.mockResolvedValueOnce(false);
    await expect(
      setCentreActiveService(context(), { centreId: hsr, active: false }),
    ).rejects.toThrow('already inactive');
    db.centreRecord.mockResolvedValueOnce(undefined);
    await expect(
      setCentreActiveService(context(), { centreId: hsr, active: true }),
    ).rejects.toThrow('not found');
  });
});
