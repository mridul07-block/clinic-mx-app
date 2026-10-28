import { describe, expect, it } from 'vitest';
import { confirmDiagnosisSchema } from './confirmed-diagnosis';

// AI-05: what confirming a diagnosis posts; the stage, who and when are the database's.
describe('confirming a diagnosis', () => {
  const episodeId = '00000000-0000-4000-8000-000000000501';

  it('takes the episode and a condition, nothing else', () => {
    expect(confirmDiagnosisSchema.parse({ episodeId, conditionId: ' KNE-004 ' })).toEqual({
      episodeId,
      conditionId: 'KNE-004',
    });
    for (const bad of [
      { episodeId, conditionId: '' },
      { episodeId: 'nope', conditionId: 'KNE-004' },
      { episodeId, conditionId: 'KNE-004', stage: 'discharge' },
      { episodeId, conditionId: 'KNE-004', confirmedBy: episodeId },
    ]) {
      expect(confirmDiagnosisSchema.safeParse(bad).success).toBe(false);
    }
  });
});
