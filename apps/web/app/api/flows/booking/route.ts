import { appDb } from '../../../../lib/db';
import { bookingFlowStep } from '../../../../modules/messaging/booking-flow';
import { flowEndpoint } from '../../../../modules/messaging/flow-endpoint';
import { sendFlowMessagesNow } from '../../../../modules/messaging/send-now';

// The booking Flow's data endpoint (WA-04; docs/runbooks/whatsapp.md): signed, sealed and limited
// as every Flow endpoint (`flowEndpoint`); each screen is the booking Flow's. A booking's
// confirmation is sent straight after the screen that made it.
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

export const POST = flowEndpoint(
  (request) => bookingFlowStep(appDb(), request),
  (flowToken) => sendFlowMessagesNow(appDb(), flowToken),
);
