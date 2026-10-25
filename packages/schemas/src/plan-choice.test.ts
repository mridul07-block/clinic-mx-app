import { describe, expect, it } from 'vitest';
import { planChoiceFromForm, recordPlanChoiceSchema } from './plan-choice';

const packageId = '9b2f0c7e-4a43-4d0e-9a51-0d3c2d8f1a10';

describe('the patient choice', () => {
  it('reads a package with its session type', () => {
    expect(
      recordPlanChoiceSchema.parse(
        planChoiceFromForm(`package:${packageId}`, 'rehabilitation_session'),
      ),
    ).toEqual({
      choice: 'package',
      sessionKey: 'rehabilitation_session',
      packageTypeId: packageId,
    });
  });

  it('reads pay per session with its session type, and the others alone', () => {
    expect(
      recordPlanChoiceSchema.parse(planChoiceFromForm('per_session', 'rehabilitation_session')),
    ).toEqual({ choice: 'per_session', sessionKey: 'rehabilitation_session' });
    expect(recordPlanChoiceSchema.parse(planChoiceFromForm('think_about_it', ''))).toEqual({
      choice: 'think_about_it',
    });
    expect(recordPlanChoiceSchema.parse(planChoiceFromForm('no_thanks', ''))).toEqual({
      choice: 'no_thanks',
    });
  });

  it('refuses nothing chosen, a package without an id and a session without a type', () => {
    expect(recordPlanChoiceSchema.safeParse(planChoiceFromForm('', '')).success).toBe(false);
    expect(
      recordPlanChoiceSchema.safeParse(planChoiceFromForm('package:', 'rehabilitation_session'))
        .success,
    ).toBe(false);
    expect(recordPlanChoiceSchema.safeParse(planChoiceFromForm('per_session', '')).success).toBe(
      false,
    );
  });
});
