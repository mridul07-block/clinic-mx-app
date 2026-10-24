import { describe, expect, it } from 'vitest';
import {
  adjacentSteps,
  confirmedCount,
  sectionStarted,
  CONSULTATION_NOTES_MAX,
  consultationSectionsSchema,
  sectionHasNotes,
  stepFromQuery,
} from './consultations';

describe('consultation sections', () => {
  it('reads a new consultation as five empty sections', () => {
    const sections = consultationSectionsSchema.parse({});
    expect(sections).toEqual({
      subjective: { notes: '', confirmed: {} },
      screening: { notes: '', confirmed: {} },
      objective: { notes: '' },
      assessment: { notes: '' },
      plan: { notes: '' },
    });
  });

  it('keeps what was written and refuses notes that are too long', () => {
    const sections = consultationSectionsSchema.parse({ objective: { notes: 'Knee flexion' } });
    expect(sections.objective.notes).toBe('Knee flexion');
    expect(sectionHasNotes(sections, 'objective')).toBe(true);
    expect(sectionHasNotes(sections, 'plan')).toBe(false);
    const tooLong = consultationSectionsSchema.safeParse({
      plan: { notes: 'x'.repeat(CONSULTATION_NOTES_MAX + 1) },
    });
    expect(tooLong.success).toBe(false);
  });

  it('treats blank notes as nothing written', () => {
    const sections = consultationSectionsSchema.parse({ subjective: { notes: '  \n ' } });
    expect(sectionHasNotes(sections, 'subjective')).toBe(false);
  });
});

describe('subjective answers the clinician changed (CLN-03)', () => {
  it('keeps valid changes and counts them as started', () => {
    const sections = consultationSectionsSchema.parse({
      subjective: {
        notes: '',
        confirmed: {
          complaint: 'Knee pain on stairs',
          pain_now: 4,
          onset: 'sudden',
          pain_site: [],
        },
      },
    });
    expect(confirmedCount(sections, 'subjective')).toBe(4);
    expect(sectionStarted(sections, 'subjective')).toBe(true);
    expect(sectionStarted(sections, 'plan')).toBe(false);
  });

  it('reads a CLN-02 draft without changes', () => {
    const sections = consultationSectionsSchema.parse({ subjective: { notes: 'Older draft' } });
    expect(sections.subjective).toEqual({ notes: 'Older draft', confirmed: {} });
  });

  it('refuses unknown fields and answers that do not fit', () => {
    const refused = (confirmed: Record<string, unknown>) =>
      consultationSectionsSchema.safeParse({ subjective: { notes: '', confirmed } }).success;
    expect(refused({ blood_group: 'O' })).toBe(false);
    expect(refused({ pain_now: 11 })).toBe(false);
    expect(refused({ onset: 'overnight' })).toBe(false);
    expect(refused({ pain_site: ['not_a_zone'] })).toBe(false);
    expect(refused({ complaint: 'x'.repeat(501) })).toBe(false);
  });
});

describe('consultation steps', () => {
  it('reads the step from the address, falling back to Subjective', () => {
    expect(stepFromQuery('assessment')).toBe('assessment');
    expect(stepFromQuery('sign')).toBe('sign');
    expect(stepFromQuery('elsewhere')).toBe('subjective');
    expect(stepFromQuery(null)).toBe('subjective');
  });

  it('gives Back and Next in order', () => {
    expect(adjacentSteps('subjective')).toEqual({ back: undefined, next: 'screening' });
    expect(adjacentSteps('plan')).toEqual({ back: 'assessment', next: 'sign' });
    expect(adjacentSteps('sign')).toEqual({ back: 'plan', next: undefined });
  });
});
