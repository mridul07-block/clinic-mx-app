import 'server-only';
import {
  approvePatientContent,
  discardPatientContentDraft,
  liveConditionName,
  liveKbVersionId,
  patientContentList,
  patientContentOf,
  savePatientContentDraft,
  type PatientContentEntry,
  type StaffMember,
} from '@clinic-mx/db';
import {
  can,
  patientContentDecisionSchema,
  patientContentSaveSchema,
  patientContentState,
  type PatientContentState,
} from '@clinic-mx/schemas';
import { assertMay } from '../access/guard';
import { staffService, type ServiceTransaction } from '../access/service';
import { asStaff } from '../access/staff-db';

/**
 * Patient content per condition (AI-07; docs/runbooks/patient-content.md). Everyone who reads the
 * knowledge base reads it; a consultant who treats patients (`patient_content.approve`) writes a
 * condition's draft, discards it, or approves it, when it becomes what patients see. Every save and
 * decision names the draft and revision read, so another consultant's change in between is never
 * overwritten or approved unread. Recommended defaults chosen under the user's standing approval,
 * 29 October 2026 (DECISION AI-07).
 */

export class PatientContentError extends Error {
  override name = 'PatientContentError';
}

const CHANGED =
  'The draft has changed since you opened it. Reload the page to read it; what you typed is still here.';

/** The database's refusals of a race, in words; anything else is ours and is thrown. */
function refusal(error: unknown): never {
  const code =
    (error as { cause?: { code?: string } }).cause?.code ?? (error as { code?: string }).code;
  if (code === '23505') {
    throw new PatientContentError(
      'Someone has just started a draft for this condition. Reload the page to read it.',
    );
  }
  if (code === '23514') throw new PatientContentError(CHANGED);
  if (code === '42501') {
    throw new PatientContentError(
      'Only a consultant who treats patients writes and approves patient content.',
    );
  }
  throw error;
}

/** The live version's conditions with their content's state, by name. */
export async function loadPatientContentList(
  actor: StaffMember,
): Promise<{ conditionId: string; name: string; state: PatientContentState }[]> {
  assertMay(actor, 'knowledge_base.view');
  const rows = await asStaff(actor, (tx) => patientContentList(tx));
  return rows.map((row) => ({
    conditionId: row.conditionId,
    name: row.name,
    state: patientContentState(row),
  }));
}

/** A condition's content for its page; undefined when the live version has no such condition. */
export async function loadPatientContent(
  actor: StaffMember,
  conditionId: string,
): Promise<
  | {
      name: string;
      draft?: PatientContentEntry;
      approved?: PatientContentEntry;
      /** The draft was written against a version no longer live: save it before approving. */
      draftIsOld: boolean;
      /** Whether the reader writes and approves (a consultant who treats patients). */
      writes: boolean;
    }
  | undefined
> {
  assertMay(actor, 'knowledge_base.view');
  return asStaff(actor, async (tx) => {
    const name = await liveConditionName(tx, conditionId);
    if (!name) return undefined;
    const content = await patientContentOf(tx, conditionId);
    const live = await liveKbVersionId(tx);
    return {
      name,
      ...content,
      draftIsOld: content.draft !== undefined && content.draft.kbVersionId !== live,
      writes: !actor.support && can(actor, 'patient_content.approve'),
    };
  });
}

const liveCondition = async (input: { conditionId: string }, tx: ServiceTransaction) => {
  if (!(await liveConditionName(tx, input.conditionId))) {
    throw new PatientContentError('That condition is not in the knowledge base.');
  }
  return {};
};

/**
 * Saves the condition's draft: the draft and revision read, or a new one when none was open;
 * refused when it has changed or someone started one meanwhile. The draft's id; audited.
 */
export const saveDraft = staffService({
  action: 'patient_content.approve',
  input: patientContentSaveSchema,
  target: liveCondition,
  run: async (tx, input) => {
    const { draftId, revision, ...draft } = input;
    const read = draftId && revision ? { draftId, revision } : undefined;
    try {
      const saved = await savePatientContentDraft(tx, draft, read);
      if (!saved) throw new PatientContentError(CHANGED);
      return saved;
    } catch (error) {
      if (error instanceof PatientContentError) throw error;
      return refusal(error);
    }
  },
});

/** The draft and revision the consultant read, if it is still the condition's draft as read. */
async function readDraft(
  tx: ServiceTransaction,
  input: { conditionId: string; draftId: string; revision: number },
) {
  const { draft } = await patientContentOf(tx, input.conditionId);
  if (draft?.id !== input.draftId || draft.revision !== input.revision) {
    throw new PatientContentError(CHANGED);
  }
  return draft;
}

/** Approves the revision of the draft the consultant read: patients see it from now on; audited. */
export const approveDraft = staffService({
  action: 'patient_content.approve',
  input: patientContentDecisionSchema,
  target: liveCondition,
  run: async (tx, input) => {
    const draft = await readDraft(tx, input);
    if (draft.kbVersionId !== (await liveKbVersionId(tx))) {
      throw new PatientContentError(
        'The draft was written against an older knowledge base version. Save it again to bring it up to date, then approve it.',
      );
    }
    try {
      await approvePatientContent(tx, input.draftId, input.revision);
    } catch (error) {
      refusal(error);
    }
  },
});

/** Discards the draft the consultant read; the approved text, if any, stays; audited. */
export const discardDraft = staffService({
  action: 'patient_content.approve',
  input: patientContentDecisionSchema,
  target: liveCondition,
  run: async (tx, input) => {
    await readDraft(tx, input);
    if (!(await discardPatientContentDraft(tx, input.draftId))) {
      throw new PatientContentError('The draft is no longer there.');
    }
  },
});
