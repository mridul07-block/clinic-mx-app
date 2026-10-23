import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  ANSWER_THIS,
  HEALTH_FORM_END,
  canOpen,
  currentHealthFormVersion,
  healthForms,
  nextScreen,
  parseScreen,
  previousScreen,
  pruneAnswers,
  resumeAt,
  screenLayout,
  stepOf,
  visibleFields,
  type HealthFormDefinition,
} from './health-form';

// INT-04: the health form engine. Screens and fields show on earlier answers, a change drops what
// it hid, every shown field needs an answer, a returning patient carries on where they stopped,
// and a published version never changes.
const form = healthForms['hf-1'] as HealthFormDefinition;
const current = healthForms[currentHealthFormVersion] as HealthFormDefinition;
const [problem, warnings] = form.screens;
if (!problem || !warnings) throw new Error('hf-1 has two screens');
const keys = (fields: { key: string }[]) => fields.map((f) => f.key);
const back = ['back_bladder', 'back_bowel', 'back_saddle', 'back_both_legs'];
const neck = [
  'neck_dizziness',
  'neck_double_vision',
  'neck_speech_swallow',
  'neck_both_arms_walking',
];

describe('health form engine', () => {
  it('shows the back questions for the back, the neck ones for the neck, and neither for a knee', () => {
    expect(keys(visibleFields(warnings, { region: 'back' }))).toEqual(expect.arrayContaining(back));
    expect(keys(visibleFields(warnings, { region: 'back' }))).not.toContain('neck_dizziness');
    expect(keys(visibleFields(warnings, { region: 'neck' }))).toEqual(expect.arrayContaining(neck));
    const knee = keys(visibleFields(warnings, { region: 'knee' }));
    expect(knee.filter((k) => back.includes(k) || neck.includes(k))).toEqual([]);
    expect(knee).toHaveLength(16);
  });

  it('asks the weight loss amount and period only after a yes', () => {
    expect(keys(visibleFields(warnings, { region: 'knee' }))).not.toContain('weight_loss_kg');
    expect(keys(visibleFields(warnings, { region: 'knee', weight_loss: true }))).toEqual(
      expect.arrayContaining(['weight_loss_kg', 'weight_loss_months']),
    );
  });

  it('drops the answers a change has hidden', () => {
    expect(
      pruneAnswers(form, {
        region: 'knee',
        back_bladder: false,
        weight_loss: false,
        weight_loss_kg: 4,
        fever_sweats: true,
        stray: 'x',
      }),
    ).toEqual({ region: 'knee', weight_loss: false, fever_sweats: true });
  });

  it('needs an answer to every shown field, and reads each kind', () => {
    expect(parseScreen(problem, {}, {})).toEqual({ ok: false, errors: { region: ANSWER_THIS } });
    expect(parseScreen(problem, {}, { region: 'elbow_and_more' })).toEqual({
      ok: false,
      errors: { region: ANSWER_THIS },
    });
    expect(parseScreen(problem, {}, { region: 'back' })).toEqual({
      ok: true,
      answers: { region: 'back' },
    });

    const all = Object.fromEntries(
      visibleFields(warnings, { region: 'knee' }).map((f) => [
        f.key,
        f.kind === 'number' ? '0' : 'no',
      ]),
    );
    expect(parseScreen(warnings, { region: 'knee' }, all).ok).toBe(true);
    // A yes on this screen shows its follow ups, which then need answers too.
    const yes = parseScreen(warnings, { region: 'knee' }, { ...all, weight_loss: 'yes' });
    expect(yes).toEqual({
      ok: false,
      errors: { weight_loss_kg: ANSWER_THIS, weight_loss_months: ANSWER_THIS },
    });
    const amounts = parseScreen(
      warnings,
      { region: 'knee' },
      { ...all, weight_loss: 'yes', weight_loss_kg: '6', weight_loss_months: '61' },
    );
    expect(amounts).toEqual({
      ok: false,
      errors: { weight_loss_months: 'Enter a whole number from 0 to 60.' },
    });
    // Hidden fields' posted values are ignored.
    const parsed = parseScreen(warnings, { region: 'knee' }, { ...all, back_bladder: 'yes' });
    expect(parsed.ok && 'back_bladder' in parsed.answers).toBe(false);
    expect(parsed.ok && parsed.answers.fever_sweats).toBe(false);
  });

  it('resumes at the first screen not complete, and opens screens in order', () => {
    expect(resumeAt(form, {}, [])).toBe('problem');
    expect(canOpen(form, {}, [], 'warning_signs')).toBe(false);
    const region = { region: 'back' };
    expect(resumeAt(form, region, ['problem'])).toBe('warning_signs');
    expect(canOpen(form, region, ['problem'], 'warning_signs')).toBe(true);
    expect(canOpen(form, region, ['problem'], HEALTH_FORM_END)).toBe(false);
    const answered = Object.fromEntries(
      visibleFields(warnings, region).map((f) => [f.key, f.kind === 'number' ? 0 : false]),
    );
    const done = ['problem', 'warning_signs'];
    expect(resumeAt(form, { ...region, ...answered }, done)).toBe(HEALTH_FORM_END);
    // Back changed to neck: the neck questions are new, so warning signs is not complete.
    expect(resumeAt(form, pruneAnswers(form, { ...answered, region: 'neck' }), done)).toBe(
      'warning_signs',
    );
    expect(stepOf(form, region, 'warning_signs')).toEqual({ step: 2, of: 2 });
    expect(nextScreen(form, region, 'problem')).toBe('warning_signs');
    expect(nextScreen(form, region, 'warning_signs')).toBe(HEALTH_FORM_END);
    expect(previousScreen(form, region, HEALTH_FORM_END)).toBe('warning_signs');
    expect(previousScreen(form, region, 'problem')).toBeUndefined();
  });

  it('lays out follow ups under the question that shows them, for pages without scripts', () => {
    const knee = screenLayout(warnings, { region: 'knee' });
    expect(knee.find((r) => r.field.key === 'weight_loss')?.followUps.map((f) => f.key)).toEqual([
      'weight_loss_kg',
      'weight_loss_months',
    ]);
    expect(knee.map((r) => r.field.key)).not.toContain('weight_loss_kg');
    expect(knee.map((r) => r.field.key)).not.toContain('back_bladder');
    expect(screenLayout(warnings, { region: 'back' }).map((r) => r.field.key)).toEqual(
      expect.arrayContaining(back),
    );
  });

  it('names only earlier fields in its conditions', () => {
    for (const definition of Object.values(healthForms)) {
      const seen = new Set<string>();
      for (const screen of definition.screens) {
        for (const condition of screen.showIf ?? []) expect(seen).toContain(condition.answer);
        for (const field of screen.fields) {
          for (const condition of field.showIf ?? []) expect(seen).toContain(condition.answer);
          seen.add(field.key);
        }
      }
      expect(seen.size).toBe(definition.screens.flatMap((s) => s.fields).length);
    }
  });

  it('starts new forms on Part A consent, complete once accepted and signed (INT-06)', () => {
    expect(currentHealthFormVersion).toBe('hf-2');
    expect(current.screens.map((s) => s.key)).toEqual(['consent', 'problem', 'warning_signs']);
    expect(current.screens[0]?.consent).toEqual({
      stage: 'A',
      statements: ['part_a.screening', 'part_a.contact'],
    });
    expect(resumeAt(current, {}, [])).toBe('consent');
    expect(canOpen(current, {}, [], 'problem')).toBe(false);
    expect(resumeAt(current, {}, ['consent'])).toBe('problem');
    expect(stepOf(current, {}, 'consent')).toEqual({ step: 1, of: 3 });
  });

  it('never changes a published version: a change is a new version', () => {
    const pinned: Record<string, string> = {
      'hf-1': '845da8f257842aeae22f29aefb2727719761ba9a2ef8a78adaf6445d2b15fdce',
      'hf-2': 'da3736b9f71b5341364b7c430c2e868f90dba7189f5bfa5f38ea70cfaff78999',
    };
    for (const [version, definition] of Object.entries(healthForms)) {
      const digest = createHash('sha256').update(JSON.stringify(definition)).digest('hex');
      expect({ version, digest }).toEqual({ version, digest: pinned[version] });
    }
  });
});
