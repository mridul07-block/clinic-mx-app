import { describe, expect, it } from 'vitest';
import {
  patientLinkDefinitions,
  patientLinkExpiry,
  patientLinkPurposes,
  subjectFits,
} from './patient-links';
import { settingDefinitions } from './settings';

const appointmentId = '00000000-0000-4000-8000-000000000501';
const episodeId = '00000000-0000-4000-8000-000000000601';

// IAM-09: each link is for one purpose, tied to one appointment or episode, and expires.
describe('patient link purposes', () => {
  it('tie each purpose to the right appointment or episode, never both or neither', () => {
    expect(subjectFits('health_form', { appointmentId })).toBe(true);
    expect(subjectFits('health_form', { episodeId })).toBe(false);
    expect(subjectFits('my_plan', { episodeId })).toBe(true);
    expect(subjectFits('my_plan', { appointmentId })).toBe(false);
    expect(subjectFits('questionnaire', { appointmentId })).toBe(false);
    for (const either of ['consent', 'feedback'] as const) {
      expect(subjectFits(either, { appointmentId })).toBe(true);
      expect(subjectFits(either, { episodeId })).toBe(true);
    }
    for (const purpose of patientLinkPurposes) {
      expect(subjectFits(purpose, {}), purpose).toBe(false);
      expect(subjectFits(purpose, { appointmentId, episodeId }), purpose).toBe(false);
    }
  });

  it('read every lifetime from a setting in the right unit', () => {
    for (const purpose of patientLinkPurposes) {
      const { setting, unit } = patientLinkDefinitions[purpose].lifetime;
      expect(Object.keys(settingDefinitions), purpose).toContain(setting);
      expect(setting.endsWith(`_${unit}`), purpose).toBe(true);
    }
  });

  it('make only My plan reusable and reissued from WhatsApp (decision 22 October 2026)', () => {
    const reusable = patientLinkPurposes.filter((p) => !patientLinkDefinitions[p].singleUse);
    const reissued = patientLinkPurposes.filter(
      (p) => patientLinkDefinitions[p].reissuedFromWhatsApp,
    );
    expect(reusable).toEqual(['my_plan']);
    expect(reissued).toEqual(['my_plan']);
  });

  it('end hours or days after they are made', () => {
    const now = new Date('2026-10-22T09:00:00Z');
    expect(patientLinkExpiry('hours', 2, now)).toEqual(new Date('2026-10-22T11:00:00Z'));
    expect(patientLinkExpiry('days', 30, now)).toEqual(new Date('2026-11-21T09:00:00Z'));
  });
});
