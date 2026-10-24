import { describe, expect, it } from 'vitest';
import { consultationSectionsSchema, signingBlockers } from './consultations';
import {
  patientScreeningAnswer,
  screeningAnswerText,
  screeningItems,
  screeningProgress,
  validScreeningAnswer,
} from './screening';

// CLN-04: the region's red flag questions and each precaution, every one confirmed before signing.
describe('screening items', () => {
  it('asks the universal questions and the region’s own', () => {
    const knee = screeningItems('knee', 'male', {}).map((item) => item.key);
    const back = screeningItems('back', 'male', {}).map((item) => item.key);
    expect(knee).toContain('night_pain');
    expect(knee).not.toContain('back_saddle');
    expect(back).toContain('back_saddle');
    expect(back).not.toContain('neck_dizziness');
    expect(screeningItems(undefined, 'male', {}).map((item) => item.key)).not.toContain(
      'back_saddle',
    );
  });

  it('asks the weight loss follow ups only once weight loss is confirmed yes', () => {
    const keys = (confirmed: Record<string, boolean | number>) =>
      screeningItems('knee', 'male', confirmed).map((item) => item.key);
    expect(keys({})).not.toContain('weight_loss_kg');
    expect(keys({ weight_loss: false })).not.toContain('weight_loss_kg');
    expect(keys({ weight_loss: true })).toEqual(
      expect.arrayContaining(['weight_loss_kg', 'weight_loss_months']),
    );
  });

  it('lists each precaution, pregnancy only for a female patient, never None of these', () => {
    const precautions = (sex: string) =>
      screeningItems('knee', sex, {})
        .filter((item) => item.kind === 'precaution')
        .map((item) => item.key);
    expect(precautions('female')).toContain('precaution.pregnancy');
    expect(precautions('male')).not.toContain('precaution.pregnancy');
    expect(precautions('female')).toContain('precaution.diabetes');
    expect(precautions('female')).not.toContain('precaution.none');
  });
});

describe('what the patient said', () => {
  it('reads questions and precautions from the form', () => {
    const items = screeningItems('back', 'female', { weight_loss: true });
    const item = (key: string) => {
      const found = items.find((i) => i.key === key);
      if (!found) throw new Error(key);
      return found;
    };
    const answers = { back_saddle: false, weight_loss_kg: 3, health_conditions: ['diabetes'] };
    expect(patientScreeningAnswer(item('back_saddle'), answers)).toBe(false);
    expect(patientScreeningAnswer(item('night_pain'), answers)).toBeUndefined();
    expect(patientScreeningAnswer(item('precaution.diabetes'), answers)).toBe(true);
    expect(patientScreeningAnswer(item('precaution.implant'), answers)).toBe(false);
    expect(patientScreeningAnswer(item('precaution.implant'), {})).toBeUndefined();
    expect(screeningAnswerText(item('weight_loss_kg'), 3)).toBe('3 kg');
    expect(screeningAnswerText(item('back_saddle'), false)).toBe('No');
    expect(screeningAnswerText(item('back_saddle'), undefined)).toBe('Not answered');
  });
});

describe('the gate', () => {
  it('counts only the items asked, and is complete when each is confirmed', () => {
    const all = Object.fromEntries(
      screeningItems('knee', 'male', {}).map((item) => [
        item.key,
        item.input === 'number' ? 0 : false,
      ]),
    );
    const start = screeningProgress('knee', 'male', {});
    expect(start.confirmed).toBe(0);
    expect(start.complete).toBe(false);
    // A back question confirmed before the region changed to knee does not count.
    const stale = screeningProgress('knee', 'male', { back_saddle: true });
    expect(stale.confirmed).toBe(0);
    expect(screeningProgress('knee', 'male', all)).toEqual({
      confirmed: start.total,
      total: start.total,
      complete: true,
    });
    // Confirming weight loss yes asks two more.
    expect(screeningProgress('knee', 'male', { ...all, weight_loss: true }).complete).toBe(false);
  });

  it('blocks signing until screening is complete', () => {
    const patient = { region: 'knee', sex: 'male' };
    const empty = consultationSectionsSchema.parse({});
    const total = screeningItems('knee', 'male', {}).length;
    expect(signingBlockers(empty, patient)[0]).toEqual({
      section: 'screening',
      reason: `Signing needs every screening item confirmed: ${String(total)} left.`,
    });
    const confirmed = Object.fromEntries(
      screeningItems('knee', 'male', {}).map((item) => [
        item.key,
        item.input === 'number' ? 0 : false,
      ]),
    );
    const done = consultationSectionsSchema.parse({ screening: { notes: '', confirmed } });
    expect(signingBlockers(done, patient).map((blocker) => blocker.section)).toEqual([
      'assessment',
    ]);
  });

  it('takes only answers that fit their item', () => {
    expect(validScreeningAnswer('night_pain', true)).toBe(true);
    expect(validScreeningAnswer('night_pain', 1)).toBe(false);
    expect(validScreeningAnswer('weight_loss_kg', 3)).toBe(true);
    expect(validScreeningAnswer('weight_loss_kg', 101)).toBe(false);
    expect(validScreeningAnswer('weight_loss_kg', 2.5)).toBe(false);
    expect(validScreeningAnswer('precaution.diabetes', true)).toBe(true);
    expect(validScreeningAnswer('precaution.none', true)).toBe(false);
    expect(validScreeningAnswer('blood_group', true)).toBe(false);
    expect(
      consultationSectionsSchema.safeParse({
        screening: { notes: '', confirmed: { night_pain: 'yes' } },
      }).success,
    ).toBe(false);
  });
});
