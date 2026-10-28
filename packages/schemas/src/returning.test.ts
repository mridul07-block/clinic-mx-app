import { describe, expect, it } from 'vitest';
import { healthForms, type HealthFormDefinition } from './health-form';
import { carriedDetails, carryOver, detailsReviewDue, detailsShown, uncarry } from './returning';

const form = healthForms['hf-3'] as HealthFormDefinition;
const today = { today: '2026-10-28' };

/** An earlier, submitted form: details and a problem, warning signs and health check. */
const earlier = {
  date_of_birth: '1990-04-02',
  sex: 'female',
  occupation: 'Teacher',
  dominant_side: 'right',
  region: 'knee',
  complaint: 'Pain going downstairs',
  pain_now: 4,
  weight_loss: false,
  night_pain: true,
  health_conditions: ['pregnancy'],
  medicines: 'Iron',
  activities: ['running', 'other'],
  activity_other: 'Trekking',
  activity_level: 'recreational',
  activity_hours: 4,
  goals: 'Run 10 km',
  injuries: 'Ankle sprain 2019',
  surgeries: 'None',
};

describe('carriedDetails', () => {
  it('carries the details only, never the problem, warning signs, health check or goals', () => {
    const details = carriedDetails(form, earlier, {}, today);
    expect(details).toEqual({
      date_of_birth: '1990-04-02',
      sex: 'female',
      occupation: 'Teacher',
      dominant_side: 'right',
      activities: ['running', 'other'],
      activity_other: 'Trekking',
      activity_level: 'recreational',
      activity_hours: 4,
      injuries: 'Ankle sprain 2019',
      surgeries: 'None',
    });
  });

  it('lets the patient record win over the earlier form', () => {
    const details = carriedDetails(form, earlier, { sex: 'male', occupation: 'Driver' }, today);
    expect(details).toMatchObject({ sex: 'male', occupation: 'Driver', dominant_side: 'right' });
  });

  it('drops an answer the field would refuse today, and one a change has hidden', () => {
    const details = carriedDetails(
      form,
      {
        dominant_side: 'middle',
        activity_hours: 999,
        activity_other: 'Trekking',
        injuries: 'Knee',
      },
      {},
      today,
    );
    // Other (specify) shows only with Other ticked; the hours and the side are out of range.
    expect(details).toEqual({ injuries: 'Knee' });
  });

  it('is empty when the earlier form gives nothing, whatever is on the record', () => {
    expect(carriedDetails(form, { region: 'knee', goals: 'Walk' }, { sex: 'male' }, today)).toEqual(
      {},
    );
  });
});

describe('detailsReviewDue', () => {
  it('is due after Part A until answered', () => {
    expect(detailsReviewDue(form, null, [])).toBe(false);
    expect(detailsReviewDue(form, null, ['consent'])).toBe(true);
    expect(detailsReviewDue(form, false, ['consent'])).toBe(false);
    expect(detailsReviewDue(form, true, ['consent'])).toBe(false);
  });
});

describe('carryOver and uncarry', () => {
  const details = carriedDetails(form, earlier, {}, today);

  it('No changes fills the answers and counts About you and History as sent, not Activity', () => {
    const next = carryOver(form, {}, ['consent'], details);
    expect(next.answers).toEqual(details);
    // Activity also asks today's goals, so the patient still sees it, filled in.
    expect(next.doneScreens).toEqual(['consent', 'about_you', 'history']);
  });

  it('keeps the patient’s own answers over the details', () => {
    const next = carryOver(form, { occupation: 'Nurse' }, ['consent'], details);
    expect(next.answers.occupation).toBe('Nurse');
  });

  it('does not count About you as sent while sex, which it needs, is unknown', () => {
    const withoutSex = Object.fromEntries(Object.entries(details).filter(([key]) => key !== 'sex'));
    const next = carryOver(form, {}, ['consent'], withoutSex);
    expect(next.doneScreens).toEqual(['consent', 'history']);
  });

  it('never brings back a carried answer the patient cleared on a screen they sent', () => {
    // Something changed, then History sent with Surgeries cleared: No changes leaves it cleared.
    const theirs = Object.fromEntries(
      Object.entries(details).filter(([key]) => key !== 'surgeries'),
    );
    const next = carryOver(form, theirs, ['consent', 'about_you', 'history'], details);
    expect(next.answers.surgeries).toBeUndefined();
    expect(next.doneScreens).toEqual(['consent', 'about_you', 'history']);
  });

  it('Something changed after No changes sends again only the screens still as carried', () => {
    const carried = carryOver(form, {}, ['consent'], details);
    const done = [...carried.doneScreens, 'problem'];
    expect(uncarry(form, carried.answers, done, details)).toEqual(['consent', 'problem']);
    // About you changed by the patient since stays theirs.
    const changed = { ...carried.answers, occupation: 'Nurse' };
    expect(uncarry(form, changed, done, details)).toEqual(['consent', 'about_you', 'problem']);
  });
});

describe('detailsShown', () => {
  it('lists the details by screen in the form’s words', () => {
    const shown = detailsShown(form, carriedDetails(form, earlier, {}, today));
    expect(shown.map((group) => group.title)).toEqual([
      'About you',
      'Activity and goal',
      'History',
    ]);
    expect(shown[0]?.items.find((item) => item.key === 'dominant_side')?.text).toBe('Right');
    expect(shown[1]?.items.map((item) => item.key)).not.toContain('goals');
  });
});
