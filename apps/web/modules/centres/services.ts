import 'server-only';
import {
  activeCentreWithColour,
  centreCodeTaken,
  centreList,
  centreNameTaken,
  centreRecord,
  insertCentre,
  setCentreActive,
  updateCentre,
} from '@clinic-mx/db';
import {
  centreActiveSchema,
  centreColourName,
  centreColours,
  centreUpdateSchema,
  newCentreSchema,
  type CentreDetails,
} from '@clinic-mx/schemas';
import { staffService, type ServiceTransaction } from '../access/service';

/**
 * Centres (SET-01, PRD M16): the Super Admin adds, edits, deactivates and reactivates them; none
 * is ever deleted. Each is a staffService for centres.manage, under row level security and
 * audited. Decision (user, 22 October 2026): a chart colour is one of the design system's centre
 * colours, used by one active centre at a time; the database's unique index says the same.
 */

/** A refusal to show the Super Admin as it is. */
export class CentreError extends Error {
  override name = 'CentreError';
}

export const allColoursInUse =
  'All centre colours are in use. A new colour must be added to the design system before another centre can be active.';

async function checkDetails(tx: ServiceTransaction, details: CentreDetails, centreId?: string) {
  if (await centreNameTaken(tx, details.name, centreId)) {
    throw new CentreError('A centre with this name already exists.');
  }
  const holder = await activeCentreWithColour(tx, details.colour, centreId);
  if (holder) {
    throw new CentreError(
      `${centreColourName(details.colour)} is used by ${holder.name}. Choose another colour.`,
    );
  }
}

/** Adds a centre, active from now, with a code no centre has used (it starts OP numbers). */
export const addCentre = staffService({
  action: 'centres.manage',
  input: newCentreSchema,
  run: async (tx, details) => {
    const centres = await centreList(tx);
    const used = new Set(centres.filter((c) => c.active).map((c) => c.colour));
    if (centreColours.every((colour) => used.has(colour.value))) {
      throw new CentreError(allColoursInUse);
    }
    await checkDetails(tx, details);
    if (await centreCodeTaken(tx, details.code)) {
      throw new CentreError(`Another centre has the code ${details.code}. Choose another code.`);
    }
    return insertCentre(tx, details);
  },
});

/** Changes a centre's name, address, phone, map link or colour. */
export const editCentre = staffService({
  action: 'centres.manage',
  input: centreUpdateSchema,
  run: async (tx, { centreId, ...details }) => {
    const current = await centreRecord(tx, centreId);
    if (!current) throw new CentreError('That centre was not found.');
    // An inactive centre may share a colour; the check applies once it is active again.
    if (current.active) {
      await checkDetails(tx, details, centreId);
    } else if (await centreNameTaken(tx, details.name, centreId)) {
      throw new CentreError('A centre with this name already exists.');
    }
    await updateCentre(tx, centreId, details);
  },
});

/**
 * Deactivates a centre (its staff assignments, tablets and history stay) or reactivates it, if
 * its colour is free.
 */
export const setCentreActiveService = staffService({
  action: 'centres.manage',
  input: centreActiveSchema,
  run: async (tx, { centreId, active }) => {
    const current = await centreRecord(tx, centreId);
    if (!current) throw new CentreError('That centre was not found.');
    if (active) {
      const holder = await activeCentreWithColour(tx, current.colour, centreId);
      if (holder) {
        throw new CentreError(
          `${centreColourName(current.colour)} is used by ${holder.name}. Choose another colour for ${current.name} before reactivating it.`,
        );
      }
    }
    if (!(await setCentreActive(tx, centreId, active))) {
      throw new CentreError(
        active ? 'That centre is already active.' : 'That centre is already inactive.',
      );
    }
  },
});
