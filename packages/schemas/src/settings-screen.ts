import { z } from 'zod';
import { settingDefinitions, settingKeys, type SettingKey } from './settings';

/**
 * The settings screen (ADM-02; PRD M16, section 7: the rules the Super Admin changes without a
 * release). Recommended defaults chosen under the user's standing approval, 29 October 2026
 * (DECISION ADM-02; docs/runbooks/settings.md): every setting by area, each changed on its own,
 * validated by the registry's schema; the few with their own screen or flow are read only here.
 */

/** Areas by key prefix, in the order the screen lists them. */
export const settingAreaLabels: Record<string, string> = {
  scheduling: 'Scheduling',
  booking: 'Booking',
  day: 'The day',
  live: 'Live screens',
  kiosk: 'Kiosk',
  intake: 'Health form',
  screening: 'Screening',
  assessment: 'Assessment',
  clinical: 'Clinical',
  patients: 'Patients',
  links: 'Patient links',
  reminders: 'Reminders',
  engagement: 'Engagement',
  feedback: 'Feedback',
  billing: 'Billing',
  packages: 'Packages',
  documents: 'Documents',
  reports: 'Reports',
  dashboard: 'Dashboards',
  kpi: 'Key figures',
  ai: 'AI',
  security: 'Security',
  limits: 'Rate limits',
  launch: 'Launch',
};

export function settingArea(key: string): string {
  return key.slice(0, key.indexOf('.'));
}

/** The keys of each area, areas in the screen's order and unknown areas last. */
export function settingsByArea(): { area: string; label: string; keys: SettingKey[] }[] {
  const areas = [...new Set(settingKeys.map(settingArea))];
  const order = Object.keys(settingAreaLabels);
  const rank = (area: string) => (order.includes(area) ? order.indexOf(area) : order.length);
  return areas
    .sort((a, b) => rank(a) - rank(b) || a.localeCompare(b))
    .map((area) => ({
      area,
      label: settingAreaLabels[area] ?? area,
      keys: settingKeys.filter((key) => settingArea(key) === area),
    }));
}

/**
 * Settings not changed here, with why. Some have their own screen or flow: switching the AI sheet
 * needs the blind test and legal clearance (AI-09); opening entries close on their page (SCH-13);
 * a model or prompt needs a new blind test, then a migration (AI-06, TAD section 7). Others hold
 * other records or the clinic's guarantees in place, so a change needs a release with them: the
 * slot step every length and roster is made of; the price items and appointment types the
 * database's rules count by key and in order; the AI providers never sent patient data (PRD
 * section 6); the age of majority behind consent and guardians (PRD J2.7).
 */
export function settingChangedElsewhere(key: string): { reason: string; href?: string } | null {
  if (key === 'ai.preparation_sheet') {
    return {
      reason: 'Switched on the AI preparation sheet page, with the blind test and legal clearance.',
      href: '/app/ai-preparation-sheet',
    };
  }
  if (key === 'launch.opening_entries_open') {
    return {
      reason: 'Opened and closed on the Opening entries page.',
      href: '/app/opening-entries',
    };
  }
  if (key.startsWith('ai.task_')) {
    return { reason: 'A new model or prompt needs a new blind test, then a release.' };
  }
  if (key === 'scheduling.slot_minutes') {
    return {
      reason:
        'Every appointment length and roster is made of these slots, so it changes with a release that moves them too.',
    };
  }
  if (
    key === 'billing.consultation_price_items' ||
    key === 'billing.session_price_items' ||
    key === 'packages.never_reschedulable_items' ||
    key === 'packages.session_appointment_types'
  ) {
    return {
      reason:
        'Names price items or appointment types that bills, packages and session counts rely on, so it changes with a release.',
    };
  }
  if (key === 'ai.blocked_providers') {
    return {
      reason:
        'The AI providers never sent patient data (PRD section 6); changed only with a release.',
    };
  }
  if (key === 'patients.adult_age_years') {
    return {
      reason:
        'The age from which patients consent for themselves (PRD J2.7); changed only with a release, on the clinic’s legal advice.',
    };
  }
  return null;
}

/**
 * Settings that must stay in order: the first at or under the second. Every `*_min` with its
 * `*_max`, and the pairs named otherwise.
 */
export const settingOrderPairs: readonly (readonly [SettingKey, SettingKey])[] = [
  ...settingKeys
    .filter((key) => key.endsWith('_min'))
    .map((key) => [key, key.replace(/_min$/, '_max')] as const)
    .filter((pair): pair is readonly [SettingKey, SettingKey] =>
      settingKeys.includes(pair[1] as SettingKey),
    ),
  ['assessment.irritability_low_below', 'assessment.irritability_high_above'],
  ['assessment.acute_weeks_below', 'assessment.chronic_weeks_above'],
  ['day.running_late_minutes', 'day.no_show_allowed_minutes'],
];

