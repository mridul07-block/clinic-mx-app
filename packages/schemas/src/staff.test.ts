import { describe, expect, it } from 'vitest';
import { sameStaffClaims, type StaffClaims } from './staff';

const hsr = '00000000-0000-4000-8000-000000000101';
const koramangala = '00000000-0000-4000-8000-000000000102';
const claims: StaffClaims = {
  staff_id: '00000000-0000-4000-8000-000000000207',
  role: 'physiotherapist',
  treats_patients: true,
  consultant: true,
  all_centres: false,
  centres: [hsr, koramangala],
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
