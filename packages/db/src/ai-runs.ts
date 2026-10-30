import { and, eq, gte, isNull, ne, sql } from 'drizzle-orm';
import { aiRun, task } from './schema';
import type { DbOrTransaction } from './versioned';

export type NewAiRun = typeof aiRun.$inferInsert;

/** Records one AI gateway run (AI-01). Runs are never changed afterwards. */
export async function insertAiRun(tx: DbOrTransaction, run: NewAiRun): Promise<string> {
  const [row] = await tx.insert(aiRun).values(run).returning({ id: aiRun.id });
  if (!row) throw new Error('The AI run was not recorded.');
  return row.id;
}

/**
 * What the live AI has been charged since `since`, in millionths of a US dollar; blind test runs
 * (AI-06) and the one-time patient content (AI-07) have their own budgets and never count here.
 */
export async function aiSpendSince(db: DbOrTransaction, since: Date): Promise<bigint> {
  const [row] = await db
    .select({ total: sql<string>`coalesce(sum(${aiRun.costMicroUsd}), 0)::text` })
    .from(aiRun)
    .where(
      and(
        gte(aiRun.createdAt, since),
        isNull(aiRun.blindTestRun),
        ne(aiRun.kind, 'write_patient_content'),
      ),
    );
  return BigInt(row?.total ?? '0');
}

/** What one blind test run (AI-06) has been charged so far, in millionths of a US dollar. */
export async function blindTestSpend(db: DbOrTransaction, runId: string): Promise<bigint> {
  const [row] = await db
    .select({ total: sql<string>`coalesce(sum(${aiRun.costMicroUsd}), 0)::text` })
    .from(aiRun)
    .where(eq(aiRun.blindTestRun, runId));
  return BigInt(row?.total ?? '0');
}

export const AI_SPEND_CAP_TASK = 'ai.spend_cap';

/**
 * Tells the Super Admin the daily AI spend cap was reached (TAD section 7: "A daily spend cap with
 * an alert to the Super Admin"): one open task at a time, so a capped day never adds a second.
 */
export async function openAiSpendCapTask(
  tx: DbOrTransaction,
  details: { capPaise: number; spentPaise: string; day: string },
): Promise<void> {
  await tx
    .insert(task)
    .values({
      kind: AI_SPEND_CAP_TASK,
      title: 'The daily AI spend cap was reached; AI suggestions are paused until tomorrow',
      details,
      priority: 'high',
      assigneeRole: 'super_admin',
    })
    .onConflictDoNothing({
      target: task.kind,
      where: sql`${task.kind} = ${AI_SPEND_CAP_TASK} and ${task.status} = 'open'`,
    });
}
