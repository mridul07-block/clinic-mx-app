import { describe, expect, it } from 'vitest';
import { sameStaffClaims, staffDetailsSchema, type StaffClaims } from './staff';

const hsr = '00000000-0000-4000-8000-000000000101';
const koramangala = '00000000-0000-4000-8000-000000000102';
const claims: StaffClaims = {
  staff_id: '00000000-0000-4000-8000-000000000207',
  role: 'physiotherapist',
  treats_patients: true,
  consultant: true,
  all_centres: false,
  centres: [hsr, koramangala],
  support: false,
};

// IAM-03: a token is refreshed whenever its claim no longer matches the database.
describe('sameStaffClaims', () => {
  it('matches the same claims, whatever the order of centres', () => {
    expect(sameStaffClaims(claims, { ...claims, centres: [koramangala, hsr] })).toBe(true);
  });

  it('sees a change of role, either tick or centres', () => {
    expect(sameStaffClaims(claims, { ...claims, role: 'centre_manager' })).toBe(false);
    expect(sameStaffClaims(claims, { ...claims, treats_patients: false, consultant: false })).toBe(
      false,
    );
    expect(sameStaffClaims(claims, { ...claims, consultant: false })).toBe(false);
    expect(sameStaffClaims(claims, { ...claims, centres: [hsr] })).toBe(false);
    expect(sameStaffClaims(claims, { ...claims, all_centres: true })).toBe(false);
  });

  it('sees a login marked as Velyx support, or no longer marked (IAM-08)', () => {
    expect(sameStaffClaims(claims, { ...claims, support: true })).toBe(false);
  });

  it('refreshes a token from before IAM-08, which has no support flag', () => {
    const older: Partial<StaffClaims> = { ...claims };
    delete older.support;
    expect(sameStaffClaims(older, claims)).toBe(false);
  });

  it('treats a missing claim as different from a staff member, and the same as none', () => {
    expect(sameStaffClaims(undefined, claims)).toBe(false);
    expect(sameStaffClaims(claims, null)).toBe(false);
    expect(sameStaffClaims(undefined, null)).toBe(true);
  });

  it('never matches a malformed claim', () => {
    expect(sameStaffClaims({ ...claims, role: 'owner' }, claims)).toBe(false);
    expect(sameStaffClaims('physiotherapist', claims)).toBe(false);
  });
});

// IAM-06: what the Super Admin may set for a staff member.
describe('staffDetailsSchema', () => {
  const details = {
    name: 'Test Person',
    role: 'front_desk',
    treatsPatients: false,
    consultant: false,
    centreIds: [hsr],
  } as const;

  it('accepts a Front Desk member with a centre and an end date', () => {
    expect(staffDetailsSchema.parse({ ...details, accessEndsOn: '2026-11-30' })).toEqual({
      ...details,
      centreIds: [hsr],
      accessEndsOn: '2026-11-30',
    });
  });

  it('always gives a physiotherapist the Treats patients tick (G5)', () => {
    expect(staffDetailsSchema.parse({ ...details, role: 'physiotherapist' }).treatsPatients).toBe(
      true,
    );
  });

  it('refuses the Consultant tick without Treats patients (G5)', () => {
    const result = staffDetailsSchema.safeParse({
      ...details,
      role: 'centre_manager',
      consultant: true,
    });
    expect(result.error?.issues.map((i) => i.message)).toEqual([
      'The Consultant tick needs Treats patients too.',
    ]);
  });

  it('needs a centre, except for the roles that see every centre', () => {
    expect(
      staffDetailsSchema.safeParse({ ...details, centreIds: [] }).error?.issues[0]?.message,
    ).toBe('Choose at least one centre.');
    for (const role of ['super_admin', 'finance'] as const) {
      expect(staffDetailsSchema.parse({ ...details, role, centreIds: [hsr] }).centreIds).toEqual(
        [],
      );
    }
  });

  it('keeps each centre once and refuses a date that does not exist', () => {
    expect(
      staffDetailsSchema.parse({ ...details, centreIds: [hsr, koramangala, hsr] }).centreIds,
    ).toEqual([hsr, koramangala]);
    expect(staffDetailsSchema.safeParse({ ...details, accessEndsOn: '2026-02-30' }).success).toBe(
      false,
    );
  });

  it('needs a name', () => {
    expect(staffDetailsSchema.safeParse({ ...details, name: '  ' }).error?.issues[0]?.message).toBe(
      'Enter their name.',
    );
  });
});
