import { describe, expect, it } from 'vitest';
import { bodyChartZones } from './body-chart';
import {
  ANSWER_THIS,
  HEALTH_FORM_END,
  NONE_ALONE,
  REAL_DATE,
  canOpen,
  currentHealthFormVersion,
  healthForms,
  parseScreen,
  pruneAnswers,
  resumeAt,
  screenLayout,
  visibleOptions,
  type HealthFormDefinition,
  type HealthFormField,
  type HealthFormScreen,
} from './health-form';
import { screeningRegions } from './red-flags';

// INT-05: every PRD J2.3 screen on version 3. Only the warning signs, the health check, the
// region and gender must be answered (J2.4, user decision 23 October 2026); pregnancy shows only
// for female; "None of these" goes alone; the pain sliders are 0 to 10; the body chart marks
// zones that name a region and a face.
const form = healthForms['hf-3'] as HealthFormDefinition;
const ctx = { today: '2026-10-23' };
const screen = (key: string) => {
  const found = form.screens.find((s) => s.key === key);
  if (!found) throw new Error(`no screen ${key}`);
  return found;
};
const field = (s: HealthFormScreen, key: string) => {
  const found = s.fields.find((f) => f.key === key);
  if (!found) throw new Error(`no field ${key}`);
  return found;
};
const optionValues = (f: HealthFormField, answers = {}) =>
  f.kind === 'multi_choice' ? visibleOptions(f.options, answers).map((o) => o.value) : [];

