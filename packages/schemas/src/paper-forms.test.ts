import { describe, expect, it } from 'vitest';
import { bodyChartZones } from './body-chart';
import { consentStatements } from './consent';
import {
  currentHealthFormVersion,
  healthForms,
  type HealthFormDefinition,
  type HealthFormField,
} from './health-form';
import { paperConditionText, paperForm, type PaperQuestion } from './paper-forms';

// OPS-05: the paper health form and Part A consent are the live form's own words, every question
// in order, with what the phone shows only after an earlier answer noted from that answer's words.
const current = healthForms[currentHealthFormVersion] as HealthFormDefinition;
const paper = paperForm(current);
const questions = (form = paper): PaperQuestion[] =>
  form.sections.flatMap((section) => (section.kind === 'questions' ? section.questions : []));

describe('the paper health form', () => {
  it('prints every field of the current form once, in order, in the patient’s words', () => {
    expect(paper.version).toBe(currentHealthFormVersion);
    const live = current.screens.flatMap((screen) => screen.fields);
    expect(questions().map((q) => [q.key, q.label])).toEqual(
      live.map((field) => [field.key, field.label]),
    );
    expect(paper.sections.map((section) => section.title)).toEqual(
      current.screens.map((screen) => screen.title),
    );
  });

  it('prints Part A word for word, with its version in the footer', () => {
    const consent = paper.sections.find((section) => section.kind === 'consent');
    expect(consent).toEqual({
      kind: 'consent',
      key: 'consent',
      title: 'Pre-consultation consent',
      note: null,
      statements: [
        {
          key: 'part_a.screening',
          version: 1,
          text: consentStatements['part_a.screening'].text,
        },
        { key: 'part_a.contact', version: 1, text: consentStatements['part_a.contact'].text },
      ],
    });
    expect(paper.versionLabel).toBe(
      `Health form ${currentHealthFormVersion} · Part A consent version 1`,
    );
  });

  it('notes what the phone asks only after an earlier answer, in that answer’s words', () => {
    const byKey = new Map(questions().map((q) => [q.key, q]));
    expect(byKey.get('weight_loss')?.note).toBeNull();
    expect(byKey.get('weight_loss_kg')?.note).toBe(
      'Answer only if you answered Yes to “Have you had unexplained weight loss recently?”',
    );
    expect(byKey.get('back_bladder')?.note).toBe('Answer only if Body region is Back.');
    expect(byKey.get('activity_other')?.note).toBe(
      'Answer only if you ticked “Other (specify)” in Activity.',
    );
    const conditions = byKey.get('health_conditions')?.answer;
    expect(conditions?.kind).toBe('choice');
    if (conditions?.kind !== 'choice') return;
    expect(conditions.multiple).toBe(true);
    expect(conditions.options.find((o) => o.label === 'Pregnancy / breastfeeding')?.note).toBe(
      'Only if Gender is Female.',
    );
  });

  it('lays each kind of answer out for paper', () => {
    const byKey = new Map(questions().map((q) => [q.key, q.answer]));
    expect(byKey.get('weight_loss')).toEqual({ kind: 'yes_no' });
    expect(byKey.get('date_of_birth')).toEqual({ kind: 'date' });
    expect(byKey.get('occupation')).toEqual({ kind: 'text' });
    expect(byKey.get('pain_now')).toEqual({
      kind: 'scale',
      min: 0,
      max: 10,
      minLabel: 'No pain',
      maxLabel: 'Worst pain you can imagine',
    });
    const site = byKey.get('pain_site');
    expect(site?.kind === 'choice' && site.options.map((o) => o.label)).toEqual(
      bodyChartZones.map((zone) => zone.label),
    );
    const sex = byKey.get('sex');
    expect(sex?.kind === 'choice' && sex.multiple).toBe(false);
  });

  it('notes a whole screen shown only after an answer', () => {
    const screened = paperForm({
      version: 'hf-test',
      screens: [
        {
          key: 'first',
          title: 'First',
          source: 'Test',
          awaitingApproval: false,
          fields: [{ key: 'smokes', kind: 'yes_no', label: 'Do you smoke?', source: 'Test' }],
        },
        {
          key: 'second',
          title: 'Second',
          source: 'Test',
          awaitingApproval: false,
          showIf: [{ answer: 'smokes', is: false }],
          fields: [
            { key: 'note', kind: 'text', label: 'Anything else', source: 'Test', maxLength: 50 },
          ],
        },
      ],
    });
    const second = screened.sections[1];
    expect(second?.kind === 'questions' && second.note).toBe(
      'Answer this part only if you answered No to “Do you smoke?”',
    );
    expect(screened.versionLabel).toBe('Health form hf-test');
  });

  it('words every kind of condition, the body chart by its zones’ names', () => {
    const fields = new Map<string, HealthFormField>(
      current.screens.flatMap((screen) => screen.fields.map((field) => [field.key, field])),
    );
    const zone = bodyChartZones[0];
    if (!zone) throw new Error('no zones');
    expect(paperConditionText({ answer: 'pain_site', has: zone.key }, fields)).toBe(
      `you ticked “${zone.label}” in Pain site (mark it on the body chart)`,
    );
    expect(paperConditionText({ answer: 'region', in: ['back', 'neck'] }, fields)).toBe(
      'Body region is Back or Neck',
    );
    expect(paperConditionText({ answer: 'sex', is: 'female' }, fields)).toBe('Gender is Female');
    expect(paperConditionText({ answer: 'weight_loss', is: false }, fields)).toBe(
      'you answered No to “Have you had unexplained weight loss recently?”',
    );
  });

  it('notes a consent screen shown only after an answer, and keys each part by its screen', () => {
    const screened = paperForm({
      version: 'hf-test',
      screens: [
        {
          key: 'first',
          title: 'Same title',
          source: 'Test',
          awaitingApproval: false,
          fields: [{ key: 'adult', kind: 'yes_no', label: 'Are you 18 or over', source: 'Test' }],
        },
        {
          key: 'consent',
          title: 'Same title',
          source: 'Test',
          awaitingApproval: false,
          showIf: [{ answer: 'adult', is: true }],
          fields: [],
          consent: { stage: 'A', statements: ['part_a.contact'] },
        },
      ],
    });
    expect(screened.sections.map((section) => section.key)).toEqual(['first', 'consent']);
    const consent = screened.sections[1];
    expect(consent?.kind === 'consent' && consent.note).toBe(
      'Answer this part only if you answered Yes to “Are you 18 or over”.',
    );
  });
});
