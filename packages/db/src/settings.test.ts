import type { Settings } from '@clinic-mx/schemas';
import { describe, expect, it, vi } from 'vitest';
import { SettingsError, createSettingsReader, parseSettings } from './settings';

// Test values only; the real ones are in the settings migration.
const stored: Settings = {
  'scheduling.slot_minutes': 15,
  'patients.adult_age_years': 18,
  'intake.carry_over_months': 24,
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
  'ai.preparation_sheet': { on: false },
  'ai.candidates_min': 15,
  'ai.candidates_max': 25,
  'ai.must_rule_out_tiers': ['red_flag'],
  'ai.similar_cases_min': 3,
  'ai.similar_cases_max': 5,
  'feedback.first_treatment_check_days': 1,
  'feedback.first_treatment_check_time': '10:00',
  'feedback.session_check_number': 3,
  'feedback.review_request_days': 1,
  'feedback.review_request_time': '10:00',
  'ai.kb_report_dismissed_min_marked': 5,
  'ai.kb_report_dismissed_share_percent': 50,
  'ai.daily_spend_cap_paise': 20000,
  'ai.usd_rate_paise': 9650,
  'ai.sheet_top_count': 3,
  'ai.sheet_also_consider_count': 2,
  'ai.sheet_retry_after_seconds': 60,
  'ai.blocked_providers': ['deepseek'],
  'whatsapp.test_recipients_only': true,
  'whatsapp.test_recipients': [],
  'whatsapp.event_retention_days': 7,
  'whatsapp.emergency_phrases': ['chest pain'],
  'whatsapp.front_desk_email': '',
  'ai.blind_test_budget_paise': 200000,
  'ai.blind_test_cases_min': 30,
  'ai.blind_test_cases_max': 50,
  'ai.task_rank_diagnoses': {
    model: null,
    providers: [],
    promptVersion: 'rank_diagnoses.v2',
    reasoningEffort: 'low',
    timeoutMs: 6000,
    maxTokens: 800,
  },
  'ai.task_recheck_with_findings': {
    model: null,
    providers: [],
    promptVersion: 'recheck_with_findings.v2',
    reasoningEffort: 'low',
    timeoutMs: 6000,
    maxTokens: 800,
  },
  'billing.consultation_fee_timing': 'after_consultation',
  'packages.validity_months': 3,
  'packages.expiry_reminder_days': 14,
  'packages.expiry_reminder_time': '10:00',
  'clinical.baseline_reuse_days': 7,
  'clinical.reassessment_session': 4,
  'clinical.review_weeks': 6,
  'scheduling.review_search_days': 7,
  'clinical.no_show_review_after': 2,
  'clinical.lost_to_follow_up_days': 30,
  'clinical.acceptable_exercise_pain': 5,
  'launch.opening_entries_open': true,
  'kpi.target_red_flag_documentation_percent': 100,
  'kpi.target_conversion_percent': 75,
  'kpi.target_completion_percent': 80,
  'kpi.target_meaningful_change_percent': 85,
  'kpi.target_return_to_sport_percent': 85,
  'kpi.target_reinjury_percent': 15,
  'kpi.target_satisfaction_score': 4.5,
  'feedback.recovery_score_max': 6,
  'feedback.escalate_hours': 24,
  'kpi.target_nps': 60,
  'kpi.target_notes_same_day_percent': 95,
  'kpi.target_booking_flow_percent': 80,
  'kpi.target_health_form_percent': 90,
  'kpi.target_session_note_minutes': 3,
  'kpi.max_range_days': 366,
  'dashboard.busy_hours_days': 28,
  'dashboard.channel_days': 30,
  'kpi.min_outcome_episodes': 3,
  'billing.unpaid_sessions_flag_above': 3,
  'engagement.follow_ups_after_discharge': [{ count: 2, unit: 'week' }],
  'engagement.follow_up_time': '10:00',
  'links.follow_up_days': 7,
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
  'privacy.request_response_days': 30,
  'audit.download_max_days': 31,
  'audit.download_max_events': 5000,
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
