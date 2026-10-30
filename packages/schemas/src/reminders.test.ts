import { describe, expect, it } from 'vitest';
import { istInstant } from './ist';
import {
  APPOINTMENT_CHANGED_TEXT,
  appointmentConfirmedText,
  dayBeforeRunDue,
  nextDayBeforeRun,
  nextMorningRun,
} from './reminders';

// WA-08: the day before reminder runs the evening before the appointments' date, the morning
// reminder on the day; each run queues the next at the setting's time.
describe('the reminders’ daily runs', () => {
  it('queue the day before run for the day after the next evening', () => {
    // The run for 2 Nov at 6 PM on 1 Nov queues the run for 3 Nov at 6 PM on 2 Nov.
    expect(nextDayBeforeRun(istInstant('2026-11-01', 18 * 60), '2026-11-02', '18:00')).toEqual({
      date: '2026-11-03',
      runAt: istInstant('2026-11-02', 18 * 60),
    });
    // At a changed time, from the next evening.
    expect(
      nextDayBeforeRun(istInstant('2026-11-01', 18 * 60 + 1), '2026-11-02', '17:30').runAt,
    ).toEqual(istInstant('2026-11-02', 17 * 60 + 30));
  });

  it('catch up to the next evening after downtime, never every missed day', () => {
    expect(nextDayBeforeRun(istInstant('2026-11-05', 12 * 60), '2026-11-02', '18:00')).toEqual({
      date: '2026-11-06',
      runAt: istInstant('2026-11-05', 18 * 60),
    });
  });

  it('queue the morning run for the next morning', () => {
    expect(nextMorningRun(istInstant('2026-11-02', 8 * 60), '2026-11-02', '08:00')).toEqual({
      date: '2026-11-03',
      runAt: istInstant('2026-11-03', 8 * 60),
    });
  });

  it('send the day before reminders only before the day begins', () => {
    expect(dayBeforeRunDue(istInstant('2026-11-01', 23 * 60 + 59), '2026-11-02')).toBe(true);
    expect(dayBeforeRunDue(istInstant('2026-11-02', 0), '2026-11-02')).toBe(false);
  });

  it('thank the patient for confirming, with the day and time', () => {
    expect(appointmentConfirmedText({ date: 'Tue, 3 Nov', time: '10:00 AM' })).toBe(
      'Thank you, your appointment on Tue, 3 Nov at 10:00 AM is confirmed.',
    );
    expect(APPOINTMENT_CHANGED_TEXT).toBe(
      'This appointment has changed, so it cannot be confirmed here.',
    );
  });
});
