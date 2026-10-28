import {
  addDays,
  startOfIstDay,
  type AlertDisplay,
  type AppointmentStatus,
} from '@clinic-mx/schemas';
import { and, asc, desc, eq, gte, inArray, lt, ne, notInArray, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { partAConsentDeclined } from './consent';
import {
  appointment,
  appointmentType,
  centre,
  consultation,
  patient,
  patientLink,
  staffUser,
} from './schema';
import type { DbOrTransaction } from './versioned';

/** Who started a visit: its own physio, or a colleague covering a session (SES-08). */
const starter = alias(staffUser, 'started_by_staff');

/** A visit on a physio's My patients today (CLN-01). */
export interface MyPatientVisit {
  id: string;
  number: string;
  startsAt: Date;
  endsAt: Date;
  status: AppointmentStatus;
  arrivedAt: Date | null;
  startedAt: Date | null;
  /** Who started it; a colleague covering a session when not the physio (SES-08). */
  startedBy: string | null;
  startedByName: string | null;
  patientId: string;
  patientName: string;
  opNumber: string;
  centreId: string;
  centreName: string;
  typeKey: string;
  typeName: string;
  episodeId: string | null;
  /** The consultation Start consultation opened (CLN-02), for Open consultation. */
  consultationId: string | null;
  /** The latest health form link, for the form status; none when none was sent. */
  healthForm: { expiresAt: Date; revokedAt: Date | null; completedAt: Date | null } | undefined;
  consentDeclined: boolean;
  /** Open red flag alerts on the visit's episode, and how loud they are. */
  openAlerts: number;
  alertDisplays: AlertDisplay[];
  /**
   * The episode's AI preparation sheet is made (AI-03) and no consultation on it is signed; read
   * under the reader's access, so only consultants see one. The caller also checks the AI gate.
   */
  preparationSheet: boolean;
}

/**
 * The person's own appointments on an IST day, at every centre, by start, leaving out Cancelled
 * and Rescheduled (CLN-01). Under the reader's row level security: a physio reads their own
 * appointments, their health form links and consents, and the alerts of their centres.
 */
export async function myPatientsToday(
  db: DbOrTransaction,
  query: { staffId: string; date: string },
): Promise<MyPatientVisit[]> {
  const openAlerts = sql`r.episode_id = ${appointment.episodeId} and r.status <> 'closed'`;
  const rows = await db
    .select({
      id: appointment.id,
      number: appointment.number,
      startsAt: appointment.startsAt,
      endsAt: appointment.endsAt,
      status: appointment.status,
      arrivedAt: appointment.arrivedAt,
      startedAt: appointment.startedAt,
      startedBy: appointment.startedBy,
      startedByName: starter.name,
      patientId: appointment.patientId,
      patientName: patient.name,
      opNumber: patient.opNumber,
      centreId: appointment.centreId,
      centreName: centre.name,
      typeKey: appointmentType.key,
      typeName: appointmentType.name,
      episodeId: appointment.episodeId,
      consultationId: consultation.id,
      consentDeclined: partAConsentDeclined(appointment.id),
      openAlerts: sql<number>`(select count(*)::int from red_flag_alert r where ${openAlerts})`,
      alertDisplays: sql<AlertDisplay[]>`coalesce(
        (select array_agg(distinct r.display::text) from red_flag_alert r where ${openAlerts}),
        '{}'
      )`,
      preparationSheet: sql<boolean>`exists (
        select 1 from ai_preparation_sheet s
        where s.episode_id = ${appointment.episodeId} and s.status in ('ready', 'unavailable')
          and not exists (
            select 1 from consultation c where c.episode_id = s.episode_id and c.status = 'signed'
          )
      )`,
    })
    .from(appointment)
    .innerJoin(patient, eq(patient.id, appointment.patientId))
    .innerJoin(centre, eq(centre.id, appointment.centreId))
    .innerJoin(appointmentType, eq(appointmentType.id, appointment.appointmentTypeId))
    .leftJoin(consultation, eq(consultation.appointmentId, appointment.id))
    .leftJoin(starter, eq(starter.id, appointment.startedBy))
    .where(
      and(
        eq(appointment.physioId, query.staffId),
        gte(appointment.startsAt, startOfIstDay(query.date)),
        lt(appointment.startsAt, startOfIstDay(addDays(query.date, 1))),
        notInArray(appointment.status, ['cancelled', 'rescheduled']),
      ),
    )
    .orderBy(asc(appointment.startsAt));
  if (rows.length === 0) return [];

  const links = await db
    .select({
      appointmentId: patientLink.appointmentId,
      expiresAt: patientLink.expiresAt,
      revokedAt: patientLink.revokedAt,
      completedAt: patientLink.completedAt,
    })
    .from(patientLink)
    .where(
      and(
        inArray(
          patientLink.appointmentId,
          rows.map((row) => row.id),
        ),
        eq(patientLink.purpose, 'health_form'),
      ),
    )
    .orderBy(desc(patientLink.createdAt));
  return rows.map((row) => {
    const latest = links.find((link) => link.appointmentId === row.id);
    return {
      ...row,
      healthForm: latest && {
        expiresAt: latest.expiresAt,
        revokedAt: latest.revokedAt,
        completedAt: latest.completedAt,
      },
    };
  });
}

/** A colleague's visit today at the reader's centres, for cover (SES-08). */
export interface ColleagueVisit {
  id: string;
  startsAt: Date;
  status: AppointmentStatus;
  physioId: string;
  physioName: string;
  startedBy: string | null;
  startedByName: string | null;
  patientId: string;
  patientName: string;
  opNumber: string;
  centreId: string;
  centreName: string;
  typeKey: string;
  typeName: string;
  episodeId: string | null;
}

/**
 * The other physios' appointments on an IST day at the centres the reader sees, by start,
 * leaving out Cancelled and Rescheduled (SES-08). Under the reader's row level security: a physio
 * with the Treats patients tick reads the appointments of their centres.
 */
export async function colleaguesToday(
  db: DbOrTransaction,
  query: { staffId: string; date: string },
): Promise<ColleagueVisit[]> {
  const physio = alias(staffUser, 'booked_physio');
  return db
    .select({
      id: appointment.id,
      startsAt: appointment.startsAt,
      status: appointment.status,
      physioId: appointment.physioId,
      physioName: physio.name,
      startedBy: appointment.startedBy,
      startedByName: starter.name,
      patientId: appointment.patientId,
      patientName: patient.name,
      opNumber: patient.opNumber,
      centreId: appointment.centreId,
      centreName: centre.name,
      typeKey: appointmentType.key,
      typeName: appointmentType.name,
      episodeId: appointment.episodeId,
    })
    .from(appointment)
    .innerJoin(patient, eq(patient.id, appointment.patientId))
    .innerJoin(centre, eq(centre.id, appointment.centreId))
    .innerJoin(appointmentType, eq(appointmentType.id, appointment.appointmentTypeId))
    .innerJoin(physio, eq(physio.id, appointment.physioId))
    .leftJoin(starter, eq(starter.id, appointment.startedBy))
    .where(
      and(
        ne(appointment.physioId, query.staffId),
        gte(appointment.startsAt, startOfIstDay(query.date)),
        lt(appointment.startsAt, startOfIstDay(addDays(query.date, 1))),
        notInArray(appointment.status, ['cancelled', 'rescheduled']),
      ),
    )
    .orderBy(asc(centre.name), asc(appointment.startsAt));
}

/** What Start needs to know about a visit (CLN-01, CLN-02), or undefined when not found. */
export async function visitToStart(
  db: DbOrTransaction,
  appointmentId: string,
): Promise<
  | {
      id: string;
      physioId: string;
      centreId: string;
      status: AppointmentStatus;
      startsAt: Date;
      episodeId: string | null;
      typeKey: string;
    }
  | undefined
> {
  const [row] = await db
    .select({
      id: appointment.id,
      physioId: appointment.physioId,
      centreId: appointment.centreId,
      status: appointment.status,
      startsAt: appointment.startsAt,
      episodeId: appointment.episodeId,
      typeKey: appointmentType.key,
    })
    .from(appointment)
    .innerJoin(appointmentType, eq(appointmentType.id, appointment.appointmentTypeId))
    .where(eq(appointment.id, appointmentId));
  return row;
}

/** A visit as its session screen shows it (SES-02). */
export interface SessionVisit {
  id: string;
  physioId: string;
  physioName: string;
  /** Who started it: the note's writer, a colleague when covered (SES-08). */
  startedBy: string | null;
  startedByName: string | null;
  centreId: string;
  status: AppointmentStatus;
  startsAt: Date;
  episodeId: string | null;
  typeKey: string;
  typeName: string;
  patientId: string;
  patientName: string;
  opNumber: string;
  centreName: string;
}

/**
 * One appointment for the session screen (SES-02), or undefined when not found. Under the reader's
 * row level security: a physio reads the appointments of their centres.
 */
export async function sessionVisit(
  db: DbOrTransaction,
  appointmentId: string,
): Promise<SessionVisit | undefined> {
  const [row] = await db
    .select({
      id: appointment.id,
      physioId: appointment.physioId,
      physioName: staffUser.name,
      startedBy: appointment.startedBy,
      startedByName: starter.name,
      centreId: appointment.centreId,
      status: appointment.status,
      startsAt: appointment.startsAt,
      episodeId: appointment.episodeId,
      typeKey: appointmentType.key,
      typeName: appointmentType.name,
      patientId: appointment.patientId,
      patientName: patient.name,
      opNumber: patient.opNumber,
      centreName: centre.name,
    })
    .from(appointment)
    .innerJoin(appointmentType, eq(appointmentType.id, appointment.appointmentTypeId))
    .innerJoin(patient, eq(patient.id, appointment.patientId))
    .innerJoin(centre, eq(centre.id, appointment.centreId))
    .innerJoin(staffUser, eq(staffUser.id, appointment.physioId))
    .leftJoin(starter, eq(starter.id, appointment.startedBy))
    .where(eq(appointment.id, appointmentId));
  return row;
}

/**
 * Starts a checked in appointment (CLN-01): In progress, stamped with when and by whom. The
 * service checks it is the person's own and today; the database guards both too.
 */
export async function startVisit(
  tx: DbOrTransaction,
  start: { appointmentId: string; by: string; now: Date },
): Promise<{ id: string } | undefined> {
  const [row] = await tx
    .update(appointment)
    .set({ status: 'in_progress', startedAt: start.now, startedBy: start.by, updatedAt: start.now })
    .where(and(eq(appointment.id, start.appointmentId), eq(appointment.status, 'checked_in')))
    .returning({ id: appointment.id });
  return row;
}
