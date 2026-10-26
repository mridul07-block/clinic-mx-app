import type { Settings } from '@clinic-mx/schemas';
import { describe, expect, it, vi } from 'vitest';
import { SettingsError, createSettingsReader, parseSettings } from './settings';

// Test values only; the real ones are in the settings migration.
const stored: Settings = {
  'scheduling.slot_minutes': 15,
  'patients.adult_age_years': 18,
  'booking.slot_hold_minutes': 5,
  'live.refresh_seconds': 3,
  'billing.consultation_price_items': ['consultation', 'senior_consultation'],
  'billing.session_price_items': ['rehabilitation_session', 'advanced_rehabilitation_session'],
  'billing.think_about_it_follow_up_days': 2,
  'billing.think_about_it_follow_up_time': '10:00',
  'screening.weight_loss_kg': 5,
  'screening.weight_loss_months': 6,
  'screening.morning_stiffness_minutes': 60,
  'assessment.irritability_high_above': 5,
  'assessment.irritability_low_below': 3,
  'assessment.acute_weeks_below': 3,
  'assessment.chronic_weeks_above': 12,
  'booking.plan_clash_alternatives': 3,
  'booking.self_booking_block_reschedules': 2,
  'booking.self_booking_block_no_shows': 2,
  'packages.reschedules_per_10_sessions': 1,
  'packages.never_reschedulable_items': ['zero_gravity_treadmill'],
  'packages.session_appointment_types': ['session', 'zero_gravity_treadmill'],
  'day.running_late_minutes': 15,
  'day.no_show_allowed_minutes': 25,
  'reports.max_file_mb': 4,
  'documents.summary_prints_category': false,
  'billing.consultation_fee_timing': 'after_consultation',
  'packages.validity_months': 3,
  'packages.expiry_reminder_days': 14,
  'packages.expiry_reminder_time': '10:00',
  'clinical.baseline_reuse_days': 7,
  'clinical.reassessment_session': 4,
  'clinical.review_weeks': 6,
  'scheduling.review_search_days': 7,
  'clinical.no_show_review_after': 2,
  'billing.unpaid_sessions_flag_above': 3,
  'engagement.follow_ups_after_discharge': [{ count: 2, unit: 'week' }],
  'security.desktop_idle_logout_minutes': 15,
  'security.phone_session_days': 30,
  'security.support_grant_max_hours': 24,
  'links.health_form_hours': 2,
  'links.consent_hours': 2,
  'links.questionnaire_days': 7,
  'links.feedback_days': 7,
  'links.my_plan_days': 30,
  'kiosk.idle_seconds': 120,
  'kiosk.thank_you_seconds': 10,
  'limits.sign_in_per_email': { count: 5, minutes: 15 },
  'limits.sign_in_per_network': { count: 30, minutes: 15 },
  'limits.reset_email_per_email': { count: 3, minutes: 60 },
  'limits.reset_email_per_network': { count: 20, minutes: 60 },
  'limits.two_step_per_person': { count: 5, minutes: 15 },
  'limits.bad_links_per_network': { count: 20, minutes: 10 },
  'limits.link_opens_per_network': { count: 120, minutes: 1 },
  'limits.webhook_failures_per_network': { count: 10, minutes: 1 },
  'reminders.day_before_time': '18:00',
};

const rows = (overrides: Record<string, unknown> = {}) =>
  Object.entries({ ...stored, ...overrides }).map(([key, value]) => ({ key, value }));

function readerWith(load = vi.fn(() => Promise.resolve(rows()))) {
  let clock = 0;
  const reader = createSettingsReader(load, { maxAgeSeconds: 60, now: () => clock });
  return {
    reader,
    load,
    advanceSeconds: (seconds: number) => {
      clock += seconds * 1000;
    },
  };
}

describe('parseSettings', () => {
  it('returns every setting with its value', () => {
    expect(parseSettings(rows())).toEqual(stored);
  });

  it('names every missing and malformed setting at once', () => {
    const broken = rows({ 'day.running_late_minutes': 'fifteen' }).filter(
      (row) => row.key !== 'clinical.review_weeks',
    );
    expect(() => parseSettings(broken)).toThrow(SettingsError);
    expect(() => parseSettings(broken)).toThrow(
      /day\.running_late_minutes is invalid.*clinical\.review_weeks is missing/,
    );
  });

  it('ignores rows the code no longer knows', () => {
    expect(parseSettings([...rows(), { key: 'old.retired_rule', value: 1 }])).toEqual(stored);
  });
});

describe('the settings reader', () => {
  it('reads a value', async () => {
    const { reader } = readerWith();
    expect(await reader.get('day.no_show_allowed_minutes')).toBe(25);
    expect(await reader.get('scheduling.slot_minutes')).toBe(15);
  });

  it('loads once for reads within the cache time, including reads that arrive together', async () => {
    const { reader, load, advanceSeconds } = readerWith();
    await Promise.all([
      reader.get('day.running_late_minutes'),
      reader.get('clinical.review_weeks'),
    ]);
    advanceSeconds(59);
    await reader.all();
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('loads again once the cache time has passed', async () => {
    const load = vi
      .fn()
      .mockResolvedValueOnce(rows())
      .mockResolvedValueOnce(rows({ 'day.running_late_minutes': 20 }));
    const { reader, advanceSeconds } = readerWith(load);
    expect(await reader.get('day.running_late_minutes')).toBe(15);
    advanceSeconds(60);
    expect(await reader.get('day.running_late_minutes')).toBe(20);
  });

  it('loads again after invalidate', async () => {
    const load = vi
      .fn()
      .mockResolvedValueOnce(rows())
      .mockResolvedValueOnce(rows({ 'day.running_late_minutes': 20 }));
    const { reader } = readerWith(load);
    await reader.get('day.running_late_minutes');
    reader.invalidate();
    expect(await reader.get('day.running_late_minutes')).toBe(20);
  });

  it('does not keep a failed load', async () => {
    const load = vi
      .fn()
      .mockRejectedValueOnce(new Error('connection reset'))
      .mockResolvedValueOnce(rows());
    const { reader } = readerWith(load);
    await expect(reader.get('day.running_late_minutes')).rejects.toThrow('connection reset');
    expect(await reader.get('day.running_late_minutes')).toBe(15);
  });

  it('refuses to answer from a table with a malformed value', async () => {
    const { reader } = readerWith(
      vi.fn(() => Promise.resolve(rows({ 'clinical.review_weeks': -1 }))),
    );
    await expect(reader.get('day.running_late_minutes')).rejects.toThrow(SettingsError);
  });
});
