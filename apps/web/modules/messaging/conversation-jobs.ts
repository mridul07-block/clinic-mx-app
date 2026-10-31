import 'server-only';
import { BOOKING_CONFIRMATION_JOB, defineJob, type JobHandlers } from '@clinic-mx/db';
import { z } from 'zod';
import { sendBookingConfirmation } from './clinic-messages';
import { WHATSAPP_SEND_JOB, sendQueuedMessage } from './send';

/**
 * The jobs of a WhatsApp conversation, run by the tick and also straight after a message to us
 * (`send-now.ts`), kept apart so the webhook does not load every job's code.
 */
export const conversationJobs: JobHandlers = {
  /**
   * Sends one WhatsApp message (WA-01), queued with its row by the `message_queue_send` trigger.
   * A failure Meta may get over is thrown, so the queue tries again with its backoff.
   */
  [WHATSAPP_SEND_JOB]: defineJob({
    payload: z.object({ messageId: z.guid() }),
    run: ({ messageId }, { db, job }) =>
      sendQueuedMessage(db, messageId, { attempt: job.attempts }),
  }),
  /**
   * The booking confirmation (WA-07), queued by the database for every booking not in a plan
   * series: the same text for WhatsApp and the clinic's bookings.
   */
  [BOOKING_CONFIRMATION_JOB]: defineJob({
    payload: z.object({ appointmentId: z.guid() }),
    run: async ({ appointmentId }, { db, job }) => {
      await sendBookingConfirmation(db, {
        sourceKey: job.idempotencyKey ?? [job.kind, job.id].join(':'),
        appointmentId,
        now: new Date(),
      });
    },
  }),
};
