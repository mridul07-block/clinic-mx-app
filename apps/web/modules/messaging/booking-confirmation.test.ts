import type { Db } from '@clinic-mx/db';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ClinicMessageError, sendBookingConfirmation } from './clinic-messages';

vi.mock('server-only', () => ({}));
const db = vi.hoisted(() => ({
  appointmentForConfirmation: vi.fn(),
  approvedTemplateVersion: vi.fn(),
  lastInboundAt: vi.fn(),
  messagePatient: vi.fn(),
  queueMessageOnce: vi.fn(),
}));
vi.mock('@clinic-mx/db', () => db);
vi.mock('../access/service', () => ({
  systemService:
    (definition: { run: (tx: unknown, input: unknown) => unknown }) =>
    (_db: unknown, input: unknown) =>
      definition.run('system-tx', input),
}));
vi.mock('../patient-links/services', () => ({}));
vi.mock('./reschedule-flow', () => ({}));
vi.mock('./booking-flow', () => ({
  flowDate: (date: string) => `day ${date}`,
}));

// WA-07: every booking gets the same confirmation; the template by who booked it, a plain reply
// within the window until Meta approves. Generated ids and names only.
const ids = {
  patient: '00000000-0000-4000-8000-000000000b01',
  appointment: '00000000-0000-4000-8000-000000000b02',
};
const sourceKey = `whatsapp.booking_confirmation:${ids.appointment}`;
const now = new Date('2026-11-02T06:00:00Z');
const visit = {
  patientId: ids.patient,
  number: 'MVH-00042',
  status: 'booked',
  channel: 'front_desk',
  startsAt: new Date('2026-11-03T04:30:00Z'),
  typeKey: 'consultation',
  physioName: 'Test Physio',
  consultationFeePaise: 100_000,
  centreName: 'HSR Layout',
  mapLink: 'https://maps.app.goo.gl/test',
  address: '1 Test Road',
  centrePhone: '+918000000001',
};
const send = () =>
  sendBookingConfirmation({} as Db, { sourceKey, appointmentId: ids.appointment, now });
const queued = () =>
  db.queueMessageOnce.mock.calls.map((call) => call[1] as Record<string, unknown>);

beforeEach(() => {
  for (const fn of Object.values(db)) fn.mockReset();
  db.appointmentForConfirmation.mockResolvedValue(visit);
  db.messagePatient.mockResolvedValue({
    id: ids.patient,
    name: 'Test Patient One',
    phone: '+919845012345',
  });
  db.approvedTemplateVersion.mockResolvedValue({
    metaName: 'front_desk_booking_confirmation_v2',
    version: 2,
  });
  db.lastInboundAt.mockResolvedValue(null);
  db.queueMessageOnce.mockResolvedValue('message-1');
});

describe('the booking confirmation', () => {
  it('queues the front desk template with everything the PRD lists, once', async () => {
    expect(await send()).toBe('queued');
    expect(db.approvedTemplateVersion).toHaveBeenCalledWith(
      'system-tx',
      'front_desk_booking_confirmation',
      'en',
      2,
    );
    expect(queued()).toEqual([
      {
        patientId: ids.patient,
        toPhone: '+919845012345',
        kind: 'template',
        templateKey: 'front_desk_booking_confirmation',
        templateVersion: 2,
        language: 'en',
        variables: {
          patient_name: 'Test',
          appointment_id: 'MVH-00042',
          date: 'day 2026-11-03',
          time: '10:00 AM',
          physio: 'Test Physio',
          clinic: 'HSR Layout',
          fee: '₹1,000, payable at the clinic',
          directions: 'https://maps.app.goo.gl/test',
          clinic_phone: '+91 80 0000 0001',
        },
        createdBy: 'system:whatsapp',
        patientLinkId: null,
        appointmentId: ids.appointment,
        sourceKey,
      },
    ]);
    db.queueMessageOnce.mockResolvedValue(null);
    expect(await send()).toBe('already_queued');
  });

  it('goes as the WhatsApp template for a WhatsApp booking, the fee as per the plan otherwise', async () => {
    db.appointmentForConfirmation.mockResolvedValue({
      ...visit,
      channel: 'whatsapp',
      typeKey: 'treatment_session',
    });
    await send();
    expect(queued()[0]).toMatchObject({
      templateKey: 'booking_confirmation',
      variables: { fee: 'as per your treatment plan' },
    });
  });

  it('goes as the same text in a plain reply within the window until Meta approves', async () => {
    db.approvedTemplateVersion.mockResolvedValue(null);
    db.lastInboundAt.mockResolvedValue(new Date('2026-11-02T05:00:00Z'));
    await send();
    expect(queued()[0]).toMatchObject({
      kind: 'session',
      templateKey: 'front_desk_booking_confirmation',
      templateVersion: 1,
      variables: {
        text: 'Hi Test, your appointment MVH-00042 is booked for day 2026-11-03 at 10:00 AM with Test Physio at Movementology HSR Layout. Fee: ₹1,000, payable at the clinic. Please arrive 10 minutes early and bring any reports you have. Directions: https://maps.app.goo.gl/test. For any change, call the front desk on +91 80 0000 0001 or reply to this message.',
      },
    });
  });

  it('stays the template outside the window, to be Not sent until approved', async () => {
    db.approvedTemplateVersion.mockResolvedValue(null);
    db.lastInboundAt.mockResolvedValue(new Date('2026-11-01T05:00:00Z'));
    await send();
    expect(queued()[0]).toMatchObject({ kind: 'template', templateVersion: 2 });
  });

  it.each(['cancelled', 'rescheduled', 'no_show', 'completed'])(
    'skips a %s appointment',
    async (status) => {
      db.appointmentForConfirmation.mockResolvedValue({ ...visit, status });
      expect(await send()).toBe('skipped:changed');
      expect(db.queueMessageOnce).not.toHaveBeenCalled();
    },
  );

  it('still confirms a walk in already checked in', async () => {
    db.appointmentForConfirmation.mockResolvedValue({
      ...visit,
      status: 'checked_in',
      channel: 'walk_in',
    });
    expect(await send()).toBe('queued');
  });

  it('fails visibly for a centre without a phone', async () => {
    db.appointmentForConfirmation.mockResolvedValue({ ...visit, centrePhone: null });
    await expect(send()).rejects.toThrow(ClinicMessageError);
    await expect(send()).rejects.toThrow('add it on the centre');
    expect(db.queueMessageOnce).not.toHaveBeenCalled();
  });

  it('gives the address for directions when the centre has no map link', async () => {
    db.appointmentForConfirmation.mockResolvedValue({ ...visit, mapLink: null });
    await send();
    expect(queued()[0]).toMatchObject({ variables: { directions: '1 Test Road' } });
  });

  it('skips an appointment that is gone', async () => {
    db.appointmentForConfirmation.mockResolvedValue(undefined);
    expect(await send()).toBe('skipped:no appointment');
  });
});
