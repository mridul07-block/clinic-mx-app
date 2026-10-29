import { describe, expect, it } from 'vitest';
import type { StaffAccess } from './permissions';
import { currentPhoneTab, phoneTabsFor, showsPhoneTabs } from './phone-tabs';

const person = (role: StaffAccess['role'], extra: Partial<StaffAccess> = {}): StaffAccess => ({
  id: '00000000-0000-4000-8000-000000000201',
  role,
  treatsPatients: role === 'physiotherapist',
  consultant: false,
  centreIds: ['00000000-0000-4000-8000-000000000101'],
  support: false,
  ...extra,
});
const labels = (staff: StaffAccess) => phoneTabsFor(staff).map((tab) => tab.label);

// UI-01: each role's tabs as the Frontend Specification lists them, then More (Home).
describe('the phone tab bar', () => {
  it('gives each role its tabs in the specification’s order and words', () => {
    expect(labels(person('front_desk'))).toEqual(['Today', 'Calendar', 'Patients', 'More']);
    expect(labels(person('physiotherapist'))).toEqual(['My patients', 'Today', 'Notes', 'More']);
    expect(labels(person('centre_manager'))).toEqual(['Alerts', 'Centres', 'Outcomes', 'More']);
    expect(labels(person('finance', { centreIds: [] }))).toEqual([
      'Bills',
      'Unpaid',
      'Packages',
      'More',
    ]);
    expect(labels(person('super_admin', { centreIds: [] }))).toEqual([
      'Overview',
      'Alerts',
      'Settings',
      'More',
    ]);
  });

  it('leaves out a tab the person may not open', () => {
    // A physio without the Treats patients tick starts no visits; support never opens alerts.
    expect(labels(person('physiotherapist', { treatsPatients: false }))).not.toContain(
      'My patients',
    );
    expect(labels(person('super_admin', { centreIds: [], support: true }))).not.toContain('Alerts');
  });

  it('marks the tab a page belongs to, the longest match winning, More only for Home', () => {
    const finance = phoneTabsFor(person('finance', { centreIds: [] }));
    expect(currentPhoneTab(finance, '/app/finance/unpaid')?.label).toBe('Unpaid');
    expect(currentPhoneTab(finance, '/app/finance/refunds')?.label).toBe('Bills');
    expect(currentPhoneTab(finance, '/app')?.label).toBe('More');
    expect(currentPhoneTab(finance, '/app/prices')).toBeUndefined();
    const desk = phoneTabsFor(person('front_desk'));
    expect(currentPhoneTab(desk, '/app/patients/abc')?.label).toBe('Patients');
    expect(currentPhoneTab(desk, '/app/patientsx')).toBeUndefined();
  });

  it('stands aside on screens that pin their own actions', () => {
    expect(showsPhoneTabs('/app/consultations/abc')).toBe(false);
    expect(showsPhoneTabs('/app/sessions/abc')).toBe(false);
    expect(showsPhoneTabs('/app/consultations/abc/explain')).toBe(true);
    expect(showsPhoneTabs('/app/today')).toBe(true);
  });
});
