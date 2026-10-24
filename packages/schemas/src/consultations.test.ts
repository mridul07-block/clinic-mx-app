import { describe, expect, it } from 'vitest';
import {
  adjacentSteps,
  CONSULTATION_NOTES_MAX,
  consultationSectionsSchema,
  sectionHasNotes,
  stepFromQuery,
} from './consultations';

describe('consultation sections', () => {
  it('reads a new consultation as five empty sections', () => {
    const sections = consultationSectionsSchema.parse({});
    expect(sections).toEqual({
      subjective: { notes: '' },
      screening: { notes: '' },
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
