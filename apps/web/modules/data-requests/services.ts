import 'server-only';
import {
  closeDataRequest,
  dataRequestList,
  dataRequestRecord,
  insertDataRequest,
  patientExport,
  type DataRequestEntry,
  type StaffMember,
} from '@clinic-mx/db';
import {
  closeDataRequestSchema,
  dataRequestDueOn,
  dataRequestSchema,
  istDate,
} from '@clinic-mx/schemas';
import { assertMay } from '../access/guard';
import { staffService, type ServiceContext } from '../access/service';
import { asStaff, asStaffViewing } from '../access/staff-db';
import { getSetting } from '../settings/settings';

/**
 * Data requests (ADM-03; docs/runbooks/data-requests.md): the Super Admin records a patient's
 * request for a copy of their data, a correction or deletion (`data_requests.manage`), it is due
 * the setting's days after it was received, and it is closed once as done or declined. A copy is
 * exported only for an open export request (`data.export`), audited. Deletion waits for the
 * clinic's retention period (PRD decision 20). Recommended defaults chosen under the user's
 * standing approval, 29 October 2026 (DECISION ADM-03).
 */

/** A refusal to show the Super Admin as it is. */
export class DataRequestError extends Error {
  override name = 'DataRequestError';
}

export async function dataRequests(staff: StaffMember): Promise<DataRequestEntry[]> {
  assertMay(staff, 'data_requests.manage');
  return asStaff(staff, (tx) => dataRequestList(tx));
}

export async function dataRequestFor(
  staff: StaffMember,
  requestId: string,
): Promise<DataRequestEntry | undefined> {
  assertMay(staff, 'data_requests.manage');
  return asStaff(staff, (tx) => dataRequestRecord(tx, requestId));
}

/** Records a request; returns its id. */
export async function recordDataRequest(
  context: ServiceContext,
  rawInput: unknown,
): Promise<string> {
  const responseDays = await getSetting('privacy.request_response_days');
  return staffService({
    action: 'data_requests.manage',
    input: dataRequestSchema,
    run: async (tx, input, actor): Promise<string> => {
      if (input.receivedOn > istDate(new Date())) {
        throw new DataRequestError('The day it was received cannot be in the future.');
      }
      return insertDataRequest(tx, {
        ...input,
        dueOn: dataRequestDueOn(input.receivedOn, responseDays),
        recordedBy: actor.id,
      });
    },
  })(context, rawInput);
}

/** Closes an open request as done or declined, with what was done. */
export const closeRequest = staffService({
  action: 'data_requests.manage',
  input: closeDataRequestSchema,
  run: async (tx, { requestId, status, outcome }, actor): Promise<void> => {
    if (!(await closeDataRequest(tx, { requestId, status, outcome, closedBy: actor.id }))) {
      throw new DataRequestError('This request is already closed. Reload the page to read it.');
    }
  },
});

/**
 * The patient's data for their open export request, as one JSON document, audited as an export.
 * Undefined when the request is not an open export request.
 */
export async function exportForRequest(
  staff: StaffMember,
  requestId: string,
): Promise<{ fileName: string; data: Record<string, unknown> } | undefined> {
  assertMay(staff, 'data_requests.manage');
  assertMay(staff, 'data.export');
  return asStaffViewing(staff, async (tx) => {
    const request = await dataRequestRecord(tx, requestId);
    if (request?.kind !== 'export' || request.status !== 'open') return undefined;
    const data = await patientExport(tx, request.id);
    return { fileName: `clinic-mx-${request.opNumber}-data.json`, data };
  });
}
