import { describe, expect, it } from 'vitest';
import {
  currentNavItem,
  mainNavigationFor,
  matchNavItems,
  moreNavigationFor,
  navigationBySection,
  navigationFor,
} from './navigation';
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

const mainLabels = (staff: StaffAccess) => mainNavigationFor(staff).map((item) => item.label);
const moreLabels = (staff: StaffAccess) => moreNavigationFor(staff).map((item) => item.label);

// The user's review, 3 November 2026: a few main links for each role, the rest on one page.
describe('the main links', () => {
  it('are the daily screens of each role, then More or Setup', () => {
    expect(mainLabels(person('front_desk'))).toEqual([
      'Today',
      'Calendar',
      'Patients',
      'To do',
      'More',
    ]);
    expect(mainLabels(person('physiotherapist'))).toEqual([
      'My day',
      'Calendar',
      'Patients',
      'To do',
      'More',
    ]);
    expect(mainLabels(person('centre_manager'))).toEqual([
      'Home',
      'Today',
      'Calendar',
      'Patients',
      'To do',
      'Reports',
      'More',
    ]);
    expect(mainLabels(person('finance', { centreIds: [] }))).toEqual([
      'Money',
      'Patients',
      'Prices',
      'To do',
      'More',
    ]);
    expect(mainLabels(person('super_admin', { centreIds: [] }))).toEqual([
      'Home',
      'Calendar',
      'Patients',
      'To do',
      'Reports',
      'Setup',
    ]);
  });

  it('add My day for those who treat patients', () => {
    expect(mainLabels(person('super_admin', { centreIds: [], treatsPatients: true }))).toContain(
      'My day',
    );
    expect(mainLabels(person('centre_manager', { treatsPatients: true }))).toContain('My day');
  });

  it('leave out what a person may not open', () => {
    expect(mainLabels(person('physiotherapist', { treatsPatients: false }))).not.toContain(
      'My day',
    );
  });

  it('lose nothing: every screen is a main link or on More, once', () => {
    for (const staff of [
      person('front_desk'),
      person('physiotherapist'),
      person('centre_manager', { treatsPatients: true }),
      person('finance', { centreIds: [] }),
      person('super_admin', { centreIds: [], treatsPatients: true }),
    ]) {
      const rules = new Set(mainLabels(staff));
      const more = moreLabels(staff);
      expect(more.filter((label) => rules.has(label))).toEqual([]);
      const reached = navigationFor(staff).filter((item) => {
        const asMain = mainNavigationFor(staff).some(
          (main) => main.icon === item.icon || main.href === item.href,
        );
        // The Super Admin's Reports holds Money and Figures as tabs.
        const inReports = staff.role === 'super_admin' && ['Money', 'Figures'].includes(item.label);
        return asMain || inReports || more.includes(item.label);
      });
      expect(reached).toHaveLength(navigationFor(staff).length);
    }
  });

  it('count any other screen as More or Setup, and the dashboard as Home or Reports', () => {
    const items = mainNavigationFor(person('centre_manager'));
    expect(currentNavItem(items, '/app/team')?.label).toBe('More');
    expect(currentNavItem(items, '/app/dashboard/alerts')?.label).toBe('Home');
    expect(currentNavItem(items, '/app/dashboard/outcomes')?.label).toBe('Reports');
    expect(currentNavItem(items, '/app/patients/abc')?.label).toBe('Patients');
    const admin = mainNavigationFor(person('super_admin', { centreIds: [] }));
    expect(currentNavItem(admin, '/app/finance/unpaid')?.label).toBe('Reports');
    expect(currentNavItem(admin, '/app/figures')?.label).toBe('Reports');
    expect(currentNavItem(admin, '/app/overview')?.label).toBe('Home');
  });

  it('put alerts, the knowledge base and the audit log on More, under headings', () => {
    expect(moreLabels(person('physiotherapist'))).toEqual([
      'My leave',
      'Alerts',
      'Red flags',
      'Knowledge base',
    ]);
    const admin = moreNavigationFor(person('super_admin', { centreIds: [] }));
    expect(navigationBySection(admin).map((group) => group.label)).toEqual([
      'Day to day',
      'Clinic',
      'People',
      'Clinical content',
      'Rules',
      'Records and access',
    ]);
  });
});

// UI-02: one list of screens, for More and for Search.
describe('the navigation', () => {
  it('gives each role the screens it may open, in Home’s order', () => {
    expect(labels(person('front_desk'))).toEqual([
      'To do',
      'Today',
      'Calendar',
      'Patients',
      'Packages',
      'Prices',
      'Kiosk tablets',
    ]);
    expect(labels(person('finance', { centreIds: [] }))).toEqual(
      expect.arrayContaining(['Money', 'Packages', 'Prices', 'Audit log']),
    );
    expect(labels(person('finance', { centreIds: [] }))).not.toContain('Calendar');
    const admin = labels(person('super_admin', { centreIds: [] }));
    expect(admin).toEqual(expect.arrayContaining(['Staff', 'Settings', 'Audit log', 'Home']));
    expect(new Set(admin).size).toBe(admin.length);
  });

  it('leaves out what a person may not open', () => {
    expect(labels(person('physiotherapist', { treatsPatients: false }))).not.toContain('My day');
    expect(labels(person('physiotherapist'))).toContain('My leave');
    expect(labels(person('super_admin', { centreIds: [], support: true }))).not.toContain(
      'Audit log',
    );
  });

  it('groups by section, marks the current screen and finds screens by their words', () => {
    const items = navigationFor(person('super_admin', { centreIds: [] }));
    expect(navigationBySection(items)[0]?.label).toBe('Day to day');
    expect(currentNavItem(items, '/app/patients/abc')?.label).toBe('Patients');
    expect(currentNavItem(items, '/app/finance/unpaid')?.label).toBe('Money');
    expect(currentNavItem(items, '/app')).toBeUndefined();
    expect(matchNavItems(items, 'audit').map((item) => item.label)).toEqual(['Audit log']);
    expect(matchNavItems(items, 'kno ba').map((item) => item.label)).toEqual(['Knowledge base']);
    expect(matchNavItems(items, '  ')).toHaveLength(items.length);
  });
});
