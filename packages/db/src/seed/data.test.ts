import { staffRoleSchema } from '@clinic-mx/schemas';
import { describe, expect, it } from 'vitest';
import { seedCentres, seedStaff, seedStaffCentres } from './data';
import { parseSeedTarget } from './seed';

describe('seed data', () => {
  it('has the three centres with chart colours', () => {
    expect(seedCentres.map((c) => c.name)).toEqual(['HSR Layout', 'Koramangala', 'Whitefield']);
    for (const c of seedCentres) expect(c.colour).toMatch(/^#[0-9A-F]{6}$/);
  });

  it('gives every staff member a valid role and the G5 tick rules', () => {
    for (const s of seedStaff) {
      expect(staffRoleSchema.safeParse(s.role).success).toBe(true);
      if (s.consultant) expect(s.treatsPatients).toBe(true);
      if (s.role === 'physiotherapist') expect(s.treatsPatients).toBe(true);
    }
  });

  it('covers every role and uses only reserved test email addresses', () => {
    expect(new Set(seedStaff.map((s) => s.role))).toEqual(new Set(staffRoleSchema.options));
    for (const s of seedStaff) expect(s.email).toMatch(/@clinicmx\.test$/);
  });

  it('has unique ids and emails', () => {
    const ids = [...seedCentres, ...seedStaff].map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    const emails = seedStaff.map((s) => s.email.toLowerCase());
    expect(new Set(emails).size).toBe(emails.length);
  });

  it('assigns centres only to seeded staff and centres, never to Super Admin or Finance', () => {
    const centreIds = new Set<string>(seedCentres.map((c) => c.id));
    const staffById = new Map(seedStaff.map((s) => [s.id, s]));
    for (const a of seedStaffCentres) {
      expect(centreIds.has(a.centreId)).toBe(true);
      const member = staffById.get(a.staffUserId);
      expect(member).toBeDefined();
      expect(['super_admin', 'finance']).not.toContain(member?.role);
    }
  });
});

describe('parseSeedTarget', () => {
  it('accepts local and staging only', () => {
    expect(parseSeedTarget('local')).toBe('local');
    expect(parseSeedTarget('staging')).toBe('staging');
    expect(() => parseSeedTarget('production')).toThrow();
    expect(() => parseSeedTarget(undefined)).toThrow();
  });
});
