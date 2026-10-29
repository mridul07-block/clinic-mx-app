import { describe, expect, it } from 'vitest';
import {
  patientContentDraftSchema,
  patientContentPartLabels,
  patientContentParts,
  patientContentState,
} from './patient-content';

// AI-07: the four parts the TAD names, each written and kept to 4000 characters; where a
// condition's content stands.
describe('patient content', () => {
  it('names the TAD’s four parts in its order', () => {
    expect(patientContentParts.map((part) => patientContentPartLabels[part])).toEqual([
      'Explanation',
      'Roadmap',
      'Home advice',
      'Warning signs',
    ]);
  });

  it('takes a draft with every part written, trimmed, and refuses one missing or too long', () => {
    const draft = {
      conditionId: 'ANK-001',
      explanation: '  Test explanation  ',
      roadmap: 'Test roadmap',
      homeAdvice: 'Test home advice',
      warningSigns: 'Test warning signs',
    };
    expect(patientContentDraftSchema.parse(draft).explanation).toBe('Test explanation');
    const refused = (change: Record<string, string>) =>
      patientContentDraftSchema.safeParse({ ...draft, ...change }).error?.issues[0]?.message;
    expect(refused({ roadmap: '   ' })).toBe('Write the roadmap.');
    expect(refused({ warningSigns: 'x'.repeat(4001) })).toBe(
      'Keep the warning signs to 4000 characters.',
    );
    expect(refused({ conditionId: 'ankle' })).toBe('That condition was not found.');
  });

  it('says where a condition’s content stands', () => {
    expect(patientContentState({ draft: false, approved: false })).toBe('none');
    expect(patientContentState({ draft: true, approved: false })).toBe('draft');
    expect(patientContentState({ draft: false, approved: true })).toBe('approved');
    expect(patientContentState({ draft: true, approved: true })).toBe('approved_with_draft');
  });
});
