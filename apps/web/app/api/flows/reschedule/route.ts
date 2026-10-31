import { appDb } from '../../../../lib/db';
import { flowEndpoint } from '../../../../modules/messaging/flow-endpoint';
import { rescheduleFlowStep } from '../../../../modules/messaging/reschedule-flow';
import { sendFlowMessagesNow } from '../../../../modules/messaging/send-now';

// The reschedule Flow's data endpoint (WA-05; docs/runbooks/whatsapp.md): signed, sealed and
// limited as every Flow endpoint (`flowEndpoint`); each screen is the reschedule Flow's. The moved
// appointment's confirmation is sent straight after the screen that moved it.
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

export const POST = flowEndpoint(
  (request) => rescheduleFlowStep(appDb(), request),
  (flowToken) => sendFlowMessagesNow(appDb(), flowToken),
);
