import 'server-only';
import {
  consultationRecord,
  saveConsultationSections,
  type ConsultationEntry,
  type StaffMember,
} from '@clinic-mx/db';
import {
  consultationSectionsSchema,
  recordVersionSchema,
  type ConsultationSections,
  type DraftSaveResponse,
} from '@clinic-mx/schemas';
import { z } from 'zod';
import { assertMay } from '../access/guard';
import { staffService } from '../access/service';
import { asStaff } from '../access/staff-db';

/**
 * The consultation (CLN-02, PRD J3.2): its own consultant writes it, section by section, saved by
 * autosave against its version (FND-08). Nobody else edits it, and a signed one refuses every
 * save: changes are addenda (rule 5). Row level security and the rules migration hold the same.
 */

/** A refusal the person reads; the endpoint answers it as not found or refused. */
export class ConsultationError extends Error {
  constructor(
    message: string,
    readonly reason: 'not_found' | 'signed',
  ) {
    super(message);
    this.name = 'ConsultationError';
  }
}

export interface ConsultationView extends Omit<ConsultationEntry, 'sections'> {
  sections: ConsultationSections;
}

/** The person's own consultation, or undefined when there is none they write. */
export async function loadConsultation(
  actor: StaffMember,
  consultationId: string,
): Promise<ConsultationView | undefined> {
  assertMay(actor, 'consultant_records.write');
  if (!z.guid().safeParse(consultationId).success) return undefined;
  const found = await asStaff(actor, (tx) => consultationRecord(tx, consultationId));
  if (!found || found.physioId !== actor.id) return undefined;
  return { ...found, sections: consultationSectionsSchema.parse(found.sections) };
}

export const saveConsultationSchema = z.object({
  consultationId: z.guid(),
  value: consultationSectionsSchema,
  baseVersion: recordVersionSchema,
});

/** Saves an autosaved draft of the sections at the version it started from. */
export const saveConsultation = staffService({
  action: 'consultant_records.write',
  input: saveConsultationSchema,
  run: async (tx, input, actor): Promise<DraftSaveResponse<ConsultationSections>> => {
    const found = await consultationRecord(tx, input.consultationId);
    if (!found || found.physioId !== actor.id) {
      throw new ConsultationError('That consultation was not found.', 'not_found');
    }
    if (found.status === 'signed') {
      throw new ConsultationError('This consultation is signed. Changes are addenda.', 'signed');
    }
    const saved = await saveConsultationSections(tx, found.id, input.baseVersion, input.value);
    if (saved.status === 'saved') return saved;
    return {
      status: 'conflict',
      version: saved.version,
      value: consultationSectionsSchema.parse(saved.row.sections),
    };
  },
});
