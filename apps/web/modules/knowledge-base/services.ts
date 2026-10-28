import 'server-only';
import { approveKnowledgeVersion } from '@clinic-mx/db';
import { approveKnowledgeVersionSchema } from '@clinic-mx/schemas';
import { staffService } from '../access/service';

/**
 * Knowledge base versions (SET-06, PRD M16): the Super Admin approves a draft once they have read
 * its import report, and new clinical records take the live version from then on. A staffService
 * for knowledge_base.edit; the database's `internal.approve_kb_version` checks the same, names
 * the approver and refuses a version already approved or older than the live one. Versions are
 * made only by the import (`pnpm kb:import --apply`); none is ever changed after approval.
 */
export const approveVersion = staffService({
  action: 'knowledge_base.edit',
  input: approveKnowledgeVersionSchema,
  run: (tx, input) =>
    approveKnowledgeVersion(tx, { versionId: input.versionId, notes: input.notes }),
});
