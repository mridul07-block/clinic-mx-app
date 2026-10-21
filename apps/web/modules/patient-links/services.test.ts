import { readPatientLink, signPatientLink, type Db } from '@clinic-mx/db';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  PatientLinkError,
  completePatientLink,
  issuePatientLink,
  openPatientLink,
  reissueMyPlanLink,
} from './services';

const secret = 'test-only-patient-link-secret-0123456789';
const fakeTx = { kind: 'transaction' };
const db = vi.hoisted(() => ({
  completePatientLinkRow: vi.fn(),
  findPatientLink: vi.fn(),
  insertPatientLink: vi.fn(),
  logRecordView: vi.fn(),
  revokeMyPlanLinks: vi.fn(),
  withActor: vi.fn(),
}));
vi.mock('@clinic-mx/db', async (importOriginal) => {
  const real: Record<string, unknown> = await importOriginal();
  return {
    ...db,
    patientActor: real.patientActor,
    readPatientLink: real.readPatientLink,
    signPatientLink: real.signPatientLink,
    systemActor: real.systemActor,
  };
});
vi.mock('../../lib/db', () => ({ appDb: () => ({ kind: 'appDb' }) }));
const lifetimes: Record<string, number> = {
  'links.health_form_hours': 2,
  'links.my_plan_days': 30,
};
vi.mock('../settings/settings', () => ({
  getSetting: (key: string) => Promise.resolve(lifetimes[key]),
}));

const patientId = '00000000-0000-4000-8000-000000000401';
const appointmentId = '00000000-0000-4000-8000-000000000501';
const episodeId = '00000000-0000-4000-8000-000000000601';
const linkId = '00000000-0000-4000-8000-000000000701';
const now = new Date('2026-10-22T09:00:00Z');
const later = new Date('2026-10-22T11:00:00Z');

const row = (values: Record<string, unknown> = {}) => ({
  id: linkId,
  patientId,
  purpose: 'health_form',
  appointmentId,
  episodeId: null,
  expiresAt: later,
  revokedAt: null,
  completedAt: null,
  createdAt: now,
  ...values,
});
const tokenFor = (purpose: 'health_form' | 'my_plan', expiresAt = later) =>
  signPatientLink({ linkId, purpose, expiresAt }, secret);

