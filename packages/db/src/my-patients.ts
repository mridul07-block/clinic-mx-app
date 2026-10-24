import {
  addDays,
  startOfIstDay,
  type AlertDisplay,
  type AppointmentStatus,
} from '@clinic-mx/schemas';
import { and, asc, desc, eq, gte, inArray, lt, notInArray, sql } from 'drizzle-orm';
import { partAConsentDeclined } from './consent';
import { appointment, appointmentType, centre, consultation, patient, patientLink } from './schema';
import type { DbOrTransaction } from './versioned';

/** A visit on a physio's My patients today (CLN-01). */
export interface MyPatientVisit {
  id: string;
  number: string;
  startsAt: Date;
  endsAt: Date;
  status: AppointmentStatus;
  arrivedAt: Date | null;
  startedAt: Date | null;
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
    })
    .from(appointment)
    .innerJoin(patient, eq(patient.id, appointment.patientId))
    .innerJoin(centre, eq(centre.id, appointment.centreId))
    .innerJoin(appointmentType, eq(appointmentType.id, appointment.appointmentTypeId))
    .leftJoin(consultation, eq(consultation.appointmentId, appointment.id))
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

/** What Start needs to know about a visit (CLN-01, CLN-02), or undefined when not found. */
export async function visitToStart(
  db: DbOrTransaction,
  appointmentId: string,
): Promise<
  | {
      id: string;
      physioId: string;
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
