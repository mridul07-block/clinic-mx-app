import 'server-only';
import { aiSheetGate, type DbOrTransaction } from '@clinic-mx/db';

/**
 * The AI on and off gate (AI-09, PRD decision 23; docs/runbooks/ai-gate.md). The AI preparation
 * sheet, its recheck and similar cases (AI-02 to AI-05) run only while the Super Admin has
 * switched the sheet on, with the blind test pass and the legal clearance recorded, for the live
 * knowledge base version.
 *
 * `AiSheetPass` is the proof: only this module makes one, so every AI step that suggests a
 * diagnosis takes a pass as a parameter and cannot be called while the gate is off. Check it at
 * the moment of use (in the job, on the screen), never cache it.
 */
declare const passMark: unique symbol;
export interface AiSheetPass {
  readonly [passMark]: true;
  /** The knowledge base version the sheet was switched on for, which the sheet must use. */
  readonly kbVersionId: string;
}

/** A pass while the gate is on; null while it is off, for whatever reason. */
export async function aiSheetPass(db: DbOrTransaction): Promise<AiSheetPass | null> {
  const { state } = await aiSheetGate(db);
  if (!state.on) return null;
  // The only place a pass is made.
  return { kbVersionId: state.kbVersionId } as AiSheetPass;
}
