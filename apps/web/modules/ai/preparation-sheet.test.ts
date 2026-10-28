import type { Db } from '@clinic-mx/db';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { runPreparationSheet } from './preparation-sheet';

const db = vi.hoisted(() => ({ aiSheetGate: vi.fn() }));
vi.mock('@clinic-mx/db', () => db);

const episodeId = '00000000-0000-4000-8000-000000000e01';
const kbVersionId = '00000000-0000-4000-8000-000000000c01';

// AI-09: the preparation sheet job checks the AI gate each time it runs and does nothing while
// the sheet is off (the gate's own states are unit tests in packages/schemas/src/ai.test.ts).
describe('the AI preparation sheet job', () => {
  beforeEach(() => {
    db.aiSheetGate.mockReset();
  });

  it('does nothing while the sheet is off, for any reason', async () => {
    for (const reason of ['off', 'knowledge_base_changed', 'no_knowledge_base', 'unreadable']) {
      db.aiSheetGate.mockResolvedValueOnce({ state: { on: false, reason } });
      expect(await runPreparationSheet({} as Db, episodeId)).toBe('off');
    }
    expect(db.aiSheetGate).toHaveBeenCalledTimes(4);
  });

  it('goes on to the sheet while on, the same each time it runs', async () => {
    db.aiSheetGate.mockResolvedValue({ state: { on: true, kbVersionId, kbVersionNumber: 3 } });
    expect(await runPreparationSheet({} as Db, episodeId)).toBe('waiting_for_ai_03');
    expect(await runPreparationSheet({} as Db, episodeId)).toBe('waiting_for_ai_03');
  });
});
