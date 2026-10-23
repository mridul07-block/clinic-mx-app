import {
  addDays,
  startOfIstDay,
  type AppointmentStatus,
  type CalendarQuery,
} from '@clinic-mx/schemas';
import { and, asc, eq, gte, lt, notInArray } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { partAConsentDeclined } from './consent';
import { appointment, appointmentType, patient, staffUser } from './schema';
import type { DbOrTransaction } from './versioned';

/** An appointment on the front desk Today board (INT-01). */
export interface TodayAppointment {
  id: string;
  number: string;
  startsAt: Date;
  endsAt: Date;
  status: AppointmentStatus;
  confirmedAt: Date | null;
  arrivedAt: Date | null;
  patientId: string;
  patientName: string;
  opNumber: string;
  physioId: string;
  physioName: string;
  typeName: string;
  /** A Part A consent declined (INT-06): reception speaks to the patient. */
  consentDeclined: boolean;
}

const physio = alias(staffUser, 'today_physio');

/**
 * A centre's appointments on an IST day for the Today board (INT-01), by start: every physio,
 * whatever their hours, leaving out Cancelled and Rescheduled (user decision, 23 October 2026).
 * Under the reader's row level security.
 */
export async function todayBoard(
  db: DbOrTransaction,
  query: CalendarQuery,
): Promise<TodayAppointment[]> {
  return db
    .select({
      id: appointment.id,
      number: appointment.number,
      startsAt: appointment.startsAt,
      endsAt: appointment.endsAt,
      status: appointment.status,
      confirmedAt: appointment.confirmedAt,
      arrivedAt: appointment.arrivedAt,
      patientId: appointment.patientId,
      patientName: patient.name,
      opNumber: patient.opNumber,
      physioId: appointment.physioId,
      physioName: physio.name,
      typeName: appointmentType.name,
      consentDeclined: partAConsentDeclined(appointment.id),
    })
    .from(appointment)
    .innerJoin(patient, eq(patient.id, appointment.patientId))
    .innerJoin(physio, eq(physio.id, appointment.physioId))
    .innerJoin(appointmentType, eq(appointmentType.id, appointment.appointmentTypeId))
    .where(
      and(
        eq(appointment.centreId, query.centreId),
        gte(appointment.startsAt, startOfIstDay(query.date)),
        lt(appointment.startsAt, startOfIstDay(addDays(query.date, 1))),
        notInArray(appointment.status, ['cancelled', 'rescheduled']),
      ),
    )
    .orderBy(asc(appointment.startsAt), asc(physio.name));
}
