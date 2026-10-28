import { z } from 'zod';
import { istDate } from './ist';

/**
 * The AI on and off gate (AI-09, PRD decision 23; PRD section 3 phase 5: the AI preparation sheet
 * and recheck are "switched on only after the blind test passes"; TAD: "legal check before the AI
 * gate"). Recommended defaults chosen under the user's standing approval, 28 October 2026
 * (docs/runbooks/ai-gate.md); the client's lawyer confirms the scope (DECISION 23).
 *
 * One setting, `ai.preparation_sheet`, off until the Super Admin records both a blind test pass
 * and a legal clearance, each a date and a reference (no pass mark is invented). It is pinned to
 * the knowledge base version live when switched on: a newer live version switches the sheet off
 * until a new blind test is recorded (TAD: the blind test reruns whenever the knowledge base
 * changes).
 */

/** A recorded pass or clearance: when, and the document it is in. No patient details. */
const evidence = z.strictObject({
  date: z.iso.date({ error: 'Enter the date.' }),
  reference: z
    .string()
    .trim()
    .min(1, { error: 'Enter the document name or number.' })
    .max(200, { error: 'Keep the reference under 200 characters.' }),
});

/** The stored value of `ai.preparation_sheet`. */
export const aiSheetSettingSchema = z.discriminatedUnion('on', [
  z.strictObject({ on: z.literal(false) }),
  z.strictObject({
    on: z.literal(true),
    blindTest: evidence,
    legalCheck: evidence,
    since: z.iso.datetime(),
    kbVersionId: z.guid(),
    kbVersionNumber: z.int().positive(),
  }),
]);
export type AiSheetSetting = z.infer<typeof aiSheetSettingSchema>;

const notAhead = (part: 'blind test' | 'legal check') =>
  evidence.refine((value) => value.date <= istDate(new Date()), {
    error: `The ${part} date cannot be in the future.`,
    path: ['date'],
  });

/** The Super Admin's switch: off any time; on only with both records. */
export const aiSheetSwitchSchema = z.discriminatedUnion('on', [
  z.strictObject({ on: z.literal(false) }),
  z.strictObject({
    on: z.literal(true),
    blindTest: notAhead('blind test'),
    legalCheck: notAhead('legal check'),
  }),
]);
export type AiSheetSwitch = z.infer<typeof aiSheetSwitchSchema>;

/** Why the sheet is off. */
export type AiSheetOffReason =
  'off' | 'knowledge_base_changed' | 'no_knowledge_base' | 'unreadable';

export type AiSheetGateState =
  | { on: true; kbVersionId: string; kbVersionNumber: number }
  | { on: false; reason: AiSheetOffReason; switchedOnFor?: number };

/**
 * What the Super Admin may do from here: switch off whenever the stored value is on (also when a
 * newer knowledge base version has switched the gate off, so it cannot come back on by itself if
 * that version stops being live); switch on, with new records, whenever the gate is off.
 */
export function aiSheetSwitchChoices(
  stored: unknown,
  state: AiSheetGateState,
): { switchOff: boolean; switchOn: boolean } {
  const storedOn = aiSheetSettingSchema.safeParse(stored).data?.on === true;
  return { switchOff: storedOn, switchOn: !state.on };
}

/**
 * Whether the AI preparation sheet may run: the stored value (unparsed; anything unreadable is
 * off) against the live knowledge base version. Fails closed.
 */
export function aiSheetGateState(
  stored: unknown,
  live: { id: string; number: number } | undefined,
): AiSheetGateState {
  const parsed = aiSheetSettingSchema.safeParse(stored);
  if (!parsed.success) return { on: false, reason: 'unreadable' };
  if (!parsed.data.on) return { on: false, reason: 'off' };
  if (!live) return { on: false, reason: 'no_knowledge_base' };
  if (live.id !== parsed.data.kbVersionId) {
    return {
      on: false,
      reason: 'knowledge_base_changed',
      switchedOnFor: parsed.data.kbVersionNumber,
    };
  }
  return { on: true, kbVersionId: live.id, kbVersionNumber: live.number };
}
