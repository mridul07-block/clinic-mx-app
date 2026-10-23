import {
  INTAKE_SUBMITTED_JOB,
  NO_SHOW_MESSAGE_JOB,
  defineJob,
  type JobHandlers,
} from '@clinic-mx/db';
import { z } from 'zod';
import { AI_PREPARATION_SHEET_JOB, processIntakeSubmission } from '../intake/pipeline';

/**
 * Every job kind the tick can run (TAD section 8). Each ticket that adds a job adds its handler
 * here; handlers must be safe to run twice, because a job may run again after a crash.
 */
export const jobHandlers: JobHandlers = {
  /** Does nothing: proves the queue end to end on an environment (docs/runbooks/jobs.md). */
  'system.ping': { payload: z.object({}), run: () => Promise.resolve() },
  /** A submitted health form's pipeline (INT-10); a form already done is left as it is. */
  [INTAKE_SUBMITTED_JOB]: defineJob({
    payload: z.object({ appointmentId: z.guid() }),
    run: async ({ appointmentId }) => {
      await processIntakeSubmission(appointmentId);
    },
  }),
  /**
   * The AI preparation sheet (INT-10 queues it on submit). Nothing runs yet: the AI gateway and
   * the sheet come with AI-01 to AI-03, and AI-09 switches them on after the blind test and the
   * legal check (PRD decision 23). Until then the job completes without calling any model.
   */
  [AI_PREPARATION_SHEET_JOB]: defineJob({
    payload: z.object({ episodeId: z.guid() }),
    run: () => Promise.resolve(),
  }),
  /**
   * The no show WhatsApp message (ALT-04, PRD J5.12), queued by the database when an appointment
   * becomes No show. Nothing is sent yet: the WhatsApp tickets (WA-01 onwards) fill this in, and
   * the sender must first check the appointment is still a no show (an undone one gets nothing),
   * then send the `no_show` template. Until then the job completes without sending.
   */
  [NO_SHOW_MESSAGE_JOB]: defineJob({
    payload: z.object({ appointmentId: z.guid() }),
    run: () => Promise.resolve(),
  }),
};
