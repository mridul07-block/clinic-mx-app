import type { Db } from '@clinic-mx/db';
import { istInstant } from '@clinic-mx/schemas';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { runReviewBooking } from './review-booking';

const fakeTx = {
  kind: 'transaction',
  transaction: (work: (sp: unknown) => unknown) => work(fakeTx),
};
const db = vi.hoisted(() => ({
  SlotRefusedError: class SlotRefusedError extends Error {},
  systemActor: vi.fn((component: string) => `system:${component}`),
  withActor: vi.fn(),
  addReviewBookingTask: vi.fn(),
  appointmentTypeIdByKey: vi.fn(),
  bookAppointment: vi.fn(),
  freeSlots: vi.fn(),
  reviewBookingFacts: vi.fn(),
}));
vi.mock('@clinic-mx/db', () => db);
// Test values only; the real ones are the settings rows.
const settings: Record<string, unknown> = {
  'scheduling.slot_minutes': 15,
  'scheduling.review_search_days': 3,
};
vi.mock('../settings/settings', () => ({
  getSetting: vi.fn((key: string) => Promise.resolve(settings[key])),
}));

const hsr = '00000000-0000-4000-8000-000000000101';
const consultantId = '00000000-0000-4000-8000-000000000207';
const patientId = '00000000-0000-4000-8000-000000000301';
const episodeId = '00000000-0000-4000-8000-000000000501';
const now = new Date('2026-10-26T06:00:00Z');
const facts = (extra: Record<string, unknown> = {}) => ({
  status: 'active',
  centreId: hsr,
  patientId,
  reviewDate: '2026-12-05',
  consultant: { id: consultantId, name: 'Dr Test Consultant' },
  booked: false,
  ...extra,
});
const slot = (date: string, minutes: number) => ({
  startsAt: istInstant(date, minutes),
  endsAt: istInstant(date, minutes + 45),
  machineUnit: null,
});
const run = () => runReviewBooking({} as Db, { episodeId }, now);

// OUT-06 done when: the 6 week Review is booked automatically with the plan, with the consultant.
// Decisions (user, 26 October 2026): once the episode is Active; with the consultant who signed,
// on the plan's review date at their first free time, else the next days within the setting, else
// a task for the front desk.
describe('the automatic 6 week review', () => {
  beforeEach(() => {
    for (const fn of Object.values(db)) if ('mockReset' in fn) fn.mockReset();
    db.systemActor.mockImplementation((component: string) => `system:${component}`);
    db.withActor.mockImplementation((_db: Db, _actor: string, work: (tx: unknown) => unknown) =>
      work(fakeTx),
    );
    db.reviewBookingFacts.mockResolvedValue(facts());
    db.appointmentTypeIdByKey.mockResolvedValue('review-type');
    db.bookAppointment.mockResolvedValue({ id: 'review-1', number: 'HSR-00012' });
  });

  it('books the consultant’s first free time on the review date, as the scheduling system', async () => {
    db.freeSlots.mockResolvedValue([
      { physioId: consultantId, slots: [slot('2026-12-05', 600), slot('2026-12-05', 660)] },
    ]);
    await expect(run()).resolves.toEqual({
      status: 'booked',
      appointmentId: 'review-1',
      startsAt: istInstant('2026-12-05', 600),
    });
    expect(db.withActor).toHaveBeenCalledWith({}, 'system:scheduling', expect.any(Function));
    expect(db.freeSlots).toHaveBeenCalledWith(fakeTx, {
      centreId: hsr,
      appointmentTypeId: 'review-type',
      date: '2026-12-05',
      physioId: consultantId,
      holder: `review:${episodeId}`,
      step: 15,
      now,
    });
    expect(db.bookAppointment).toHaveBeenCalledWith(fakeTx, {
      centreId: hsr,
      physioId: consultantId,
      appointmentTypeId: 'review-type',
      startsAt: istInstant('2026-12-05', 600),
      holder: `review:${episodeId}`,
      patientId,
      episodeId,
      channel: 'automatic',
      step: 15,
      now,
    });
    expect(db.addReviewBookingTask).not.toHaveBeenCalled();
  });

  it('moves to the next day when the consultant is off, and past a start taken meanwhile', async () => {
    db.freeSlots
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { physioId: consultantId, slots: [slot('2026-12-06', 540), slot('2026-12-06', 600)] },
      ]);
    db.bookAppointment.mockRejectedValueOnce(new db.SlotRefusedError('taken'));
    const result = await run();
    expect(result).toMatchObject({ status: 'booked', startsAt: istInstant('2026-12-06', 600) });
    expect(
      db.freeSlots.mock.calls.map(([, request]) => (request as { date: string }).date),
    ).toEqual(['2026-12-05', '2026-12-06']);
  });

  it('gives the front desk a task when nothing is free within the setting’s days', async () => {
    db.freeSlots.mockResolvedValue([]);
    await expect(run()).resolves.toEqual({ status: 'task' });
    expect(db.freeSlots).toHaveBeenCalledTimes(3);
    expect(db.addReviewBookingTask).toHaveBeenCalledWith(fakeTx, {
      episodeId,
      centreId: hsr,
      patientId,
      reviewDate: '2026-12-05',
      searchedTo: '2026-12-07',
      consultant: 'Dr Test Consultant',
    });
    expect(db.bookAppointment).not.toHaveBeenCalled();
  });

  it('starts from today when the review date has passed', async () => {
    db.reviewBookingFacts.mockResolvedValue(facts({ reviewDate: '2026-10-01' }));
    db.freeSlots.mockResolvedValue([
      // 11:00 AM IST today has passed at 11:30 AM IST; noon has not.
      { physioId: consultantId, slots: [slot('2026-10-26', 660), slot('2026-10-26', 720)] },
    ]);
    await expect(run()).resolves.toMatchObject({ startsAt: istInstant('2026-10-26', 720) });
  });

  it('books nothing when not Active, already booked, or without a signed plan', async () => {
    for (const extra of [
      { status: 'under_review' },
      { booked: true },
      { reviewDate: null },
      { consultant: null },
    ]) {
      db.reviewBookingFacts.mockResolvedValueOnce(facts(extra));
      await expect(run()).resolves.toMatchObject({ status: 'skipped' });
    }
    db.reviewBookingFacts.mockResolvedValueOnce(undefined);
    await expect(run()).resolves.toMatchObject({ status: 'skipped' });
    expect(db.freeSlots).not.toHaveBeenCalled();
    expect(db.bookAppointment).not.toHaveBeenCalled();
    expect(db.addReviewBookingTask).not.toHaveBeenCalled();
  });
});
