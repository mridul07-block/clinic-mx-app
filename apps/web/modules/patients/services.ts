import 'server-only';
import {
  guardianRecord,
  insertGuardian,
  insertPatient,
  patientRecord,
  patientsOnPhone,
  removeGuardian,
  updateGuardian,
  updatePatient,
  type PatientMatch,
} from '@clinic-mx/db';
import {
  guardianRemoveSchema,
  guardianUpdateSchema,
  newGuardianSchema,
  newPatientSchema,
  patientUpdateSchema,
} from '@clinic-mx/schemas';
import { staffService, type ServiceTransaction } from '../access/service';

/**
 * Patients (SCH-01, PRD M1): keyed by person, so a family shares one mobile. The Super Admin,
 * Centre Managers and the Front Desk add and edit them (patients.edit_contact), under row level
 * security and audited; the database issues the OP number from the registering centre's
 * sequence. Decision (user, 22 October 2026): a mobile already on file shows its patients first,
 * and another person is added to it only when staff confirm.
 */

/** A refusal to show staff as it is. */
export class PatientError extends Error {
  override name = 'PatientError';
}

export type AddPatientResult =
  | { status: 'added'; id: string; opNumber: string }
  /** The mobile is on file: nothing was added; staff open one of these or confirm a new person. */
  | { status: 'matches'; matches: PatientMatch[] };

/** Adds a patient at a centre the person sees; the centre issues the OP number. */
export const addPatient = staffService({
  action: 'patients.edit_contact',
  input: newPatientSchema,
  target: (input) => Promise.resolve({ centreId: input.registeredCentreId }),
  run: async (tx, { confirmNewPerson, ...details }): Promise<AddPatientResult> => {
    if (!confirmNewPerson) {
      const matches = await patientsOnPhone(tx, details.phone);
      if (matches.length > 0) return { status: 'matches', matches };
    }
    const added = await insertPatient(tx, details);
    return { status: 'added', ...added };
  },
});

/** Changes a patient's name and contact details; the OP number and centre never change. */
export const editPatient = staffService({
  action: 'patients.edit_contact',
  input: patientUpdateSchema,
  run: async (tx, { patientId, ...details }) => {
    if (!(await updatePatient(tx, patientId, details))) {
      throw new PatientError('That patient was not found.');
    }
  },
});

/**
 * Guardians (SCH-02, PRD J2.7): several per patient, kept by those who edit patients. A guardian
 * is removed, never deleted (consent records point to who signed); a removed one cannot change.
 */
export const addGuardian = staffService({
  action: 'patients.edit_contact',
  input: newGuardianSchema,
  run: async (tx, { patientId, ...details }) => {
    if (!(await patientRecord(tx, patientId))) {
      throw new PatientError('That patient was not found.');
    }
    return insertGuardian(tx, patientId, details);
  },
});

/** Why a guardian could not change: removed already, or not there at all. */
async function guardianRefusal(tx: ServiceTransaction, guardianId: string): Promise<PatientError> {
  const found = await guardianRecord(tx, guardianId);
  return new PatientError(
    found
      ? 'That guardian was removed, so their details cannot change.'
      : 'That guardian was not found.',
  );
}

export const editGuardian = staffService({
  action: 'patients.edit_contact',
  input: guardianUpdateSchema,
  run: async (tx, { guardianId, ...details }) => {
    if (!(await updateGuardian(tx, guardianId, details))) {
      throw await guardianRefusal(tx, guardianId);
    }
  },
});

export const removeGuardianService = staffService({
  action: 'patients.edit_contact',
  input: guardianRemoveSchema,
  run: async (tx, { guardianId }) => {
    if (!(await removeGuardian(tx, guardianId))) {
      throw await guardianRefusal(tx, guardianId);
    }
  },
});
