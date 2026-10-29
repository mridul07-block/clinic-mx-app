import { z } from 'zod';
import { addDays, calendarDateSchema } from './ist';

/**
 * Data requests (ADM-03; PRD M16; TAD section 5, DPDP Act 2023). Recommended defaults chosen under
 * the user's standing approval, 29 October 2026 (DECISION ADM-03; docs/runbooks/data-requests.md):
 * three kinds, due a set number of days after receipt, closed once as done or declined.
 */

export const dataRequestKinds = ['export', 'correction', 'deletion'] as const;
export type DataRequestKind = (typeof dataRequestKinds)[number];

export const dataRequestKindLabels: Record<DataRequestKind, string> = {
  export: 'A copy of their data',
  correction: 'Correct their data',
  deletion: 'Delete their data',
};

export const dataRequestStatuses = ['open', 'done', 'declined'] as const;
export type DataRequestStatus = (typeof dataRequestStatuses)[number];

export const dataRequestStatusLabels: Record<DataRequestStatus, string> = {
  open: 'Open',
  done: 'Done',
  declined: 'Declined',
};

const words = (empty: string, long: string) =>
  z.string().trim().min(1, { error: empty }).max(2000, { error: long });

/** Recording a request. The received day may not be in the future (checked by the service). */
export const dataRequestSchema = z.object({
  patientId: z.uuid(),
  kind: z.enum(dataRequestKinds, { error: 'Choose what they ask for.' }),
  receivedOn: calendarDateSchema,
  details: words('Write what they asked for.', 'Keep it under 2,000 characters.'),
});
export type DataRequestInput = z.infer<typeof dataRequestSchema>;

/** Closing a request, done or declined, with what was done or why not. */
export const closeDataRequestSchema = z.object({
  requestId: z.uuid(),
  status: z.enum(['done', 'declined'], { error: 'Choose done or declined.' }),
  outcome: words('Write what was done, or why it was declined.', 'Keep it under 2,000 characters.'),
});
export type CloseDataRequestInput = z.infer<typeof closeDataRequestSchema>;

/** The day a request is due: the received day plus the setting's days. */
export function dataRequestDueOn(receivedOn: string, responseDays: number): string {
  return addDays(receivedOn, responseDays);
}

/** Whether an open request is past its due day on `today` (IST dates). */
export function dataRequestOverdue(
  request: { status: DataRequestStatus; dueOn: string },
  today: string,
): boolean {
  return request.status === 'open' && request.dueOn < today;
}
