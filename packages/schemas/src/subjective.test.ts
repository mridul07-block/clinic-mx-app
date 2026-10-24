import { describe, expect, it } from 'vitest';
import {
  subjectiveField,
  subjectiveFieldKeys,
  subjectiveFieldShown,
  subjectiveSource,
  subjectiveValue,
  validSubjectiveAnswer,
} from './subjective';

// CLN-03: Subjective shows the health form's own fields, Patient reported until the clinician
// changes one, then Clinician confirmed.
describe('subjective', () => {
  it('takes every field and its wording from the health form', () => {
    for (const key of subjectiveFieldKeys) expect(subjectiveField(key).key).toBe(key);
    expect(subjectiveField('complaint').label).toBe('Main complaint');
    expect(subjectiveFieldKeys).not.toContain('health_conditions');
  });

  it('labels who wrote the value shown', () => {
    const patient = { complaint: 'Pain on stairs', goals: '' };
    expect(subjectiveSource('complaint', {}, patient)).toBe('patient');
    expect(subjectiveSource('goals', {}, patient)).toBe('unanswered');
    expect(subjectiveSource('surgeries', {}, patient)).toBe('unanswered');
    expect(subjectiveSource('complaint', { complaint: 'Pain going down stairs' }, patient)).toBe(
      'clinician',
    );
    expect(subjectiveSource('complaint', { complaint: '' }, patient)).toBe('clinician');
    expect(subjectiveValue('complaint', {}, patient)).toBe('Pain on stairs');
    expect(subjectiveValue('complaint', { complaint: 'Changed' }, patient)).toBe('Changed');
  });

  it('checks a changed answer against its field', () => {
    expect(validSubjectiveAnswer(subjectiveField('pain_now'), 0)).toBe(true);
    expect(validSubjectiveAnswer(subjectiveField('pain_now'), 10)).toBe(true);
    expect(validSubjectiveAnswer(subjectiveField('pain_now'), 4.5)).toBe(false);
    expect(validSubjectiveAnswer(subjectiveField('duration'), 100)).toBe(false);
    expect(validSubjectiveAnswer(subjectiveField('region'), 'knee')).toBe(true);
    expect(validSubjectiveAnswer(subjectiveField('activities'), ['running', 'golf'])).toBe(true);
    expect(validSubjectiveAnswer(subjectiveField('activities'), ['skydiving'])).toBe(false);
    expect(validSubjectiveAnswer(subjectiveField('complaint'), '')).toBe(true);
    expect(validSubjectiveAnswer(subjectiveField('complaint'), 4)).toBe(false);
  });

  it('shows Other (specify) only once Other is ticked', () => {
    expect(subjectiveFieldShown('activity_other', { activities: ['running'] })).toBe(false);
    expect(subjectiveFieldShown('activity_other', { activities: ['other'] })).toBe(true);
    expect(subjectiveFieldShown('complaint', {})).toBe(true);
  });
});
