import 'server-only';
import {
  aiSheetGate,
  latestKnowledgeVersion,
  setting,
  staffActor,
  type StaffMember,
} from '@clinic-mx/db';
import {
  aiSheetSettingSchema,
  aiSheetSwitchChoices,
  aiSheetSwitchSchema,
  can,
  type AiSheetGateState,
  type AiSheetSetting,
} from '@clinic-mx/schemas';
import { eq } from 'drizzle-orm';
import { settingsDb } from '../../lib/db';
import { NotAllowedError } from '../access/guard';
import { staffService } from '../access/service';

/**
 * Switching the AI preparation sheet on and off (AI-09, PRD decision 23): the Super Admin only
 * (settings.manage; not a support login), audited by the settings row's trigger. Off any time;
 * on only with the blind test pass and the legal clearance, for the knowledge base version live
 * now, recorded with the switch. The database refuses "on" without them.
 */

/** A refusal to show the Super Admin as it is. */
export class AiSwitchError extends Error {
  override name = 'AiSwitchError';
}

export const switchAiSheet = staffService({
  action: 'settings.manage',
  input: aiSheetSwitchSchema,
  run: async (tx, input, actor): Promise<AiSheetSetting> => {
    let value: AiSheetSetting = { on: false };
    if (input.on) {
      const live = await latestKnowledgeVersion(tx);
      if (!live) throw new AiSwitchError('Import a knowledge base first.');
      value = aiSheetSettingSchema.parse({
        ...input,
        since: new Date().toISOString(),
        kbVersionId: live.id,
        kbVersionNumber: live.number,
      });
    }
    const rows = await tx
      .update(setting)
      .set({ value, updatedBy: staffActor(actor.id), updatedAt: new Date() })
      .where(eq(setting.key, 'ai.preparation_sheet'))
      .returning({ key: setting.key });
    if (rows.length === 0) throw new Error('ai.preparation_sheet is missing');
    return value;
  },
});

export interface AiSheetView {
  state: AiSheetGateState;
  /** The records while switched on (even for an older knowledge base version). */
  setting: AiSheetSetting | null;
  live: { id: string; number: number } | undefined;
  choices: { switchOff: boolean; switchOn: boolean };
}

/** The AI preparation sheet page for the Super Admin: read fresh, never from the cache. */
export async function aiSheetView(actor: StaffMember): Promise<AiSheetView> {
  if (!can(actor, 'settings.manage')) throw new NotAllowedError();
  const { state, stored, live } = await aiSheetGate(settingsDb());
  const parsed = aiSheetSettingSchema.safeParse(stored);
  return {
    state,
    setting: parsed.success ? parsed.data : null,
    live,
    choices: aiSheetSwitchChoices(stored, state),
  };
}
