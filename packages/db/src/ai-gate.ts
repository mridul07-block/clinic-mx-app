import { aiSheetGateState, type AiSheetGateState } from '@clinic-mx/schemas';
import { eq } from 'drizzle-orm';
import { latestKnowledgeVersion } from './knowledge';
import { setting } from './schema';
import type { DbOrTransaction } from './versioned';

/**
 * The AI preparation sheet's gate (AI-09, PRD decision 23): the stored `ai.preparation_sheet`
 * value, read from its row each time (not the settings cache, so switching off takes effect at
 * once everywhere), against the live knowledge base version. Anything missing or unreadable is
 * off. `stored` is the raw value, for the Super Admin's page to show the records.
 */
export async function aiSheetGate(db: DbOrTransaction): Promise<{
  state: AiSheetGateState;
  stored: unknown;
  live: { id: string; number: number } | undefined;
}> {
  const [row] = await db
    .select({ value: setting.value })
    .from(setting)
    .where(eq(setting.key, 'ai.preparation_sheet'));
  const version = await latestKnowledgeVersion(db);
  const live = version ? { id: version.id, number: version.number } : undefined;
  return { state: aiSheetGateState(row?.value, live), stored: row?.value, live };
}