// IAM-09 done when: signed, single purpose, expiring links; reissue from WhatsApp.
describe('patient links', () => {
  beforeEach(() => {
    vi.useFakeTimers({ now });
    vi.stubEnv('PATIENT_LINK_SECRET', secret);
    for (const fn of Object.values(db)) fn.mockReset();
    db.insertPatientLink.mockImplementation((_tx: unknown, link: { expiresAt: Date }) =>
      Promise.resolve({ id: linkId, expiresAt: link.expiresAt }),
    );
    db.withActor.mockImplementation((_db: Db, _actor: string, work: (tx: unknown) => unknown) =>
      work(fakeTx),
    );
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  describe('issuing', () => {
    it('signs a link for the purpose, ending after the lifetime setting', async () => {
      const issued = await issuePatientLink(fakeTx as never, {
        patientId,
        purpose: 'health_form',
        appointmentId,
      });
      expect(issued.expiresAt).toEqual(later);
      expect(db.insertPatientLink).toHaveBeenCalledWith(fakeTx, {
        patientId,
        purpose: 'health_form',
        appointmentId,
        expiresAt: later,
      });
      expect(issued.path).toMatch(/^\/p\/[A-Za-z0-9_-]{51}$/);
      expect(readPatientLink(issued.path.slice(3), { current: secret })).toEqual({
        linkId,
        purpose: 'health_form',
        expiresAt: later,
      });
      expect(db.revokeMyPlanLinks).not.toHaveBeenCalled();
    });

    it('stops the patient’s older My plan links when a new one is issued', async () => {
      const issued = await issuePatientLink(fakeTx as never, {
        patientId,
        purpose: 'my_plan',
        episodeId,
      });
      expect(issued.expiresAt).toEqual(new Date('2026-11-21T09:00:00Z'));
      expect(db.revokeMyPlanLinks).toHaveBeenCalledWith(fakeTx, patientId, linkId);
    });

    it('refuses a link tied to the wrong thing, or with no key set up', async () => {
      await expect(
        issuePatientLink(fakeTx as never, { patientId, purpose: 'health_form', episodeId }),
      ).rejects.toThrow(new PatientLinkError('A health_form link is tied to one appointment.'));
      vi.stubEnv('PATIENT_LINK_SECRET', '');
      await expect(
        issuePatientLink(fakeTx as never, { patientId, purpose: 'health_form', appointmentId }),
      ).rejects.toThrow(PatientLinkError);
      expect(db.insertPatientLink).not.toHaveBeenCalled();
    });

    it('reissues My plan from WhatsApp as the system, audited as system:whatsapp', async () => {
      const issued = await reissueMyPlanLink({} as Db, { patientId, episodeId });
      expect(db.withActor).toHaveBeenCalledWith({}, 'system:whatsapp', expect.any(Function));
      expect(db.revokeMyPlanLinks).toHaveBeenCalledWith(fakeTx, patientId, linkId);
      expect(readPatientLink(issued.path.slice(3), { current: secret })?.purpose).toBe('my_plan');
    });
  });

  describe('opening', () => {
    it('opens a valid link and records the view as the patient', async () => {
      db.findPatientLink.mockResolvedValue(row());
      const opened = await openPatientLink(tokenFor('health_form'), { ip: '203.0.113.9' });
      expect(opened).toMatchObject({ status: 'valid', link: { id: linkId, patientId } });
      expect(db.logRecordView).toHaveBeenCalledWith(
        { kind: 'appDb' },
        {
          actor: `patient:${patientId}`,
          ip: '203.0.113.9',
          entity: 'patient_link',
          entityId: linkId,
        },
      );
    });

    it('refuses a changed or unsigned token without asking the database', async () => {
      const token = tokenFor('health_form');
      const changed = `${token.slice(0, 10)}${token[10] === 'A' ? 'B' : 'A'}${token.slice(11)}`;
      for (const bad of [changed, 'not-a-link', '']) {
        expect(await openPatientLink(bad)).toEqual({ status: 'invalid' });
      }
      vi.stubEnv('PATIENT_LINK_SECRET', '');
      expect(await openPatientLink(token)).toEqual({ status: 'invalid' });
      expect(db.findPatientLink).not.toHaveBeenCalled();
    });

    it('says expired from the token alone once its time has passed', async () => {
      expect(await openPatientLink(tokenFor('my_plan', now))).toEqual({
        status: 'expired',
        purpose: 'my_plan',
      });
      expect(db.findPatientLink).not.toHaveBeenCalled();
    });

    it('says stopped, submitted, or not valid from the row', async () => {
      db.findPatientLink.mockResolvedValueOnce(
        row({ purpose: 'my_plan', appointmentId: null, episodeId, revokedAt: now }),
      );
      expect(await openPatientLink(tokenFor('my_plan'))).toEqual({
        status: 'revoked',
        purpose: 'my_plan',
      });
      db.findPatientLink.mockResolvedValueOnce(row({ completedAt: now }));
      expect(await openPatientLink(tokenFor('health_form'))).toEqual({
        status: 'used',
        purpose: 'health_form',
      });
      // A row that does not match its token: gone, another purpose, another expiry.
      for (const found of [undefined, row({ purpose: 'consent' }), row({ expiresAt: now })]) {
        db.findPatientLink.mockResolvedValueOnce(found);
        expect(await openPatientLink(tokenFor('health_form'))).toEqual({ status: 'invalid' });
      }
      expect(db.logRecordView).not.toHaveBeenCalled();
    });
  });

  describe('completing', () => {
    it('marks a single use link submitted, once', async () => {
      db.completePatientLinkRow.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
      await completePatientLink(fakeTx as never, { id: linkId, purpose: 'health_form' });
      await expect(
        completePatientLink(fakeTx as never, { id: linkId, purpose: 'health_form' }),
      ).rejects.toThrow(new PatientLinkError('This link no longer accepts a submission.'));
    });

    it('never completes a My plan link, which stays usable until it ends', async () => {
      await expect(
        completePatientLink(fakeTx as never, { id: linkId, purpose: 'my_plan' }),
      ).rejects.toThrow(new PatientLinkError('Only single use links are completed.'));
      expect(db.completePatientLinkRow).not.toHaveBeenCalled();
    });
  });
});
