import type { Db, StaffMember } from '@clinic-mx/db';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NotAllowedError } from '../access/guard';
import { SchedulingError } from '../scheduling/services';
import {
  ReportError,
  addReports,
  checkIn,
  fillInWithPatient,
  openFormOnTablet,
  showHealthForm,
  undoCheckIn,
  walkIn,
} from './services';
import { loadToday } from './today';

const fakeTx = { kind: 'transaction' };
const db = vi.hoisted(() => ({
  withStaffAccess: vi.fn(),
  appointmentRecord: vi.fn(),
  checkIn: vi.fn(),
  undoCheckIn: vi.fn(),
  todayBoard: vi.fn(),
  sessionProgress: vi.fn(() => Promise.resolve(new Map())),
  contentVersion: vi.fn(() => 'v1'),
  checkInView: vi.fn(),
  healthFormLink: vi.fn(),
  findKioskDevice: vi.fn(),
  sendLinkToKiosk: vi.fn(),
  insertPatientReport: vi.fn(),
  markIntakeAssisted: vi.fn(),
  patientRecord: vi.fn(),
  bookAppointment: vi.fn(),
}));
vi.mock('@clinic-mx/db', () => db);
const links = vi.hoisted(() => ({ issuePatientLink: vi.fn(), patientLinkPath: vi.fn() }));
vi.mock('../patient-links/services', () => links);
const store = vi.hoisted(() => ({ put: vi.fn(), remove: vi.fn() }));
vi.mock('./report-store', () => ({ reportStore: () => store }));
// Test value only; the real one is the `reports.max_file_mb` row.
vi.mock('../settings/settings', () => ({ getSetting: vi.fn(() => Promise.resolve(1)) }));
vi.mock('../access/staff-db', () => ({
  asStaff: (_actor: unknown, work: (tx: unknown) => unknown): unknown =>
    db.withStaffAccess({}, {}, work) as unknown,
}));

const hsr = '00000000-0000-4000-8000-000000000101';
const koramangala = '00000000-0000-4000-8000-000000000102';
const deskId = '00000000-0000-4000-8000-000000000204';
const appointmentId = '00000000-0000-4000-8000-000000000801';
const member = (extra: Partial<StaffMember> = {}): StaffMember => ({
  id: deskId,
  email: 'frontdesk@clinicmx.test',
  name: 'Test Front Desk',
  role: 'front_desk',
  treatsPatients: false,
  consultant: false,
  centreIds: [hsr],
  support: false,
  ...extra,
});
const context = (actor = member()) => ({ db: {} as Db, actor });
// 10:00 IST on 2 November 2026.
const booked = {
  id: appointmentId,
  centreId: hsr,
  startsAt: new Date('2026-11-02T04:30:00.000Z'),
  status: 'booked',
};
const refusedFor = [
  member({ role: 'physiotherapist', treatsPatients: true }),
  member({ role: 'finance', centreIds: [] }),
  member({ centreIds: [koramangala] }),
];

