import type {
  AppointmentStatus,
  HealthFormAnswer,
  PatientSex,
  ReportContentType,
} from '@clinic-mx/schemas';
import { asc, eq, isNull, sql } from 'drizzle-orm';
import {
  appointment,
  centre,
  intakeResponse,
  patient,
  patientLink,
  patientReport,
  staffUser,
} from './schema';
import type { DbOrTransaction } from './versioned';

/** The visit a health form link is tied to, as its patient page shows it (INT-03). */
export interface HealthFormVisit {
  appointmentId: string;
  status: AppointmentStatus;
  startsAt: Date;
  patientName: string;
  /** For the guardian section (INT-07): `YYYY-MM-DD`, or null when not on file. */
  dateOfBirth: string | null;
  /** On file, to start About you from the record (INT-05). */
  sex: PatientSex | null;
  occupation: string | null;
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
      sex: patient.sex,
      occupation: patient.occupation,
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
  /** The earlier form whose details were carried over, and the patient's review (INT-08). */
  carriedFromId: string | null;
  detailsChanged: boolean | null;
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
      carriedFromId: intakeResponse.carriedFromId,
      detailsChanged: intakeResponse.detailsChanged,
    })
    .from(intakeResponse)
    .limit(1);
  return row;
}

/** An earlier form a returning patient's details come from (INT-08). */
export interface CarrySource {
  id: string;
  submittedAt: Date;
  /** Only the carried fields' answers. */
  answers: Record<string, HealthFormAnswer>;
}

/**
 * The earlier form the page's patient may carry over, inside `withPatientAccess`
 * (`internal.health_form_carry_source`): their newest submitted form for another visit within
 * `months`, or `chosen` once picked. Only the answers to `keys` leave the database.
 */
export async function healthFormCarrySource(
  db: DbOrTransaction,
  keys: readonly string[],
  months: number,
  chosen?: string | null,
): Promise<CarrySource | undefined> {
  const [row] = await db.execute<{
    id: string;
    submitted_at: string;
    answers: Record<string, HealthFormAnswer>;
  }>(
    sql`select id, submitted_at, answers from internal.health_form_carry_source(${`{${keys.join(',')}}`}::text[], ${months}, ${chosen ?? null}::uuid)`,
  );
  return row && { id: row.id, submittedAt: new Date(row.submitted_at), answers: row.answers };
}

/**
 * Records the patient's answer to "Has anything changed?" on the page's own form, with the
 * answers and screens it leaves (INT-08). Row level security allows it only before submit, while
 * the visit is on; the database checks the earlier form is the same patient's. Whether it saved.
 */
export async function saveDetailsReview(
  tx: DbOrTransaction,
  review: {
    carriedFromId: string;
    detailsChanged: boolean;
    answers: Record<string, HealthFormAnswer>;
    doneScreens: string[];
  },
): Promise<boolean> {
  const saved = await tx
    .update(intakeResponse)
    .set({ ...review, updatedAt: sql`now()` })
    .where(isNull(intakeResponse.submittedAt))
    .returning({ id: intakeResponse.id });
  return saved.length > 0;
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

/**
 * Assisted mode (INT-09): records the signed in staff member as helping with a visit's health
 * form, starting the form if the patient has not yet. `internal.mark_health_form_assisted` allows
 * only someone who checks in, for a checked in visit at a centre they see, with its health form
 * link, before the form is sent; whether it was marked.
 */
export async function markIntakeAssisted(
  tx: DbOrTransaction,
  form: { appointmentId: string; patientLinkId: string; formVersion: string },
): Promise<boolean> {
  const [row] = await tx.execute<{ marked: boolean }>(
    sql`select internal.mark_health_form_assisted(${form.appointmentId}, ${form.patientLinkId}, ${form.formVersion}) as marked`,
  );
  return row?.marked ?? false;
}

/**
 * Submits the form of the link the page runs under (INT-05): its submit time is now, once; row
 * level security allows only that, and nothing after. False when there is no form to submit.
 */
export async function submitIntakeResponse(tx: DbOrTransaction): Promise<boolean> {
  const done = await tx
    .update(intakeResponse)
    .set({ submittedAt: sql`now()`, updatedAt: sql`now()` })
    .where(isNull(intakeResponse.submittedAt))
    .returning({ id: intakeResponse.id });
  return done.length > 0;
}

/** A report photo the patient added on the health form (INT-05). */
export interface OwnReport {
  id: string;
  contentType: ReportContentType;
  createdAt: Date;
}

/**
 * The reports added through the link the page runs under, oldest first: row level security shows
 * a patient page only those.
 */
export function ownReports(db: DbOrTransaction): Promise<OwnReport[]> {
  return db
    .select({
      id: patientReport.id,
      contentType: patientReport.contentType,
      createdAt: patientReport.createdAt,
    })
    .from(patientReport)
    .orderBy(asc(patientReport.createdAt), asc(patientReport.id));
}
