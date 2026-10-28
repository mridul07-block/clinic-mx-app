import { sql } from 'drizzle-orm';
import type { DbOrTransaction } from './versioned';

/**
 * Service recovery (PAT-08; PRD J7.2; docs/runbooks/feedback.md). Feedback with any No, or a
 * recommendation score at or below `feedback.recovery_score_max`, gives the centre's Centre
 * Managers a high task at once (`internal.feedback_service_recovery`, in the patient's own
 * transaction), and queues this job for `feedback.escalate_hours` later.
 */

export const SERVICE_RECOVERY_ESCALATE_JOB = 'feedback.recovery_escalate';

/**
 * The escalation: a service recovery task still open gets the Clinical Director (the Super Admin,
 * as for adverse events) a task of their own, once. True when it made one; a task closed in time,
 * or already escalated, changes nothing.
 */
export async function escalateServiceRecovery(
  db: DbOrTransaction,
  taskId: string,
): Promise<boolean> {
  const rows = await db.execute<{ id: string }>(sql`
    insert into task (kind, title, details, priority, assignee_role, centre_id, patient_id,
      episode_id)
    select 'feedback.service_recovery_director',
      replace(t.title, 'Service recovery:', 'Service recovery not closed in time:'),
      t.details || jsonb_build_object('recoveryTaskId', t.id), 'high', 'super_admin',
      t.centre_id, t.patient_id, t.episode_id
    from task t
    where t.id = ${taskId}::uuid and t.kind = 'feedback.service_recovery' and t.status = 'open'
      and not exists (
        select 1 from task d
        where d.kind = 'feedback.service_recovery_director'
          and d.details ->> 'recoveryTaskId' = t.id::text
      )
    returning id`);
  return rows.length > 0;
}
