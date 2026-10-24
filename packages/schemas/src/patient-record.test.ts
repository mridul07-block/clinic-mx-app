import { describe, expect, it } from 'vitest';
import type { EpisodeStatus } from './episodes';
import { currentEpisode, patientRecordTab, worksAtCentre } from './patient-record';

describe('patientRecordTab', () => {
  it('gives clinicians the tab asked for, else Overview', () => {
    expect(patientRecordTab('notes', true)).toBe('notes');
    expect(patientRecordTab('alerts', true)).toBe('alerts');
    expect(patientRecordTab('progress', true)).toBe('overview');
    expect(patientRecordTab(undefined, true)).toBe('overview');
  });

  it('gives everyone else Overview only', () => {
    expect(patientRecordTab('notes', false)).toBe('overview');
    expect(patientRecordTab('documents', false)).toBe('overview');
  });
});

describe('currentEpisode', () => {
  it('is the newest open episode, else the newest closed one', () => {
    expect(
      currentEpisode([
        { id: 'a', status: 'discharged' as const },
        { id: 'b', status: 'active' as const },
        { id: 'c', status: 'on_hold' as const },
      ])?.id,
    ).toBe('b');
    expect(
      currentEpisode([
        { id: 'a', status: 'lost_to_follow_up' as const },
        { id: 'b', status: 'discharged' as const },
      ])?.id,
    ).toBe('a');
    expect(currentEpisode<{ status: EpisodeStatus }>([])).toBeUndefined();
  });
});

describe('worksAtCentre', () => {
  it('is the assigned centres, or every centre for the Super Admin and Finance', () => {
    expect(worksAtCentre({ role: 'physiotherapist', centreIds: ['hsr'] }, 'hsr')).toBe(true);
    expect(worksAtCentre({ role: 'physiotherapist', centreIds: ['hsr'] }, 'kor')).toBe(false);
    expect(worksAtCentre({ role: 'super_admin', centreIds: [] }, 'kor')).toBe(true);
  });
});
