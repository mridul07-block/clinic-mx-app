import { describe, expect, it } from 'vitest';
import { currentNavItem, matchNavItems, navigationBySection, navigationFor } from './navigation';
import type { StaffAccess } from './permissions';

const person = (role: StaffAccess['role'], extra: Partial<StaffAccess> = {}): StaffAccess => ({
  id: '00000000-0000-4000-8000-000000000201',
  role,
  treatsPatients: role === 'physiotherapist',
  consultant: false,
  centreIds: ['00000000-0000-4000-8000-000000000101'],
  support: false,
  ...extra,
});
const labels = (staff: StaffAccess) => navigationFor(staff).map((item) => item.label);

// UI-02: one list of screens for Home, the rail, the sidebar and Search or jump to.
describe('the navigation', () => {
  it('gives each role the screens it may open, in Home’s order', () => {
    expect(labels(person('front_desk'))).toEqual([
      'Tasks',
      'Today',
      'Calendar',
      'Patients',
      'Packages',
      'Prices',
      'Kiosk tablets',
    ]);
    expect(labels(person('finance', { centreIds: [] }))).toEqual(
      expect.arrayContaining(['Finance', 'Packages', 'Prices', 'Audit log']),
    );
    expect(labels(person('finance', { centreIds: [] }))).not.toContain('Calendar');
    const admin = labels(person('super_admin', { centreIds: [] }));
    expect(admin).toEqual(expect.arrayContaining(['Staff', 'Settings', 'Audit log', 'Overview']));
    expect(new Set(admin).size).toBe(admin.length);
  });

  it('leaves out what a person may not open', () => {
    expect(labels(person('physiotherapist', { treatsPatients: false }))).not.toContain(
      'My patients today',
    );
    expect(labels(person('physiotherapist'))).toContain('My leave');
    expect(labels(person('super_admin', { centreIds: [], support: true }))).not.toContain(
      'Audit log',
    );
  });

  it('groups by section, marks the current screen and finds screens by their words', () => {
    const items = navigationFor(person('super_admin', { centreIds: [] }));
    expect(navigationBySection(items).map((group) => group.label)).toEqual([
      'Day to day',
      'Clinical',
      'Figures',
      'Setup',
    ]);
    expect(currentNavItem(items, '/app/patients/abc')?.label).toBe('Patients');
    expect(currentNavItem(items, '/app/finance/unpaid')?.label).toBe('Finance');
    expect(currentNavItem(items, '/app')).toBeUndefined();
    expect(matchNavItems(items, 'audit').map((item) => item.label)).toEqual(['Audit log']);
    expect(matchNavItems(items, 'kno ba').map((item) => item.label)).toEqual(['Knowledge base']);
    expect(matchNavItems(items, '  ')).toHaveLength(items.length);
  });
});
