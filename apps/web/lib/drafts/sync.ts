import type { DraftController, DraftSaver } from './controller';
import { deleteDraft, listDrafts, putDraft } from './store';

/**
 * Saving drafts when the connection returns (FND-08), including drafts whose screen is no
 * longer open: a staff member types a note offline, moves on, and the note is saved as soon as
 * the phone is back online. Open screens save their own draft; the rest are sent with the saver
 * registered for their kind.
 */

const open = new Map<string, DraftController<unknown>>();

/** An open screen takes charge of its draft while mounted. */
export function claimDraft(controller: DraftController<unknown>): () => void {
  open.set(controller.key, controller);
  return () => {
    if (open.get(controller.key) === controller) open.delete(controller.key);
  };
}

/** For each draft kind, the saver for one record of that kind. */
export type DraftSavers = Readonly<Record<string, (id: string) => DraftSaver<unknown>>>;

export interface FlushResult {
  saved: number;
  conflicts: number;
  waiting: number;
}

/**
 * Saves every waiting draft of `scope`. A conflict is stored on the draft, so the notice shows
 * when its screen is next opened; a draft without a saver, or that cannot be sent, waits.
 */
export async function flushDrafts(scope: string, savers: DraftSavers): Promise<FlushResult> {
  const result: FlushResult = { saved: 0, conflicts: 0, waiting: 0 };
  for (const draft of await listDrafts(scope)) {
    const controller = open.get(draft.key);
    if (controller) {
      await controller.flush();
      const { status } = controller.getState();
      if (status === 'saved') result.saved++;
      else if (status === 'conflict') result.conflicts++;
      else result.waiting++;
      continue;
    }
    const save = savers[draft.kind]?.(draft.id);
    if (draft.conflict || !save) {
      if (draft.conflict) result.conflicts++;
      else result.waiting++;
      continue;
    }
    try {
      const response = await save(draft.value, draft.baseVersion);
      if (response.status === 'saved') {
        await deleteDraft(draft.key);
        result.saved++;
      } else {
        await putDraft({
          ...draft,
          conflict: { version: response.version, value: response.value },
        });
        result.conflicts++;
      }
    } catch {
      result.waiting++;
    }
  }
  return result;
}
