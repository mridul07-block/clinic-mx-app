import { inArray, sql } from 'drizzle-orm';
import { patient } from './schema';
import type { DbOrTransaction } from './versioned';

/**
 * "Not delivered" on the front desk's Today (WA-13): the centre's messages Meta could not deliver
 * to a known patient, for `whatsapp.undelivered_days`, until someone marks them Done. Read and
 * written through `internal.undelivered_messages` and `internal.follow_up_undelivered`, which check
 * the signed in person may run Today at the centre (never a Velyx support login); everyone else
 * gets nothing. Run as the signed in person.
 */
export interface UndeliveredMessage {
  id: string;
  patientId: string;
  patientName: string;
  patientNumber: string | null;
  templateKey: string | null;
  kind: string;
  failedAt: Date;
  errorCode: string | null;
  errorTitle: string | null;
  appointmentId: string | null;
}

interface UndeliveredRow extends Record<string, unknown> {
  id: string;
  patient_id: string;
  template_key: string | null;
  kind: string;
  status_at: string | Date;
  error_code: string | null;
  error_title: string | null;
  appointment_id: string | null;
}

export async function undeliveredMessages(
  tx: DbOrTransaction,
  centreId: string,
): Promise<UndeliveredMessage[]> {
  const rows = [
    ...(await tx.execute<UndeliveredRow>(
      sql`select * from internal.undelivered_messages(${centreId}::uuid)`,
    )),
  ];
  if (rows.length === 0) return [];
  // The person's own read of the patients, under row level security.
  const people = await tx
    .select({ id: patient.id, name: patient.name, number: patient.opNumber })
    .from(patient)
    .where(
      inArray(
        patient.id,
        rows.map((row) => row.patient_id),
      ),
    );
  const byId = new Map(people.map((person) => [person.id, person]));
  return rows.flatMap((row) => {
    const person = byId.get(row.patient_id);
    if (!person) return [];
    return [
      {
        id: row.id,
        patientId: row.patient_id,
        patientName: person.name,
        patientNumber: person.number,
        templateKey: row.template_key,
        kind: row.kind,
        failedAt: new Date(row.status_at),
        errorCode: row.error_code,
        errorTitle: row.error_title,
        appointmentId: row.appointment_id,
      },
    ];
  });
}

/**
 * Done on a failed message, as the signed in person: true when this call recorded it. Needs the
 * person's audit actor (a staff service): without one the audit trigger refuses the write.
 */
export async function followUpUndelivered(
  tx: DbOrTransaction,
  messageId: string,
): Promise<boolean> {
  const [row] = await tx.execute<{ done: boolean }>(
    sql`select internal.follow_up_undelivered(${messageId}::uuid) as done`,
  );
  return row?.done === true;
}
