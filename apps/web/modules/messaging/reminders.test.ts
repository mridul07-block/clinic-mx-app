import type { Db } from '@clinic-mx/db';
import { istInstant } from '@clinic-mx/schemas';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { sendDayBeforeReminders, sendMorningReminders } from './clinic-messages';
import { runDayBeforeReminders, runMorningReminders } from './reminders';

vi.mock('server-only', () => ({}));
const db = vi.hoisted(() => ({
  DAY_BEFORE_REMINDERS_JOB: 'whatsapp.day_before_reminders',
  MORNING_REMINDERS_JOB: 'whatsapp.morning_reminders',
  messagePatient: vi.fn(),
  messageQueuedFor: vi.fn(),
  queueMessageOnce: vi.fn(),
  queueNextReminders: vi.fn(),
  remindableAppointments: vi.fn(),
}));
vi.mock('@clinic-mx/db', () => db);
vi.mock('../access/service', () => ({
  systemService:
    (definition: { run: (tx: unknown, input: unknown) => unknown }) =>
    (_db: unknown, input: unknown) =>
      definition.run('system-tx', input),
}));
vi.mock('../patient-links/services', () => ({}));
vi.mock('./booking-flow', () => ({ flowDate: (date: string) => `day ${date}` }));
const flow = vi.hoisted(() => ({ rescheduleFlowToken: vi.fn() }));
vi.mock('./reschedule-flow', () => flow);
const settings = vi.hoisted(() => {
  const values: Record<string, string> = {
    'reminders.day_before_time': '18:00',
    'reminders.morning_time': '08:00',
  };
  return { values };
});
vi.mock('../settings/settings', () => ({
  getSetting: (key: string) => Promise.resolve(settings.values[key]),
}));

// WA-08 done when: the day before reminder with Confirm and Reschedule; 8 AM to every patient.
// Generated ids and names only.
const date = '2026-11-03';
const visit = (id: string, minutes: number) => ({
  id,
  patientId: ['patient', id].join('-'),
  phone: '+919845012345',
  startsAt: istInstant(date, minutes),
  centreName: 'HSR Layout',
  physioName: 'Test Physio',
  typeName: 'Session',
});
const queued = () =>
  db.queueMessageOnce.mock.calls.map((call) => call[1] as Record<string, unknown>);
const evening = istInstant('2026-11-02', 18 * 60);

beforeEach(() => {
  for (const fn of [...Object.values(db), ...Object.values(flow)]) {
    if (typeof fn === 'function') fn.mockReset();
  }
  db.messagePatient.mockImplementation((_tx: unknown, id: string) =>
    Promise.resolve({ id, name: 'Test Patient', phone: '+919845012345' }),
  );
  db.messageQueuedFor.mockResolvedValue(false);
  db.queueMessageOnce.mockResolvedValue('message-1');
  db.remindableAppointments.mockResolvedValue([visit('a1', 10 * 60), visit('a2', 11 * 60)]);
  flow.rescheduleFlowToken.mockImplementation((_tx: unknown, v: { id: string }) =>
    Promise.resolve(['session', v.id].join('-')),
  );
});

describe('the day before reminders', () => {
  it('queue one reminder per appointment, with its appointment and a reschedule session', async () => {
    expect(await sendDayBeforeReminders({} as Db, { date, now: evening })).toBe(2);
    expect(db.remindableAppointments).toHaveBeenCalledWith('system-tx', date, evening);
    expect(queued()).toEqual([
      expect.objectContaining({
        templateKey: 'day_before_reminder',
        kind: 'template',
        patientId: 'patient-a1',
        appointmentId: 'a1',
        sourceKey: 'whatsapp.day_before_reminder:a1',
        variables: {
          patient_name: 'Test',
          date: `day ${date}`,
          time: '10:00 AM',
          clinic: 'HSR Layout',
          physio: 'Test Physio',
          flow_token: 'session-a1',
        },
      }),
      expect.objectContaining({
        appointmentId: 'a2',
        variables: expect.objectContaining({ flow_token: 'session-a2' }) as unknown,
      }),
    ]);
    expect(flow.rescheduleFlowToken).toHaveBeenCalledWith(
      'system-tx',
      expect.objectContaining({ id: 'a1', phone: '+919845012345' }),
      evening,
    );
  });

  it('queue nothing twice, and make no session for one queued already', async () => {
    db.messageQueuedFor.mockImplementation((_tx: unknown, key: string) =>
      Promise.resolve(key.endsWith(':a1')),
    );
    expect(await sendDayBeforeReminders({} as Db, { date, now: evening })).toBe(1);
    expect(flow.rescheduleFlowToken).toHaveBeenCalledTimes(1);
    expect(queued().map((m) => m.appointmentId)).toEqual(['a2']);
  });

  it('send nothing once the appointments’ day has begun: the morning reminder covers it', async () => {
    expect(await sendDayBeforeReminders({} as Db, { date, now: istInstant(date, 5) })).toBe(0);
    expect(db.remindableAppointments).not.toHaveBeenCalled();
  });

  it('queue the next evening first, at the setting’s time, then the reminders', async () => {
    settings.values['reminders.day_before_time'] = '17:30';
    await runDayBeforeReminders({} as Db, { date });
    expect(db.queueNextReminders).toHaveBeenCalledWith(
      'system-tx',
      'whatsapp.day_before_reminders',
      date,
      '17:30',
    );
    expect(db.queueNextReminders.mock.invocationCallOrder[0]).toBeLessThan(
      db.remindableAppointments.mock.invocationCallOrder[0] ?? 0,
    );
    settings.values['reminders.day_before_time'] = '18:00';
  });
});

describe('the reminders on the day', () => {
  it('queue one per appointment not yet started, to every patient, with no buttons to fill', async () => {
    const morning = istInstant(date, 8 * 60);
    expect(await sendMorningReminders({} as Db, { date, now: morning })).toBe(2);
    expect(db.remindableAppointments).toHaveBeenCalledWith('system-tx', date, morning);
    expect(queued()[0]).toMatchObject({
      templateKey: 'morning_reminder',
      appointmentId: 'a1',
      sourceKey: 'whatsapp.morning_reminder:a1',
      variables: { patient_name: 'Test', time: '10:00 AM', clinic: 'HSR Layout' },
    });
    expect(flow.rescheduleFlowToken).not.toHaveBeenCalled();
    // A run again queues nothing more.
    db.queueMessageOnce.mockResolvedValue(null);
    expect(await sendMorningReminders({} as Db, { date, now: morning })).toBe(0);
  });

  it('queue the next morning first', async () => {
    await runMorningReminders({} as Db, { date });
    expect(db.queueNextReminders).toHaveBeenCalledWith(
      'system-tx',
      'whatsapp.morning_reminders',
      date,
      '08:00',
    );
  });
});
