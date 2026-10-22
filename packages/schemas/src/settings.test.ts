import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  isSettingKey,
  parseSetting,
  recordRules,
  settingDefinitions,
  settingKeys,
} from './settings';

// FND-14 done when: every rule in PRD section 7 is read from settings.
const prd = readFileSync(
  join(import.meta.dirname, '..', '..', '..', 'docs', 'Clinic_Mx_PRD.md'),
  'utf8',
);

/** The "Rule | Value | Type" table of PRD section 7, as [rule, type] pairs. */
function prdSectionSevenRules(): [string, string][] {
  const section = prd.split(/^## /m).find((part) => part.startsWith('7. Business rules'));
  if (!section) throw new Error('PRD section 7 not found');
  const table = section.split(/^### /m)[0] ?? '';
  return table
    .split('\n')
    .filter(
      (line) => line.startsWith('| ') && !line.startsWith('| Rule') && !line.startsWith('| ---'),
    )
    .map((line) => {
      const cells = line.split('|').map((cell) => cell.trim());
      return [cells[1] ?? '', cells[3] ?? ''];
    });
}

const prdSources = [
  ...Object.values(settingDefinitions)
    .map((definition) => definition.source)
    .filter((source) => source.startsWith('PRD section 7: '))
    .map((source) => source.slice('PRD section 7: '.length)),
  // Rules whose values live on records the Super Admin keeps (appointment types, SET-03).
  ...Object.keys(recordRules),
];

describe('the settings registry', () => {
  it('covers every rule PRD section 7 marks as a Setting', () => {
    const rules = prdSectionSevenRules();
    expect(rules.length).toBeGreaterThan(20);
    const settingRules = rules.filter(([, type]) => type === 'Setting').map(([rule]) => rule);
    expect(settingRules.filter((rule) => !prdSources.includes(rule))).toEqual([]);
  });

  it('cites only PRD rules that are Settings, never fixed behaviour', () => {
    const settingRules = new Set(
      prdSectionSevenRules()
        .filter(([, type]) => type === 'Setting')
        .map(([rule]) => rule),
    );
    expect(prdSources.filter((rule) => !settingRules.has(rule))).toEqual([]);
  });

  it('names keys as area.name in lower case', () => {
    for (const key of settingKeys) expect(key).toMatch(/^[a-z]+\.[a-z0-9_]+$/);
  });

  it('knows its own keys', () => {
    expect(isSettingKey('day.running_late_minutes')).toBe(true);
    expect(isSettingKey('day.unknown')).toBe(false);
    expect(isSettingKey('toString')).toBe(false);
  });
});

describe('setting values', () => {
  it('accept well formed values', () => {
    expect(parseSetting('day.running_late_minutes', 15)).toBe(15);
    expect(parseSetting('scheduling.slot_minutes', 15)).toBe(15);
    expect(parseSetting('reminders.day_before_time', '18:00')).toBe('18:00');
    expect(
      parseSetting('engagement.follow_ups_after_discharge', [{ count: 2, unit: 'week' }]),
    ).toEqual([{ count: 2, unit: 'week' }]);
  });

  it('reject values of the wrong shape', () => {
    expect(() => parseSetting('day.running_late_minutes', 0)).toThrow();
    expect(() => parseSetting('day.running_late_minutes', 1.5)).toThrow();
    expect(() => parseSetting('day.running_late_minutes', '15')).toThrow();
    expect(() => parseSetting('scheduling.slot_minutes', 0)).toThrow();
    expect(() => parseSetting('reminders.day_before_time', '24:00')).toThrow();
    expect(() => parseSetting('billing.consultation_fee_timing', 'at_booking')).toThrow();
    expect(() => parseSetting('engagement.follow_ups_after_discharge', [])).toThrow();
    expect(() =>
      parseSetting('engagement.follow_ups_after_discharge', [{ count: 2, unit: 'day' }]),
    ).toThrow();
    expect(() => parseSetting('packages.never_reschedulable_items', ['Zero Gravity'])).toThrow();
  });
});
