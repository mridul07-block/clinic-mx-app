import type { PlanChoice } from '@clinic-mx/schemas';
import { and, desc, eq, sql } from 'drizzle-orm';
import { episode, job, packageType, patientPlanChoice, priceItem, staffUser, task } from './schema';
import type { DbOrTransaction } from './versioned';

/**
 * The patient's choice on the recommended plan (BIL-02, PRD J4.3; docs/runbooks/plan-sheet.md).
 * Row level security lets those who price the episode read and record choices, only while it is
 * Plan proposed and against its newest plan; the database stamps the times and queues the "I'll
 * think about it" follow up.
 */

/** The follow up the database queues for "I'll think about it", and what it raises. */
export const THINK_ABOUT_IT_FOLLOW_UP_JOB = 'billing.think_about_it_follow_up';
export const THINK_ABOUT_IT_MESSAGE_JOB = 'whatsapp.think_about_it';
export const THINK_ABOUT_IT_CALL_TASK = 'call.think_about_it';

export interface PlanChoiceEntry {
  id: string;
  choice: PlanChoice;
  packageName: string | null;
  sessionLabel: string | null;
  followUpAt: Date | null;
  recordedByName: string | null;
  recordedAt: Date;
}

/** Records a choice as the signed in person; row level security checks it may be recorded. */
export async function recordPlanChoice(
  db: DbOrTransaction,
  values: {
    episodeId: string;
    planOfCareId: string;
    choice: PlanChoice;
    packageTypeId?: string;
    sessionPriceItemId?: string;
    recordedBy: string;
  },
): Promise<{ id: string; followUpAt: Date | null }> {
  const [created] = await db
    .insert(patientPlanChoice)
    .values({
      episodeId: values.episodeId,
      planOfCareId: values.planOfCareId,
      choice: values.choice,
      packageTypeId: values.packageTypeId ?? null,
      sessionPriceItemId: values.sessionPriceItemId ?? null,
      recordedBy: values.recordedBy,
    })
    .returning({ id: patientPlanChoice.id, followUpAt: patientPlanChoice.followUpAt });
  if (!created) throw new Error('The choice was not recorded.');
  return created;
}

/** An episode's choices, newest first: the first is the one that counts. */
export async function planChoicesOf(
  db: DbOrTransaction,
  episodeId: string,
): Promise<PlanChoiceEntry[]> {
  return db
    .select({
      id: patientPlanChoice.id,
      choice: patientPlanChoice.choice,
      packageName: packageType.name,
      sessionLabel: priceItem.label,
      followUpAt: patientPlanChoice.followUpAt,
      recordedByName: staffUser.name,
      recordedAt: patientPlanChoice.recordedAt,
    })
    .from(patientPlanChoice)
    .leftJoin(packageType, eq(packageType.id, patientPlanChoice.packageTypeId))
    .leftJoin(priceItem, eq(priceItem.id, patientPlanChoice.sessionPriceItemId))
    .leftJoin(staffUser, eq(staffUser.id, patientPlanChoice.recordedBy))
    .where(eq(patientPlanChoice.episodeId, episodeId))
    .orderBy(desc(patientPlanChoice.recordedAt));
}

/**
 * The "I'll think about it" follow up, as the system: a call task for the front desk at the
 * episode's centre and the WhatsApp nudge, but only while the choice is still the episode's
 * newest, against its newest plan, and the episode is still Plan proposed. Safe to run twice: a
 * choice that already has its task gets nothing more.
 */
export async function thinkAboutItFollowUp(
  db: DbOrTransaction,
  choiceId: string,
): Promise<'raised' | 'no longer thinking' | 'already raised'> {
  const [current] = await db
    .select({
      id: patientPlanChoice.id,
      episodeId: patientPlanChoice.episodeId,
      patientId: episode.patientId,
      centreId: episode.centreId,
      since: sql<string>`to_char(${patientPlanChoice.recordedAt} at time zone 'Asia/Kolkata', 'Dy FMDD Mon')`,
    })
    .from(patientPlanChoice)
    .innerJoin(episode, eq(episode.id, patientPlanChoice.episodeId))
    .where(
      and(
        eq(patientPlanChoice.id, choiceId),
        eq(patientPlanChoice.choice, 'think_about_it'),
        eq(episode.status, 'plan_proposed'),
        // Still the newest choice, against the episode's newest plan.
        sql`not exists (
          select 1 from plan_choice later
          where later.episode_id = ${patientPlanChoice.episodeId}
            and later.recorded_at > ${patientPlanChoice.recordedAt}
        )`,
        sql`${patientPlanChoice.planOfCareId} = (
          select p.id from plan_of_care p where p.episode_id = ${patientPlanChoice.episodeId}
          order by p.version desc limit 1
        )`,
      ),
    );
  if (!current) return 'no longer thinking';
  const [raised] = await db
    .select({ id: task.id })
    .from(task)
    .where(
      and(
        eq(task.kind, THINK_ABOUT_IT_CALL_TASK),
        sql`${task.details} ->> 'choiceId' = ${choiceId}`,
      ),
    );
  if (raised) return 'already raised';
  await db.insert(task).values({
    kind: THINK_ABOUT_IT_CALL_TASK,
    title: `Call about the proposed plan (thinking it over since ${current.since})`,
    details: { choiceId },
    priority: 'normal',
    assigneeRole: 'front_desk',
    centreId: current.centreId,
    patientId: current.patientId,
    episodeId: current.episodeId,
  });
  await db
    .insert(job)
    .values({
      kind: THINK_ABOUT_IT_MESSAGE_JOB,
      payload: { choiceId },
      idempotencyKey: [THINK_ABOUT_IT_MESSAGE_JOB, choiceId].join(':'),
    })
    .onConflictDoNothing({ target: job.idempotencyKey });
  return 'raised';
}
