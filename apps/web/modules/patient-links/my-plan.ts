import 'server-only';
import {
  episodeHasPlan,
  episodeRecord,
  exerciseTickSubject,
  tickExercise,
  untickExercise,
  liveMyPlanLink,
  myPlanView,
  type PatientLinkAccess,
} from '@clinic-mx/db';
import { exerciseTickInputSchema, myPlanSchema, type MyPlan } from '@clinic-mx/schemas';
import { z } from 'zod';
import { asPatient } from '../access/patient-db';
import { patientService, staffService } from '../access/service';
import {
  PatientLinkError,
  issuePatientLink,
  patientLinkPath,
  verifyPatientLink,
  type IssuedLink,
} from './services';

/**
 * My plan (PAT-01, in part; docs/runbooks/my-plan.md). The patient's page reads its own episode
 * through `internal.my_plan()`, as the patient behind the link. Until WhatsApp sends the link, the
 * front desk shows it as a QR from the plan and payment sheet (recommended default chosen under
 * the user's standing approval, 28 October 2026): the episode's working link, or a new one.
 */

/** The page's content for an opened My plan link; null when the link no longer reaches one. */
export async function loadMyPlan(link: PatientLinkAccess, ip?: string): Promise<MyPlan | null> {
  const raw = await asPatient(link, (tx) => myPlanView(tx), ip);
  return raw === null ? null : myPlanSchema.parse(raw);
}

/** Show My plan QR: the episode's working My plan link, issued when it has none; audited. */
export const showMyPlan = staffService({
  action: 'check_in.manage',
  input: z.object({ episodeId: z.guid({ error: 'That episode was not found.' }) }),
  target: async (input, tx) => {
    const found = await episodeRecord(tx, input.episodeId);
    if (!found) throw new PatientLinkError('That episode was not found.');
    return { centreId: found.centreId };
  },
  run: async (tx, input): Promise<IssuedLink> => {
    const found = await episodeRecord(tx, input.episodeId);
    if (!found) throw new PatientLinkError('That episode was not found.');
    if (found.status === 'discharged') {
      throw new PatientLinkError('The episode is discharged; its maintenance page comes later.');
    }
    if (!(await episodeHasPlan(tx, input.episodeId))) {
      throw new PatientLinkError('My plan opens once the consultation’s plan is signed.');
    }
    const live = await liveMyPlanLink(tx, input.episodeId);
    if (live) {
      const path = patientLinkPath({ id: live.id, purpose: 'my_plan', expiresAt: live.expiresAt });
      if (!path) throw new PatientLinkError('Patient links are not set up (PATIENT_LINK_SECRET).');
      return { linkId: live.id, path, expiresAt: live.expiresAt };
    }
    return issuePatientLink(tx, {
      patientId: found.patientId,
      episodeId: input.episodeId,
      purpose: 'my_plan',
    });
  },
});

/**
 * A tick or an untick of a home programme row (PAT-02), for today in IST, on the newest plan as it
 * reads now; audited as the patient. The My plan link stays open: it is not used up by ticking.
 */
const tick = patientService({
  input: exerciseTickInputSchema,
  run: async (tx, input, link): Promise<'done' | 'changed'> => {
    const subject = await exerciseTickSubject(tx);
    if (subject?.homeProgramme[input.index]?.exercise !== input.exercise) return 'changed';
    if (input.done) {
      await tickExercise(tx, {
        linkId: link.id,
        subject,
        index: input.index,
        exercise: input.exercise,
      });
    } else {
      await untickExercise(tx, { subject, index: input.index });
    }
    return 'done';
  },
});

/**
 * Ticks (or unticks) an exercise for the My plan link behind `token`: "done", "changed" when the
 * plan changed under the page, or "link" when the link no longer opens My plan.
 */
export async function tickMyPlanExercise(
  token: string,
  form: { index: unknown; exercise: unknown; done: unknown },
  ip?: string,
): Promise<'done' | 'changed' | 'link'> {
  const opened = await verifyPatientLink(token);
  if (opened.status !== 'valid' || opened.link.purpose !== 'my_plan') return 'link';
  const parsed = exerciseTickInputSchema.safeParse(form);
  if (!parsed.success) return 'changed';
  return tick(opened.link, form, ip);
}
