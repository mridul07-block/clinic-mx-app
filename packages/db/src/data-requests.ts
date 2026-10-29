import type { DataRequestKind, DataRequestStatus } from '@clinic-mx/schemas';
import { desc, eq, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { dataRequest, patient, staffUser } from './schema';
import type { DbOrTransaction } from './versioned';

/**
 * Data requests (ADM-03; docs/runbooks/data-requests.md). Read and written as the Super Admin under
 * row level security; the database's guard keeps a request open until it is closed once, and
 * `internal.patient_export` exports a patient's data only for their open export request.
 */

export interface DataRequestEntry {
  id: string;
  patientId: string;
  patientName: string;
  opNumber: string;
  kind: DataRequestKind;
  receivedOn: string;
  dueOn: string;
  details: string;
  status: DataRequestStatus;
  outcome: string | null;
  recordedByName: string;
  closedByName: string | null;
  closedAt: Date | null;
}

const recorder = alias(staffUser, 'recorder');
const closer = alias(staffUser, 'closer');

const columns = {
  id: dataRequest.id,
  patientId: dataRequest.patientId,
  patientName: patient.name,
  opNumber: patient.opNumber,
  kind: dataRequest.kind,
  receivedOn: dataRequest.receivedOn,
  dueOn: dataRequest.dueOn,
  details: dataRequest.details,
  status: dataRequest.status,
  outcome: dataRequest.outcome,
  recordedByName: recorder.name,
  closedByName: closer.name,
  closedAt: dataRequest.closedAt,
};

function entries(db: DbOrTransaction) {
  return db
    .select(columns)
    .from(dataRequest)
    .innerJoin(patient, eq(patient.id, dataRequest.patientId))
    .innerJoin(recorder, eq(recorder.id, dataRequest.recordedBy))
    .leftJoin(closer, eq(closer.id, dataRequest.closedBy));
}

/** Every request: open ones first, soonest due; then closed ones, most recently closed. */
export function dataRequestList(db: DbOrTransaction): Promise<DataRequestEntry[]> {
  return entries(db).orderBy(
    sql`${dataRequest.status} <> 'open'`,
    sql`case when ${dataRequest.status} = 'open' then ${dataRequest.dueOn} end asc`,
    desc(dataRequest.closedAt),
  );
}

/** One request, or undefined when it is not there or the reader may not see it. */
export async function dataRequestRecord(
  db: DbOrTransaction,
  requestId: string,
): Promise<DataRequestEntry | undefined> {
  const [row] = await entries(db).where(eq(dataRequest.id, requestId));
  return row;
}

/** Records a request, open; returns its id. The recorder is the signed in person. */
export async function insertDataRequest(
  db: DbOrTransaction,
  values: {
    patientId: string;
    kind: DataRequestKind;
    receivedOn: string;
    dueOn: string;
    details: string;
    recordedBy: string;
  },
): Promise<string> {
  const [row] = await db.insert(dataRequest).values(values).returning({ id: dataRequest.id });
  if (!row) throw new Error('The data request was not recorded.');
  return row.id;
}

/** Closes an open request as done or declined; false when it was not open (or not seen). */
export async function closeDataRequest(
  db: DbOrTransaction,
  {
    requestId,
    status,
    outcome,
    closedBy,
  }: { requestId: string; status: 'done' | 'declined'; outcome: string; closedBy: string },
): Promise<boolean> {
  const updated = await db
    .update(dataRequest)
    .set({ status, outcome, closedBy, closedAt: new Date() })
    .where(sql`${dataRequest.id} = ${requestId} and ${dataRequest.status} = 'open'`)
    .returning({ id: dataRequest.id });
  return updated.length === 1;
}

/**
 * Everything held about the patient of an open export request, as one JSON document, from the
 * reviewed list of tables (`internal.patient_export_tables`); the export is audited on the request.
 * The database refuses anyone but the Super Admin, and any request that is not an open export.
 */
export async function patientExport(
  db: DbOrTransaction,
  requestId: string,
): Promise<Record<string, unknown>> {
  const [row] = await db.execute<{ export: Record<string, unknown> }>(
    sql`select internal.patient_export(${requestId}::uuid) as export`,
  );
  if (!row) throw new Error('The export returned nothing.');
  return row.export;
}
