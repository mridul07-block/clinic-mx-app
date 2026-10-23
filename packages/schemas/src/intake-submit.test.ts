import { describe, expect, it } from 'vitest';
import { healthForms, type HealthFormDefinition } from './health-form';
import {
  intakeAge,
  intakePrecautions,
  intakeScreening,
  notificationKindLabels,
  notificationKinds,
} from './intake-submit';

// INT-10: what a submitted form hands the pipeline: screening answers for the red flag rules, the
// age, the precautions ticked on the Health check.
const v3 = healthForms['hf-3'] as HealthFormDefinition;
const v2 = healthForms['hf-2'] as HealthFormDefinition;

describe('a submitted health form', () => {
  it('hands the red flag rules only the screening answers', () => {
    expect(
      intakeScreening({
        region: 'back',
        sex: 'female',
        back_saddle: true,
        weight_loss: false,
        weight_loss_kg: 6,
        pain_now: 7,
        health_conditions: ['none'],
      }),
    ).toEqual({ back_saddle: true, weight_loss: false, weight_loss_kg: 6 });
  });

  it('reads the age from the answered date of birth, else the record', () => {
    expect(intakeAge({ date_of_birth: '1990-10-24' }, '1980-01-01', '2026-10-23')).toBe(35);
    expect(intakeAge({}, '2014-05-04', '2026-10-23')).toBe(12);
    expect(intakeAge({}, null, '2026-10-23')).toBeNull();
  });

  it('records the Health check items ticked as precautions, never None of these', () => {
    expect(
      intakePrecautions(v3, { health_conditions: ['implant', 'pregnancy', 'bleeding'] }),
    ).toEqual([
      { key: 'implant', label: 'Any implant (pacemaker / electronic or metal)' },
      { key: 'pregnancy', label: 'Pregnancy / breastfeeding' },
      { key: 'bleeding', label: 'Bleeding disorder or blood thinners' },
    ]);
    expect(intakePrecautions(v3, { health_conditions: ['none'] })).toEqual([]);
    expect(intakePrecautions(v3, {})).toEqual([]);
    // A version without the Health check records none.
    expect(intakePrecautions(v2, { health_conditions: ['implant'] })).toEqual([]);
  });

  it('names every notification kind', () => {
    expect(notificationKinds.map((kind) => notificationKindLabels[kind])).toEqual([
      'Health form submitted',
      'Red flag: emergency',
    ]);
  });
});
