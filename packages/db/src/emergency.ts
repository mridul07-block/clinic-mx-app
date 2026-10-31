import { EMERGENCY_CALL_TASK } from '@clinic-mx/schemas';
import { and, eq, sql } from 'drizzle-orm';
import { message, task } from './schema';
import type { DbOrTransaction } from './versioned';

/**
 * The urgent front desk task an emergency phrase on WhatsApp raises (WA-10; PRD J1.9), as the
 * server. One open task per number (user decision, 31 October 2026): a number whose task is still
 * open adds none, though every message gets the advice. The task names its message, never the
 * number; the card reads the number through `internal.task_call_back_phone`. A lock on the number
 * makes two messages at once raise one task. Its centre is the patient's when the number is theirs
 * alone, otherwise none, which every centre's front desk sees.
 */
export async function raiseEmergencyTask(
  tx: DbOrTransaction,
  values: {
    messageId: string;
    phone: string;
    patientId: string | null;
    centreId: string | null;
  },
): Promise<'raised' | 'open already'> {
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtext(${['whatsapp.emergency', values.phone].join(':')}))`,
  );
  const [open] = await tx
    .select({ id: task.id })
    .from(task)
    .innerJoin(
      message,
      sql`${message.id} = case when ${task.kind} = ${EMERGENCY_CALL_TASK}
        then (${task.details} ->> 'messageId')::uuid end`,
    )
    .where(
      and(
        eq(task.kind, EMERGENCY_CALL_TASK),
        eq(task.status, 'open'),
        // The inbound phone index (`message_inbound_phone_idx`) is partial on direction.
        eq(message.direction, 'inbound'),
        eq(message.fromPhone, values.phone),
      ),
    )
    .limit(1);
  if (open) return 'open already';
  await tx.insert(task).values({
    kind: EMERGENCY_CALL_TASK,
    title: 'Emergency message on WhatsApp: call back now',
    details: { messageId: values.messageId },
    priority: 'urgent',
    assigneeRole: 'front_desk',
    centreId: values.centreId,
    patientId: values.patientId,
  });
  return 'raised';
}