describe('health form version 3 (INT-05)', () => {
  it('has every J2.3 screen, starting new forms on it', () => {
    expect(currentHealthFormVersion).toBe('hf-3');
    expect(form.screens.map((s) => s.key)).toEqual([
      'consent',
      'about_you',
      'problem',
      'warning_signs',
      'health_check',
      'activity',
      'history',
    ]);
    expect(form.screens.filter((s) => !s.awaitingApproval).map((s) => s.key)).toEqual(['consent']);
    expect(screen('history').reports).toBe(true);
  });

  it('asks only the region, gender, the warning signs and the health check', () => {
    const required = form.screens.flatMap((s) =>
      s.fields.filter((f) => !f.optional).map((f) => `${s.key}.${f.key}`),
    );
    expect(required.filter((k) => !k.startsWith('warning_signs.'))).toEqual([
      'about_you.sex',
      'problem.region',
      'health_check.health_conditions',
    ]);
    expect(screen('warning_signs').fields.every((f) => !f.optional)).toBe(true);
  });

  it('lets a patient leave the optional fields for the physio', () => {
    expect(parseScreen(screen('problem'), {}, { region: 'knee' }, ctx)).toEqual({
      ok: true,
      answers: { region: 'knee' },
    });
    expect(parseScreen(screen('activity'), {}, {}, ctx)).toEqual({ ok: true, answers: {} });
    expect(parseScreen(screen('about_you'), {}, {}, ctx)).toEqual({
      ok: false,
      errors: { sex: ANSWER_THIS },
    });
    // A screen with only optional fields left empty is complete once sent.
    const answers = { region: 'knee', sex: 'male' };
    expect(canOpen(form, answers, ['consent', 'about_you'], 'warning_signs')).toBe(false);
    expect(resumeAt(form, answers, ['consent', 'about_you', 'problem'])).toBe('warning_signs');
  });

  it('reads a date of birth: a real date, not in the future', () => {
    const about = screen('about_you');
    const parse = (date: string) =>
      parseScreen(about, {}, { sex: 'female', date_of_birth: date }, ctx);
    expect(parse('1990-02-28')).toEqual({
      ok: true,
      answers: { sex: 'female', date_of_birth: '1990-02-28' },
    });
    for (const bad of ['1990-02-30', '2026-10-24', '23/10/1990', '1850-01-01']) {
      expect(parse(bad)).toEqual({ ok: false, errors: { date_of_birth: REAL_DATE } });
    }
    expect(parse('2026-10-23').ok).toBe(true);
  });

  it('reads the pain sliders from 0 to 10, worded at both ends', () => {
    const problem = screen('problem');
    expect(field(problem, 'pain_now')).toMatchObject({
      kind: 'scale',
      label: 'Pain now',
      min: 0,
      max: 10,
      minLabel: 'No pain',
      maxLabel: 'Worst pain you can imagine',
    });
    expect(field(problem, 'pain_activity')).toMatchObject({ label: 'Pain with activity' });
    const parsed = parseScreen(
      problem,
      {},
      { region: 'knee', pain_now: '0', pain_activity: '10' },
      ctx,
    );
    expect(parsed).toEqual({
      ok: true,
      answers: { region: 'knee', pain_now: 0, pain_activity: 10 },
    });
    expect(parseScreen(problem, {}, { region: 'knee', pain_now: '11' }, ctx)).toEqual({
      ok: false,
      errors: { pain_now: 'Choose a number from 0 to 10.' },
    });
  });

  it('marks body chart zones, refusing ones not on the chart', () => {
    const problem = screen('problem');
    const parsed = parseScreen(
      problem,
      {},
      { region: 'knee', pain_site: ['right_knee_front', 'right_knee_front', 'lower_back'] },
      ctx,
    );
    expect(parsed).toEqual({
      ok: true,
      answers: { region: 'knee', pain_site: ['right_knee_front', 'lower_back'] },
    });
    expect(parseScreen(problem, {}, { region: 'knee', pain_site: 'tail' }, ctx)).toEqual({
      ok: false,
      errors: { pain_site: ANSWER_THIS },
    });
  });

  it('shows pregnancy only for female, and drops it when gender changes', () => {
    const conditions = field(screen('health_check'), 'health_conditions');
    expect(optionValues(conditions, { sex: 'female' })).toContain('pregnancy');
    expect(optionValues(conditions, { sex: 'male' })).not.toContain('pregnancy');
    expect(optionValues(conditions, { sex: 'other' })).not.toContain('pregnancy');
    expect(
      parseScreen(screen('health_check'), { sex: 'male' }, { health_conditions: 'pregnancy' }, ctx),
    ).toEqual({ ok: false, errors: { health_conditions: ANSWER_THIS } });

    const kept = pruneAnswers(form, {
      sex: 'male',
      region: 'knee',
      health_conditions: ['pregnancy', 'diabetes'],
    });
    expect(kept.health_conditions).toEqual(['diabetes']);
    expect(pruneAnswers(form, { sex: 'male', health_conditions: ['pregnancy'] })).toEqual({
      sex: 'male',
    });
  });

  it('needs the health check answered, with None of these alone', () => {
    const check = screen('health_check');
    expect(parseScreen(check, { sex: 'female' }, {}, ctx)).toEqual({
      ok: false,
      errors: { health_conditions: ANSWER_THIS },
    });
    expect(
      parseScreen(check, { sex: 'female' }, { health_conditions: ['none', 'diabetes'] }, ctx),
    ).toEqual({
      ok: false,
      errors: { health_conditions: NONE_ALONE },
    });
    expect(parseScreen(check, { sex: 'female' }, { health_conditions: 'none' }, ctx)).toEqual({
      ok: true,
      answers: { health_conditions: ['none'] },
    });
  });

  it('asks Other (specify) only when Other is ticked, under the activity question', () => {
    const activity = screen('activity');
    const rows = screenLayout(activity, {});
    const row = rows.find((r) => r.field.key === 'activities');
    expect(row?.followUps.map((f) => f.key)).toEqual(['activity_other']);
    expect(row?.trigger).toBe('other');
    expect(
      parseScreen(activity, {}, { activities: 'running', activity_other: 'Frisbee' }, ctx),
    ).toEqual({
      ok: true,
      answers: { activities: ['running'] },
    });
    expect(
      parseScreen(activity, {}, { activities: ['other'], activity_other: 'Frisbee' }, ctx),
    ).toEqual({ ok: true, answers: { activities: ['other'], activity_other: 'Frisbee' } });
  });

  it('reaches the end once the mandatory answers are in', () => {
    const answers = {
      sex: 'female',
      region: 'knee',
      ...Object.fromEntries(
        screen('warning_signs')
          .fields.filter((f) => !f.showIf?.length)
          .map((f) => [f.key, false]),
      ),
      health_conditions: ['none'],
    };
    const done = form.screens.map((s) => s.key);
    expect(resumeAt(form, answers, done)).toBe(HEALTH_FORM_END);
    expect(canOpen(form, answers, done, HEALTH_FORM_END)).toBe(true);
    expect(
      canOpen(form, { ...answers, health_conditions: undefined } as never, done, HEALTH_FORM_END),
    ).toBe(false);
  });
});

describe('body chart zones', () => {
  it('has unique keys, a face from its view, and boxes on the outline', () => {
    expect(new Set(bodyChartZones.map((z) => z.key)).size).toBe(bodyChartZones.length);
    expect(bodyChartZones).toHaveLength(44);
    for (const zone of bodyChartZones) {
      expect(zone.face).toBe(zone.view === 'front' ? 'anterior' : 'posterior');
      expect(zone.region === null || screeningRegions.includes(zone.region)).toBe(true);
      expect(zone.x >= 0 && zone.x + zone.w <= 100).toBe(true);
      expect(zone.y >= 0 && zone.y + zone.h <= 200).toBe(true);
    }
  });

  it('mirrors the sides: the right is on the viewer’s left from the front, right from the back', () => {
    const at = (key: string) => bodyChartZones.find((z) => z.key === key);
    expect(at('right_knee_front')?.label).toBe('Right knee, front');
    expect(at('left_hip_back')?.label).toBe('Left buttock');
    expect((at('right_knee_front')?.x ?? 0) < 50).toBe(true);
    expect((at('right_knee_back')?.x ?? 0) > 50).toBe(true);
    expect(at('right_knee_back')?.region).toBe('knee');
    expect(at('lower_back')?.region).toBe('back');
    expect(at('left_thigh_front')?.region).toBeNull();
  });
});
