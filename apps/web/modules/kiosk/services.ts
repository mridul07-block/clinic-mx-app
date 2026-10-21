import 'server-only';
import {
  clearKioskLink,
  findKioskDevice,
  hashKioskToken,
  insertKioskDevice,
  newKioskToken,
  patientLinkState,
  sendLinkToKiosk,
  stopKioskDevice,
} from '@clinic-mx/db';
import {
  opensOnKiosk,
  sendToKioskSchema,
  setUpKioskSchema,
  stopKioskSchema,
} from '@clinic-mx/schemas';
import { z } from 'zod';
import { staffService, systemService, type ServiceTransaction } from '../access/service';

/**
 * Clinic tablets in kiosk mode (IAM-10, PRD J2.2, Frontend Specification section 7). Staff with
 * check in rights set a tablet up as their centre's kiosk, send a patient's form to it ("Open on
 * tablet", INT-02) and stop it; each is a staffService for check_in.manage, under row level
 * security and audited. The tablet resets itself as `system:kiosk.<id>`.
 */

/** A refusal to show staff as it is. */
export class KioskError extends Error {
  override name = 'KioskError';
}

/** A tablet's centre, for the permission check; a tablet the reader cannot see is not found. */
async function kioskCentre(tx: ServiceTransaction, kioskId: string) {
  const device = await findKioskDevice(tx, kioskId);
  if (!device) throw new KioskError('That tablet was not found.');
  return { centreId: device.centreId };
}

/**
 * Sets this device up as a centre's kiosk. Returns the tablet's token, which the caller puts in
 * the tablet's cookie and never shows; only its hash is kept.
 */
export const setUpKiosk = staffService({
  action: 'check_in.manage',
  input: setUpKioskSchema,
  target: ({ centreId }) => Promise.resolve({ centreId }),
  run: async (tx, { centreId, name }, actor) => {
    const token = newKioskToken();
    const { id } = await insertKioskDevice(tx, {
      centreId,
      name,
      createdBy: actor.id,
      tokenHash: hashKioskToken(token),
    });
    return { kioskId: id, token };
  },
});

/** Ends a tablet's kiosk mode; it goes back to a normal browser at its next check. */
export const stopKiosk = staffService({
  action: 'check_in.manage',
  input: stopKioskSchema,
  target: ({ kioskId }, tx) => kioskCentre(tx, kioskId),
  run: async (tx, { kioskId }, actor) => {
    if (!(await stopKioskDevice(tx, kioskId, actor.id))) {
      throw new KioskError('That tablet had already stopped being a kiosk.');
    }
  },
});

const linkRefusals = {
  expired: 'That form link has expired. Make a new one.',
  stopped: 'That form link was stopped. Make a new one.',
  used: 'The patient has already sent that form.',
} as const;

/**
 * Puts a patient's form on a tablet, replacing whatever it showed. Only a form that still works
 * and is filled in at the clinic: My plan opens on the patient's own phone.
 */
export const sendToKiosk = staffService({
  action: 'check_in.manage',
  input: sendToKioskSchema,
  target: ({ kioskId }, tx) => kioskCentre(tx, kioskId),
  run: async (tx, { kioskId, linkId }) => {
    const link = await patientLinkState(tx, linkId);
    if (!link) throw new KioskError('That form was not found.');
    if (!opensOnKiosk(link.purpose)) {
      throw new KioskError('My plan opens on the patient’s own phone, not the clinic tablet.');
    }
    if (link.state !== 'active') throw new KioskError(linkRefusals[link.state]);
    if (!(await sendLinkToKiosk(tx, kioskId, linkId))) {
      throw new KioskError('That tablet is no longer a kiosk.');
    }
  },
});

/**
 * The tablet goes back to its welcome screen: after a submit or when idle. Only the form still on
 * it is taken off, so a form sent a moment later stays. The tablet is the actor; the caller has
 * found it by its cookie.
 */
export const resetKiosk = systemService({
  component: ({ kioskId }) => `kiosk.${kioskId}`,
  input: z.object({ kioskId: z.guid(), linkId: z.guid() }),
  run: (tx, { kioskId, linkId }) => clearKioskLink(tx, kioskId, linkId),
});
