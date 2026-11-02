import { describe, expect, it } from 'vitest';
import type { StaffAccess } from './permissions';
import { currentPhoneTab, mainLinksWithoutTab, phoneTabsFor, showsPhoneTabs } from './phone-tabs';

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

// UI-01, and the user's review of 3 November 2026: the sidebar's words, then More or Setup.
describe('the phone tab bar', () => {
  it('gives each role its daily screens', () => {
    expect(labels(person('front_desk'))).toEqual([
      'Today',
      'Calendar',
      'Patients',
      'To do',
      'More',
    ]);
    expect(labels(person('physiotherapist'))).toEqual([
      'My day',
      'Calendar',
      'Patients',
      'To do',
      'More',
    ]);
    expect(labels(person('centre_manager'))).toEqual([
      'Home',
      'Calendar',
      'Patients',
      'To do',
      'More',
    ]);
    expect(labels(person('finance', { centreIds: [] }))).toEqual([
      'Money',
      'Patients',
      'Prices',
      'To do',
      'More',
    ]);
    expect(labels(person('super_admin', { centreIds: [] }))).toEqual([
      'Home',
      'Calendar',
      'Patients',
      'To do',
      'Setup',
    ]);
  });

  it('leaves out a tab the person may not open', () => {
    // A physio without the Treats patients tick starts no visits.
    expect(labels(person('physiotherapist', { treatsPatients: false }))).not.toContain('My day');
  });

  it('marks the tab a page belongs to, the longest match winning, More only for itself', () => {
    const finance = phoneTabsFor(person('finance', { centreIds: [] }));
    expect(currentPhoneTab(finance, '/app/finance/unpaid')?.label).toBe('Money');
    expect(currentPhoneTab(finance, '/app')?.label).toBe('More');
    expect(currentPhoneTab(finance, '/app/audit')).toBeUndefined();
    const desk = phoneTabsFor(person('front_desk'));
    expect(currentPhoneTab(desk, '/app/patients/abc')?.label).toBe('Patients');
    expect(currentPhoneTab(desk, '/app/patientsx')).toBeUndefined();
  });

  it('sends main links with no tab to More, so a phone reaches them', () => {
    const extras = (staff: StaffAccess) => mainLinksWithoutTab(staff).map((item) => item.label);
    expect(extras(person('front_desk'))).toEqual([]);
    expect(extras(person('physiotherapist'))).toEqual([]);
    expect(extras(person('finance', { centreIds: [] }))).toEqual([]);
    expect(extras(person('centre_manager'))).toEqual(['Today', 'Reports']);
    expect(extras(person('centre_manager', { treatsPatients: true }))).toEqual([
      'My day',
      'Today',
      'Reports',
    ]);
    expect(extras(person('super_admin', { centreIds: [] }))).toEqual(['Reports']);
  });

  it('stands aside on screens that pin their own actions', () => {
    expect(showsPhoneTabs('/app/consultations/abc')).toBe(false);
    expect(showsPhoneTabs('/app/sessions/abc')).toBe(false);
    expect(showsPhoneTabs('/app/consultations/abc/explain')).toBe(true);
    expect(showsPhoneTabs('/app/today')).toBe(true);
  });
});
