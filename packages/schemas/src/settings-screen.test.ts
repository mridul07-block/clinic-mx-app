import { describe, expect, it } from 'vitest';
import { settingKeys, type settingDefinitions } from './settings';
import {
  parseSettingField,
  settingDisplay,
  settingOrderPairs,
  settingTakesNegative,
  settingAreaLabels,
  settingChangedElsewhere,
  settingChoices,
  settingFieldText,
  settingInputKind,
  settingsByArea,
} from './settings-screen';

// ADM-02: the settings screen asks for every setting in a way its schema accepts.
describe('the settings screen', () => {
  it('lists every setting once, each area named', () => {
    const listed = settingsByArea().flatMap((area) => area.keys);
    expect([...listed].sort()).toEqual([...settingKeys].sort());
    for (const { area } of settingsByArea()) expect(settingAreaLabels[area], area).toBeDefined();
  });

  it('asks numbers, yes or no, choices, text or JSON, each round tripping', () => {
    expect(settingInputKind('day.running_late_minutes')).toBe('number');
    expect(settingInputKind('billing.session_price_items')).toBe('json');
    for (const key of settingKeys) {
      if (settingInputKind(key) === 'choice')
        expect(settingChoices(key).length, key).toBeGreaterThan(1);
    }
    // A valid value shown in its field parses back to itself, for every kind.
    const examples: Record<string, unknown> = {
      'day.running_late_minutes': 15,
      'billing.session_price_items': ['rehabilitation_session'],
    };
    for (const [key, value] of Object.entries(examples)) {
      const typedKey = key as keyof typeof settingDefinitions;
      expect(parseSettingField(typedKey, settingFieldText(typedKey, value), {})).toEqual({
        ok: true,
        value,
      });
    }
  });

  it('refuses what the schema refuses, in words', () => {
    expect(parseSettingField('day.running_late_minutes', 'soon', {})).toEqual({
      ok: false,
      error: 'Enter a number.',
    });
    expect(parseSettingField('day.running_late_minutes', '-5', {}).ok).toBe(false);
    expect(parseSettingField('billing.session_price_items', '[', {})).toMatchObject({ ok: false });
    expect(parseSettingField('billing.session_price_items', '[]', {})).toMatchObject({ ok: false });
  });

  it('keeps a minimum at or under its maximum', () => {
    expect(parseSettingField('ai.candidates_min', '30', { 'ai.candidates_max': 25 })).toEqual({
      ok: false,
      error: 'Must not be more than ai.candidates_max (25).',
    });
    expect(parseSettingField('ai.candidates_max', '10', { 'ai.candidates_min': 15 })).toMatchObject(
      {
        ok: false,
      },
    );
    expect(parseSettingField('ai.candidates_min', '15', { 'ai.candidates_max': 25 })).toEqual({
      ok: true,
      value: 15,
    });
  });

  it('leaves the settings with their own flow to it', () => {
    expect(settingChangedElsewhere('ai.preparation_sheet')?.href).toBe('/app/ai-preparation-sheet');
    expect(settingChangedElsewhere('launch.opening_entries_open')?.href).toBe(
      '/app/opening-entries',
    );
    expect(settingChangedElsewhere('ai.task_rank_diagnoses')).not.toBeNull();
    expect(settingChangedElsewhere('day.running_late_minutes')).toBeNull();
  });

  it('takes plain numbers only, and a minus where the setting may be negative', () => {
    expect(parseSettingField('day.running_late_minutes', '0x10', {}).ok).toBe(false);
    expect(parseSettingField('day.running_late_minutes', '1e1', {}).ok).toBe(false);
    expect(parseSettingField('kpi.target_nps', '-20', {})).toEqual({ ok: true, value: -20 });
    expect(settingTakesNegative('kpi.target_nps')).toBe(true);
    expect(settingTakesNegative('day.running_late_minutes')).toBe(false);
  });

  it('keeps named pairs in order too', () => {
    expect(settingOrderPairs).toContainEqual(['ai.candidates_min', 'ai.candidates_max']);
    expect(
      parseSettingField('assessment.irritability_low_below', '8', {
        'assessment.irritability_high_above': 5,
      }).ok,
    ).toBe(false);
    expect(
      parseSettingField('day.no_show_allowed_minutes', '10', { 'day.running_late_minutes': 15 }).ok,
    ).toBe(false);
  });

  it('keeps what other records or guarantees rely on out of reach', () => {
    for (const key of [
      'scheduling.slot_minutes',
      'billing.consultation_price_items',
      'packages.session_appointment_types',
      'ai.blocked_providers',
      'patients.adult_age_years',
    ]) {
      expect(settingChangedElsewhere(key), key).not.toBeNull();
    }
  });

  it('shows money in paise also in rupees', () => {
    expect(settingDisplay('ai.daily_spend_cap_paise', 50000)).toBe('50000 paise (₹500)');
  });
});
