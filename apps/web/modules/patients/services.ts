import 'server-only';
import { insertPatient, patientsOnPhone, updatePatient, type PatientMatch } from '@clinic-mx/db';
import { newPatientSchema, patientUpdateSchema } from '@clinic-mx/schemas';
import { staffService } from '../access/service';

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
