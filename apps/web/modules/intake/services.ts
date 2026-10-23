import 'server-only';
import { healthFormVisit, ownIntakeResponse, saveIntakeResponse } from '@clinic-mx/db';
import {
  canOpen,
  healthFormOpen,
  nextScreen,
  parseScreen,
  pruneAnswers,
  resumeAt,
  visibleScreens,
  type HealthFormAnswer,
} from '@clinic-mx/schemas';
import { z } from 'zod';
import { patientService } from '../access/service';
import { verifyPatientLink } from '../patient-links/services';
import { formFor } from './visit';

/**
 * Saving the health form after each screen (INT-04, Frontend Specification §7: "progress saved
 * after every screen; leaving and returning resumes in place"). The link is checked first, then
 * one patient transaction: the visit must be on, the screen shown and reachable, every shown
 * field answered; answers a change has hidden are dropped. A saved form keeps its version.
 */
export type SaveScreenResult =
  | { status: 'saved'; next: string }
  | { status: 'invalid'; errors: Record<string, string> }
  /** Not this screen yet: carry on where the form stands. */
  | { status: 'elsewhere'; resume: string }
  /** The visit is not on (INT-03). */
  | { status: 'closed' }
  /** The link is not a working health form link; its page says why. */
  | { status: 'link' };

const saveScreenSchema = z.object({
  screen: z.string().min(1).max(40),
  posted: z.record(z.string(), z.union([z.string(), z.array(z.string())])),
});

const saveScreen = patientService({
  input: saveScreenSchema,
  run: async (tx, { screen: key, posted }, link): Promise<SaveScreenResult> => {
    const visit = await healthFormVisit(tx);
    if (!visit || !healthFormOpen(visit.status)) return { status: 'closed' };
    const saved = await ownIntakeResponse(tx);
    const form = formFor(saved?.formVersion);
    const answers = saved?.answers ?? {};
    const done = saved?.doneScreens ?? [];
    const screen = visibleScreens(form, answers).find((s) => s.key === key);
    if (!screen || !canOpen(form, answers, done, key)) {
      return { status: 'elsewhere', resume: resumeAt(form, answers, done) };
    }
    const parsed = parseScreen(screen, answers, posted);
    if (!parsed.ok) return { status: 'invalid', errors: parsed.errors };
    const here = new Set(screen.fields.map((field) => field.key));
    const kept: Record<string, HealthFormAnswer> = Object.fromEntries(
      Object.entries(answers).filter(([field]) => !here.has(field)),
    );
    const next = pruneAnswers(form, { ...kept, ...parsed.answers });
    const shown = new Set(visibleScreens(form, next).map((s) => s.key));
    await saveIntakeResponse(tx, {
      appointmentId: visit.appointmentId,
      patientId: link.patientId,
      patientLinkId: link.id,
      formVersion: form.version,
      answers: next,
      doneScreens: [...new Set([...done, key])].filter((sent) => shown.has(sent)),
    });
    return { status: 'saved', next: nextScreen(form, next, key) };
  },
});

/** Saves one screen of the health form behind `token`, as posted. */
export async function saveHealthFormScreen(
  token: string,
  screen: string,
  posted: Record<string, string | string[]>,
  ip?: string,
): Promise<SaveScreenResult> {
  const opened = await verifyPatientLink(token);
  if (opened.status !== 'valid' || opened.link.purpose !== 'health_form') return { status: 'link' };
  return saveScreen(opened.link, { screen, posted }, ip);
}