export type SettingInputKind = 'number' | 'yes_no' | 'choice' | 'text' | 'json';

interface SchemaShape {
  def: { type: string };
  options?: readonly unknown[];
}

/** How the screen asks for a setting's value, from its schema. */
export function settingInputKind(key: SettingKey): SettingInputKind {
  const schema = settingDefinitions[key].schema as unknown as SchemaShape;
  switch (schema.def.type) {
    case 'number':
      return 'number';
    case 'boolean':
      return 'yes_no';
    case 'enum':
      return (schema.options ?? []).every((option) => typeof option === 'string')
        ? 'choice'
        : 'json';
    case 'string':
      return 'text';
    default:
      return 'json';
  }
}

/** Whether a number setting may be below zero (the phone keypad then needs a minus key). */
export function settingTakesNegative(key: SettingKey): boolean {
  return settingDefinitions[key].schema.safeParse(-1).success;
}

/** The choices of a setting asked as a choice. */
export function settingChoices(key: SettingKey): string[] {
  const schema = settingDefinitions[key].schema as unknown as SchemaShape;
  return (schema.options ?? []).map(String);
}

/** A value as the screen's field holds it. */
export function settingFieldText(key: SettingKey, value: unknown): string {
  if (value === undefined || value === null) return '';
  const kind = settingInputKind(key);
  if (kind === 'json') return JSON.stringify(value, null, 2);
  if (kind === 'yes_no') return value === true ? 'yes' : 'no';
  return typeof value === 'string' || typeof value === 'number'
    ? String(value)
    : JSON.stringify(value);
}

/** A value as people read it, on one line; money in paise also in rupees. */
export function settingDisplay(key: SettingKey, value: unknown): string {
  const kind = settingInputKind(key);
  if (kind === 'yes_no') return value === true ? 'Yes' : 'No';
  if (kind === 'json') return JSON.stringify(value);
  if (key.endsWith('_paise') && typeof value === 'number') {
    return `${String(value)} paise (₹${(value / 100).toLocaleString('en-IN')})`;
  }
  return String(value);
}

/** A number as people type it: digits, an optional sign and decimals; nothing else. */
const typedNumber = /^-?\d+$|^-?\d+\.\d+$/;

/**
 * The value typed for a setting, checked against its schema and the settings it must stay in
 * order with (`settingOrderPairs`); or what is wrong, in words.
 */
export function parseSettingField(
  key: SettingKey,
  text: string,
  current: Partial<Record<SettingKey, unknown>>,
): { ok: true; value: unknown } | { ok: false; error: string } {
  const kind = settingInputKind(key);
  let raw: unknown = text.trim();
  if (kind === 'number') {
    if (!typedNumber.test(text.trim())) return { ok: false, error: 'Enter a number.' };
    raw = Number(text.trim());
  } else if (kind === 'yes_no') {
    if (raw !== 'yes' && raw !== 'no') return { ok: false, error: 'Choose yes or no.' };
    raw = raw === 'yes';
  } else if (kind === 'json') {
    try {
      raw = JSON.parse(text) as unknown;
    } catch {
      return { ok: false, error: 'This is not valid JSON. Check the brackets, commas and quotes.' };
    }
  }
  const parsed = settingDefinitions[key].schema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      error: `Not a valid value: ${parsed.error.issues[0]?.message ?? 'check it'}.`,
    };
  }
  for (const [lower, upper] of settingOrderPairs) {
    if (key === lower) {
      const other = current[upper];
      if (typeof other === 'number' && typeof parsed.data === 'number' && parsed.data > other) {
        return { ok: false, error: `Must not be more than ${upper} (${String(other)}).` };
      }
    }
    if (key === upper) {
      const other = current[lower];
      if (typeof other === 'number' && typeof parsed.data === 'number' && parsed.data < other) {
        return { ok: false, error: `Must not be less than ${lower} (${String(other)}).` };
      }
    }
  }
  return { ok: true, value: parsed.data };
}

/** The longest value the screen takes. */
export const SETTING_TEXT_MAX = 20_000;

/** A change from the screen: the key, the typed value, and when the value read was last changed. */
export const settingChangeSchema = z.object({
  key: z.enum(settingKeys as [SettingKey, ...SettingKey[]]),
  value: z.string().max(SETTING_TEXT_MAX, { error: 'That value is too long.' }),
  seenAt: z.iso.datetime({ offset: true }),
});
export type SettingChange = z.infer<typeof settingChangeSchema>;
