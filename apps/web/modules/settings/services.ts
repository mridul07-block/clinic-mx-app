import 'server-only';
import {
  changeSettingValue,
  lockSettings,
  settingEntries,
  staffActor,
  type SettingEntry,
  type StaffMember,
} from '@clinic-mx/db';
import {
  parseSettingField,
  settingChangeSchema,
  settingChangedElsewhere,
} from '@clinic-mx/schemas';
import { assertMay } from '../access/guard';
import { staffService } from '../access/service';
import { asStaff } from '../access/staff-db';

/**
 * The settings screen (ADM-02; docs/runbooks/settings.md): the Super Admin reads every business
 * rule setting and changes one at a time (`settings.manage`), validated by the registry, on the
 * value read, audited. Velyx support reads it only. Recommended defaults chosen under the user's
 * standing approval, 29 October 2026 (DECISION ADM-02).
 */

/** A refusal to show the Super Admin as it is. */
export class SettingChangeError extends Error {
  override name = 'SettingChangeError';
}

export async function settingsForScreen(staff: StaffMember): Promise<SettingEntry[]> {
  assertMay(staff, 'settings.manage');
  return asStaff(staff, (tx) => settingEntries(tx));
}

/** Changes one setting; when saved, the caller then clears the settings cache. */
export const changeSetting = staffService({
  action: 'settings.manage',
  input: settingChangeSchema,
  run: async (tx, { key, value, seenAt }, actor): Promise<'saved' | 'unchanged'> => {
    const elsewhere = settingChangedElsewhere(key);
    if (elsewhere) throw new SettingChangeError(elsewhere.reason);
    // Held until the save ends, so a minimum and its maximum are never changed past each other.
    await lockSettings(tx);
    const current = Object.fromEntries(
      (await settingEntries(tx)).map((entry) => [entry.key, entry.value]),
    );
    const parsed = parseSettingField(key, value, current);
    if (!parsed.ok) throw new SettingChangeError(parsed.error);
    const result = await changeSettingValue(tx, {
      key,
      value: parsed.value,
      actor: staffActor(actor.id),
      seenAt: new Date(seenAt),
    });
    if (result === 'stale') {
      throw new SettingChangeError(
        'This setting has changed since you opened the page. Reload to read it, then change it again.',
      );
    }
    return result;
  },
});
