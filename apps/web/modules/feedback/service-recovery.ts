import 'server-only';
import { escalateServiceRecovery, type Db } from '@clinic-mx/db';
import { z } from 'zod';
import { systemService } from '../access/service';

/**
 * Service recovery (PAT-08; docs/runbooks/feedback.md): the queued escalation. A service recovery
 * task still open `feedback.escalate_hours` after the feedback gives the Clinical Director (the
 * Super Admin) a task too, once; audited as `system:feedback`.
 */
export function runServiceRecoveryEscalation(db: Db, input: { taskId: string }): Promise<boolean> {
  return systemService({
    component: 'feedback',
    input: z.object({ taskId: z.guid() }),
    run: (tx, { taskId }) => escalateServiceRecovery(tx, taskId),
  })(db, input);
}