// INT-01: the front desk checks a patient in on the appointment's day at its centre, and undoes a
// check in made by mistake on that day; the board is for those who check in.
describe('front desk today', () => {
  beforeEach(() => {
    for (const fn of [...Object.values(db), ...Object.values(links), ...Object.values(store)]) {
      if ('mockReset' in fn) fn.mockReset();
    }
    db.withStaffAccess.mockImplementation(
      (_db: Db, _context: unknown, work: (tx: unknown) => unknown) => work(fakeTx),
    );
    db.contentVersion.mockReturnValue('v1');
    vi.useFakeTimers({ now: new Date('2026-11-02T03:00:00.000Z'), toFake: ['Date'] });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('checks a booked or confirmed patient in on the day', async () => {
    db.appointmentRecord.mockResolvedValue(booked);
    db.checkIn.mockResolvedValue({ id: appointmentId });
    await expect(checkIn(context(), { appointmentId })).rejects.toThrow(
      'Tick that you have checked who this is.',
    );
    await checkIn(context(), { appointmentId, identityChecked: true });
    expect(db.checkIn).toHaveBeenCalledWith(fakeTx, {
      appointmentId,
      by: deskId,
      now: new Date('2026-11-02T03:00:00.000Z'),
    });

    db.appointmentRecord.mockResolvedValue({ ...booked, status: 'no_show' });
    await expect(checkIn(context(), { appointmentId, identityChecked: true })).rejects.toThrow(
      'Only a booked or confirmed appointment is checked in.',
    );
    db.appointmentRecord.mockResolvedValue(booked);
    // 00:00 IST on 3 November.
    vi.setSystemTime(new Date('2026-11-02T18:30:00.000Z'));
    await expect(checkIn(context(), { appointmentId, identityChecked: true })).rejects.toThrow(
      SchedulingError,
    );
    expect(db.checkIn).toHaveBeenCalledTimes(1);
  });

  it('checks in for those who check in at the centre only', async () => {
    db.appointmentRecord.mockResolvedValue(booked);
    for (const actor of refusedFor) {
      await expect(
        checkIn(context(actor), { appointmentId, identityChecked: true }),
      ).rejects.toThrow(NotAllowedError);
    }
    expect(db.checkIn).not.toHaveBeenCalled();
  });

  it('undoes a check in on the day only', async () => {
    db.appointmentRecord.mockResolvedValue({ ...booked, status: 'checked_in' });
    db.undoCheckIn.mockResolvedValue({ id: appointmentId });
    await undoCheckIn(context(member({ role: 'centre_manager' })), { appointmentId });
    expect(db.undoCheckIn).toHaveBeenCalledWith(fakeTx, expect.objectContaining({ appointmentId }));
    vi.setSystemTime(new Date('2026-11-02T18:30:00.000Z'));
    await expect(undoCheckIn(context(), { appointmentId })).rejects.toThrow(
      'A check in can only be undone on the appointment’s day.',
    );
    db.appointmentRecord.mockResolvedValue(booked);
    await expect(undoCheckIn(context(), { appointmentId })).rejects.toThrow(
      'This appointment is not checked in.',
    );
    expect(db.undoCheckIn).toHaveBeenCalledTimes(1);
  });

  it('loads the board for those who check in at the centre', async () => {
    db.sessionProgress.mockResolvedValue(new Map());
    db.todayBoard.mockResolvedValue([]);
    expect(await loadToday(member(), { centreId: hsr, date: '2026-11-02' })).toEqual({
      appointments: [],
      version: 'v1',
    });
    expect(db.todayBoard).toHaveBeenCalledWith(fakeTx, { centreId: hsr, date: '2026-11-02' });
    for (const actor of refusedFor) {
      await expect(loadToday(actor, { centreId: hsr, date: '2026-11-02' })).rejects.toThrow(
        NotAllowedError,
      );
    }
  });

  // INT-02: the drawer's health form (first visits only), the tablet, and reports.
  // INT-12: a walk in is booked as its own channel and checked in, in one transaction, after the
  // identity tick, today only, by those who both book and check in at the centre.
  describe('walk in', () => {
    const slot = {
      centreId: hsr,
      physioId: '00000000-0000-4000-8000-000000000301',
      appointmentTypeId: '00000000-0000-4000-8000-000000000401',
      startsAt: '2026-11-02T04:30:00.000Z',
      patientId: '00000000-0000-4000-8000-000000000501',
    };

    it('books as a walk in and checks in, in one transaction, after the tick', async () => {
      db.patientRecord.mockResolvedValue({ id: slot.patientId });
      db.bookAppointment.mockResolvedValue({ id: appointmentId, number: 'MVH-00001' });
      db.checkIn.mockResolvedValue({ id: appointmentId });
      await expect(walkIn(context(), slot)).rejects.toThrow(
        'Tick that you have checked who this is.',
      );
      expect(db.bookAppointment).not.toHaveBeenCalled();

      expect(await walkIn(context(), { ...slot, identityChecked: true })).toEqual({
        id: appointmentId,
        number: 'MVH-00001',
      });
      expect(db.withStaffAccess).toHaveBeenCalledTimes(1);
      expect(db.bookAppointment).toHaveBeenCalledWith(
        fakeTx,
        expect.objectContaining({
          channel: 'walk_in',
          bookedBy: deskId,
          holder: `staff:${deskId}`,
          startsAt: new Date(slot.startsAt),
        }),
      );
      expect(db.checkIn).toHaveBeenCalledWith(fakeTx, {
        appointmentId,
        by: deskId,
        now: new Date('2026-11-02T03:00:00.000Z'),
      });
    });

    it('is for today only, by those who book and check in at the centre', async () => {
      db.patientRecord.mockResolvedValue({ id: slot.patientId });
      await expect(
        walkIn(context(), {
          ...slot,
          startsAt: '2026-11-03T04:30:00.000Z',
          identityChecked: true,
        }),
      ).rejects.toThrow('A walk in is booked for today.');
      for (const actor of refusedFor) {
        await expect(walkIn(context(actor), { ...slot, identityChecked: true })).rejects.toThrow(
          NotAllowedError,
        );
      }
      expect(db.bookAppointment).not.toHaveBeenCalled();
      expect(db.checkIn).not.toHaveBeenCalled();
    });
  });

  describe('check in drawer', () => {
    const view = { ...booked, status: 'checked_in', episodeId: null, patientId: 'patient' };
    const waiting = {
      id: 'link',
      expiresAt: new Date('2026-11-02T05:00:00.000Z'),
      revokedAt: null,
      completedAt: null,
    };

    it('shows the waiting health form link, or issues one, for a checked in first visit', async () => {
      db.appointmentRecord.mockResolvedValue(booked);
      db.checkInView.mockResolvedValue(view);
      db.healthFormLink.mockResolvedValue(waiting);
      links.patientLinkPath.mockReturnValue('/p/waiting');
      expect(await showHealthForm(context(), { appointmentId })).toMatchObject({
        linkId: 'link',
        path: '/p/waiting',
      });
      expect(links.issuePatientLink).not.toHaveBeenCalled();

      db.healthFormLink.mockResolvedValue({
        ...waiting,
        expiresAt: new Date('2026-11-02T02:00:00.000Z'),
      });
      links.issuePatientLink.mockResolvedValue({
        linkId: 'new',
        path: '/p/new',
        expiresAt: new Date(),
      });
      expect(await showHealthForm(context(), { appointmentId })).toMatchObject({ path: '/p/new' });
      expect(links.issuePatientLink).toHaveBeenCalledWith(fakeTx, {
        patientId: 'patient',
        purpose: 'health_form',
        appointmentId,
      });

      db.healthFormLink.mockResolvedValue({ ...waiting, completedAt: new Date() });
      await expect(showHealthForm(context(), { appointmentId })).rejects.toThrow(
        'The health form for this visit has been sent already.',
      );
      // Another visit's episode: no form here (a form of its own, submitted, is "sent already").
      db.healthFormLink.mockResolvedValue(waiting);
      db.checkInView.mockResolvedValue({ ...view, episodeId: 'episode' });
      await expect(showHealthForm(context(), { appointmentId })).rejects.toThrow(
        'No health form for this visit: it is part of an open episode.',
      );
      db.checkInView.mockResolvedValue({ ...view, status: 'booked' });
      await expect(showHealthForm(context(), { appointmentId })).rejects.toThrow(
        'Check the patient in first.',
      );
    });

    it('opens the form on a working tablet at the appointment’s centre only', async () => {
      const kioskId = '00000000-0000-4000-8000-000000000901';
      db.appointmentRecord.mockResolvedValue(booked);
      db.checkInView.mockResolvedValue(view);
      db.healthFormLink.mockResolvedValue(waiting);
      links.patientLinkPath.mockReturnValue('/p/waiting');
      db.findKioskDevice.mockResolvedValue({
        id: kioskId,
        centreId: hsr,
        name: 'Front desk tablet',
        stoppedAt: null,
      });
      db.sendLinkToKiosk.mockResolvedValue(true);
      expect(await openFormOnTablet(context(), { appointmentId, kioskId })).toEqual({
        tabletName: 'Front desk tablet',
      });
      expect(db.sendLinkToKiosk).toHaveBeenCalledWith(fakeTx, kioskId, 'link');
      db.findKioskDevice.mockResolvedValue({
        id: kioskId,
        centreId: koramangala,
        name: 'Other',
        stoppedAt: null,
      });
      await expect(openFormOnTablet(context(), { appointmentId, kioskId })).rejects.toThrow(
        'That tablet is not at this centre.',
      );
      expect(db.sendLinkToKiosk).toHaveBeenCalledTimes(1);
    });

    // INT-09: the helper is recorded on the visit's form, which then opens on this device.
    it('records the staff member helping with the form, and gives its page', async () => {
      db.appointmentRecord.mockResolvedValue(booked);
      db.checkInView.mockResolvedValue(view);
      db.healthFormLink.mockResolvedValue(waiting);
      links.patientLinkPath.mockReturnValue('/p/waiting');
      db.markIntakeAssisted.mockResolvedValue(true);
      expect(await fillInWithPatient(context(), { appointmentId })).toEqual({ path: '/p/waiting' });
      expect(db.markIntakeAssisted).toHaveBeenCalledWith(fakeTx, {
        appointmentId,
        patientLinkId: 'link',
        formVersion: 'hf-3',
      });
      db.markIntakeAssisted.mockResolvedValueOnce(false);
      await expect(fillInWithPatient(context(), { appointmentId })).rejects.toThrow(
        'The form could not be marked as helped. Reload and try again.',
      );

      db.markIntakeAssisted.mockClear();
      db.healthFormLink.mockResolvedValue({ ...waiting, completedAt: new Date() });
      await expect(fillInWithPatient(context(), { appointmentId })).rejects.toThrow(
        'The health form for this visit has been sent already.',
      );
      db.healthFormLink.mockResolvedValue(waiting);
      db.checkInView.mockResolvedValue({ ...view, status: 'booked' });
      await expect(fillInWithPatient(context(), { appointmentId })).rejects.toThrow(
        'Check the patient in first.',
      );
      db.checkInView.mockResolvedValue({ ...view, episodeId: 'episode' });
      await expect(fillInWithPatient(context(), { appointmentId })).rejects.toThrow(
        'No health form for this visit: it is part of an open episode.',
      );
      db.checkInView.mockResolvedValue(view);
      db.appointmentRecord.mockResolvedValue({ ...booked, centreId: koramangala });
      await expect(fillInWithPatient(context(), { appointmentId })).rejects.toThrow(
        NotAllowedError,
      );
      db.appointmentRecord.mockResolvedValue(booked);
      await expect(
        fillInWithPatient(context(member({ role: 'physiotherapist', treatsPatients: true })), {
          appointmentId,
        }),
      ).rejects.toThrow(NotAllowedError);
      expect(db.markIntakeAssisted).not.toHaveBeenCalled();
    });

    const png = (bytes = 64) =>
      new File(
        [new Uint8Array([0x89, 0x50, 0x4e, 0x47, ...new Array<number>(bytes).fill(0)])],
        'scan.png',
        {
          type: 'image/png',
        },
      );

    it('stores reports, then records them, for those who check in', async () => {
      db.appointmentRecord.mockResolvedValue(booked);
      db.checkInView.mockResolvedValue(view);
      db.insertPatientReport.mockResolvedValue({ id: 'r' });
      expect(await addReports(context(), { appointmentId, files: [png(), png()] })).toBe(2);
      expect(store.put).toHaveBeenCalledTimes(2);
      expect(store.put.mock.calls[0]?.[0]).toMatch(/^patient\/[0-9a-f-]{36}\.png$/);
      expect(db.insertPatientReport).toHaveBeenCalledWith(
        fakeTx,
        expect.objectContaining({ patientId: 'patient', appointmentId, uploadedBy: deskId }),
      );
      await expect(
        addReports(context(member({ role: 'physiotherapist', treatsPatients: true })), {
          appointmentId,
          files: [png()],
        }),
      ).rejects.toThrow(NotAllowedError);
    });

    it('refuses other files and files over the limit, and removes what it stored on a failure', async () => {
      db.appointmentRecord.mockResolvedValue(booked);
      db.checkInView.mockResolvedValue(view);
      const named = (name: string, type: string, bytes: number[]) =>
        new File([new Uint8Array(bytes)], name, { type });
      await expect(
        addReports(context(), { appointmentId, files: [named('a.txt', 'text/plain', [1])] }),
      ).rejects.toThrow('a.txt is not a photo or PDF.');
      await expect(
        addReports(context(), {
          appointmentId,
          files: [named('b.png', 'image/png', [1, 2, 3, 4])],
        }),
      ).rejects.toThrow(ReportError);
      await expect(
        addReports(context(), { appointmentId, files: [png(1024 * 1024)] }),
      ).rejects.toThrow('scan.png is larger than 1 MB.');
      expect(store.put).not.toHaveBeenCalled();

      db.insertPatientReport.mockRejectedValueOnce(new Error('insert failed'));
      await expect(addReports(context(), { appointmentId, files: [png()] })).rejects.toThrow(
        'insert failed',
      );
      expect(store.remove).toHaveBeenCalledWith([expect.stringMatching(/^patient\//)]);
    });
  });
});
