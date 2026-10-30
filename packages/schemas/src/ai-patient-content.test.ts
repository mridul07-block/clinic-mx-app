import { describe, expect, it } from 'vitest';
import {
  aiPatientContentInputSchema,
  aiPatientContentOutputSchema,
  clipText,
  PATIENT_CONTENT_HANDOFF,
  partsWithoutSource,
  patientContentInput,
  type ConditionKnowledge,
} from './ai-patient-content';

// AI-07: what the model is sent to write a condition's patient content, and what it may return.
// Generated knowledge base text only.
const condition: ConditionKnowledge = {
  conditionId: 'KNE-001',
  name: 'Test condition',
  synonyms: ['Other name'],
  region: 'knee',
  symptoms: 'Pain on stairs',
  biomechanicalCause: 'Load rising faster than the tissue adapts',
  redFlagText: '  ',
  details: {
    timeline: { label: 'Timeline', text: '6 to 12 weeks' },
    corrections: { label: 'Corrections', text: 'Slower stairs' },
    pain_mechanism: { label: 'Pain mechanism', text: 'Not sent' },
  },
};
const phases = [{ name: 'Phase 1', timing: 'Weeks 0 to 2', goal: 'Settle pain' }];

describe('patient content input', () => {
  it('sends the condition’s own words and its region’s phases, and nothing else', () => {
    const input = patientContentInput(condition, phases);
    expect(input).toEqual({
      condition: { name: 'Test condition', region: 'Knee', otherNames: ['Other name'] },
      knowledge: {
        symptoms: 'Pain on stairs',
        cause: 'Load rising faster than the tissue adapts',
        redFlags: null,
        timeline: '6 to 12 weeks',
        managementEmphasis: null,
        loadingStage: null,
        corrections: 'Slower stairs',
        referralTrigger: null,
      },
      phases: [{ name: 'Phase 1', timing: 'Weeks 0 to 2', goal: 'Settle pain' }],
    });
    expect(aiPatientContentInputSchema.safeParse(input).success).toBe(true);
    // The condition ID never goes out.
    expect(JSON.stringify(input)).not.toContain('KNE-001');
    // Strict: an extra field (an ID, a patient) is refused.
    expect(aiPatientContentInputSchema.safeParse({ ...input, patient: 'x' }).success).toBe(false);
  });

  it('cuts long text at a word, keeping it within the limit', () => {
    const long = `${'word '.repeat(600)}end`;
    const cut = clipText(long);
    expect(cut?.length).toBeLessThanOrEqual(2000);
    expect(cut?.endsWith('word…')).toBe(true);
    expect(clipText('short')).toBe('short');
    expect(clipText(null)).toBeNull();
    const input = patientContentInput({ ...condition, symptoms: long }, phases);
    expect(aiPatientContentInputSchema.safeParse(input).success).toBe(true);
  });

  it('names the parts with no knowledge base source, which get the hand-off line', () => {
    expect(PATIENT_CONTENT_HANDOFF).toBe('Your physiotherapist will go through this with you.');
    // Symptoms and cause, a timeline, corrections: only the warning signs have no source.
    expect(partsWithoutSource(patientContentInput(condition, phases))).toEqual(['warningSigns']);
    const bare = patientContentInput(
      { ...condition, symptoms: null, biomechanicalCause: null, details: {} },
      [],
    );
    expect(partsWithoutSource(bare)).toEqual([
      'explanation',
      'roadmap',
      'homeAdvice',
      'warningSigns',
    ]);
    const flagged = patientContentInput(
      { ...condition, redFlagText: 'Cannot bear weight' },
      phases,
    );
    expect(partsWithoutSource(flagged)).toEqual([]);
  });

  it('takes back the four parts, each written and within 4000 characters', () => {
    const parts = {
      explanation: 'What it is.',
      roadmap: 'What happens next.',
      homeAdvice: 'What to do.',
      warningSigns: 'When to call.',
    };
    expect(aiPatientContentOutputSchema.safeParse(parts).success).toBe(true);
    for (const bad of [
      { ...parts, roadmap: ' ' },
      { ...parts, homeAdvice: 'x'.repeat(4001) },
      { ...parts, extra: 'x' },
      { explanation: 'x', roadmap: 'x', homeAdvice: 'x' },
    ]) {
      expect(aiPatientContentOutputSchema.safeParse(bad).success).toBe(false);
    }
  });
});
