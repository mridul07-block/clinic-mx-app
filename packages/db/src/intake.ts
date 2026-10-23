import type { AppointmentStatus, HealthFormAnswer } from '@clinic-mx/schemas';
import { eq, sql } from 'drizzle-orm';
import { appointment, centre, intakeResponse, patient, patientLink, staffUser } from './schema';
import type { DbOrTransaction } from './versioned';

/** The visit a health form link is tied to, as its patient page shows it (INT-03). */
export interface HealthFormVisit {
  appointmentId: string;
  status: AppointmentStatus;
  startsAt: Date;
  patientName: string;
  /** For the guardian section (INT-07): `YYYY-MM-DD`, or null when not on file. */
  dateOfBirth: string | null;
  centreName: string;
  physioName: string;
}

/**
 * The visit of the link the page runs under, read inside `withPatientAccess`: row level security
 * shows the patient only their own link and its appointment, so nothing here comes from the
 * browser. Undefined when the link has no appointment the patient can see.
 */
export async function healthFormVisit(db: DbOrTransaction): Promise<HealthFormVisit | undefined> {
  const [row] = await db
    .select({
      appointmentId: appointment.id,
      status: appointment.status,
      startsAt: appointment.startsAt,
      patientName: patient.name,
      dateOfBirth: patient.dateOfBirth,
      centreName: centre.name,
      physioName: staffUser.name,
    })
    .from(patientLink)
    .innerJoin(appointment, eq(appointment.id, patientLink.appointmentId))
    .innerJoin(patient, eq(patient.id, appointment.patientId))
    .innerJoin(centre, eq(centre.id, appointment.centreId))
    .innerJoin(staffUser, eq(staffUser.id, appointment.physioId))
    .limit(1);
  return row;
}

/** A health form as saved so far (INT-04). */
export interface IntakeResponse {
  id: string;
  formVersion: string;
  answers: Record<string, HealthFormAnswer>;
  doneScreens: string[];
  submittedAt: Date | null;
}

/**
 * The health form of the link the page runs under, inside `withPatientAccess`: row level security
 * shows a patient only their own link's visit. Undefined until the first screen is saved.
 */
export async function ownIntakeResponse(db: DbOrTransaction): Promise<IntakeResponse | undefined> {
  const [row] = await db
    .select({
      id: intakeResponse.id,
      formVersion: intakeResponse.formVersion,
      answers: intakeResponse.answers,
      doneScreens: intakeResponse.doneScreens,
      submittedAt: intakeResponse.submittedAt,
    })
    .from(intakeResponse)
    .limit(1);
  return row;
}

/**
 * Saves a health form after a screen: the first save starts it for the visit, later ones replace
 * the answers and screens sent. Row level security decides whether the patient may.
 */
export async function saveIntakeResponse(
  tx: DbOrTransaction,
  form: {
    appointmentId: string;
    patientId: string;
    patientLinkId: string;
    formVersion: string;
    answers: Record<string, HealthFormAnswer>;
    doneScreens: string[];
  },
): Promise<{ id: string }> {
  const [row] = await tx
    .insert(intakeResponse)
    .values(form)
    .onConflictDoUpdate({
      target: intakeResponse.appointmentId,
      set: { answers: form.answers, doneScreens: form.doneScreens, updatedAt: sql`now()` },
    })
    .returning({ id: intakeResponse.id });
  if (!row) throw new Error('The health form was not saved.');
  return row;
}
