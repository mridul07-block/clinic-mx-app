import 'server-only';
import {
  episodeRecord,
  insertQuestionnaireResult,
  liveQuestionnaireLink,
  questionnaireTarget,
  questionnairesAnswered,
  questionnairesDone,
  questionnairesDue,
  type PatientLinkAccess,
  type StaffMember,
} from '@clinic-mx/db';
import {
  answerValues,
  keptAnswers,
  questionnaireSubmissionSchema,
  scoreQuestionnaire,
  type QuestionnaireDefinition,
} from '@clinic-mx/schemas';
import { z } from 'zod';
import { asPatient } from '../access/patient-db';
import { patientService, staffService, type ServiceTransaction } from '../access/service';
import { asStaff } from '../access/staff-db';
import {
  PatientLinkError,
  completePatientLink,
  issuePatientLink,
  patientLinkPath,
  verifyPatientLink,
  type IssuedLink,
} from '../patient-links/services';

/**
 * Patient filled questionnaires (OUT-02; docs/runbooks/questionnaires.md). Until WhatsApp sends
 * them (WA-06) the desk shows the questionnaire link as a QR on the plan and payment sheet; the
 * link opens the plan's questionnaires that can be filled, one after another, one question per
 * screen; our server scores each by its own rule (`scoreQuestionnaire`) and keeps the raw
 * answers, the score and both versions. Recommended defaults chosen under the user's standing
 * approval, 29 October 2026 (DECISION OUT-02).
 */

const episodeInput = z.object({ episodeId: z.guid({ error: 'That episode was not found.' }) });
const episodeCentre = async (input: z.output<typeof episodeInput>, tx: ServiceTransaction) => {
  const found = await episodeRecord(tx, input.episodeId);
  if (!found) throw new PatientLinkError('That episode was not found.');
  return { centreId: found.centreId };
};

/** Show the questionnaire QR for an open episode whose plan has one to fill; audited. */
export const showQuestionnaires = staffService({
  action: 'check_in.manage',
  input: episodeInput,
  target: episodeCentre,
  run: async (tx, input): Promise<IssuedLink> => {
    const target = await questionnaireTarget(tx, input.episodeId);
    if (!target?.fillable) {
      throw new PatientLinkError('None of the plan’s questionnaires can be filled yet.');
    }
    const live = await liveQuestionnaireLink(tx, input.episodeId);
    if (live) {
      const path = patientLinkPath({ ...live, purpose: 'questionnaire' });
      if (!path) throw new PatientLinkError('Patient links are not set up (PATIENT_LINK_SECRET).');
      return { linkId: live.id, path, expiresAt: live.expiresAt };
    }
    return issuePatientLink(tx, {
      patientId: target.patientId,
      episodeId: input.episodeId,
      purpose: 'questionnaire',
    });
  },
});

/**
 * How many questionnaires an open episode's plan names and how many can be filled (the desk);
 * undefined otherwise.
 */
export async function loadQuestionnaireTarget(
  actor: StaffMember,
  episodeId: string,
): Promise<{ assigned: number; fillable: number } | undefined> {
  const target = await asStaff(actor, (tx) => questionnaireTarget(tx, episodeId));
  return target ? { assigned: target.assigned, fillable: target.fillable } : undefined;
}

/** The questionnaire the patient fills next on their link, and where it is among them. */
export interface QuestionnaireStep {
  key: string;
  name: string;
  kbVersionId: string;
  definition: QuestionnaireDefinition;
  /** 1 for the first of the link's questionnaires still to fill. */
  number: number;
  of: number;
}

/**
 * Closes a link with every questionnaire filled that a send did not close: another send at the
 * same time, or the plan or knowledge base changed in between.
 */
const closeFilledLink = patientService({
  input: z.object({}),
  run: async (tx, _input, link) => {
    if (await questionnairesDone(tx, link.id)) await completePatientLink(tx, link);
  },
});

/**
 * What the page's questionnaire link opens next; 'done' once every questionnaire on it is filled
 * (closing it), undefined when there is nothing to fill.
 */
export async function loadQuestionnaireStep(
  link: PatientLinkAccess,
  ip?: string,
): Promise<QuestionnaireStep | 'done' | undefined> {
  const { due, answered } = await asPatient(
    link,
    async (tx) => ({
      due: await questionnairesDue(tx),
      answered: await questionnairesAnswered(tx),
    }),
    ip,
  );
  const [next] = due;
  if (!next) {
    if (answered === 0) return undefined;
    await closeFilledLink(link, {}, ip);
    return 'done';
  }
  return {
    key: next.key,
    name: next.name,
    kbVersionId: next.kbVersionId,
    definition: next.definition,
    number: answered + 1,
    of: answered + due.length,
  };
}

class QuestionnaireClosedError extends Error {
  override name = 'QuestionnaireClosedError';
}

/**
 * The patient's answers to one questionnaire, scored and kept, as the version they were shown; the
 * link closes once every questionnaire on it is filled. Whether it closed.
 */
const fillQuestionnaire = patientService({
  input: questionnaireSubmissionSchema,
  run: async (tx, input, link): Promise<boolean> => {
    const due = await questionnairesDue(tx);
    const filling = due.find((each) => each.key === input.key);
    // Not due, or changed since it was shown: the page shows what is due now.
    if (
      filling?.kbVersionId !== input.kbVersionId ||
      filling.definition.version !== input.version
    ) {
      throw new QuestionnaireClosedError('This questionnaire is no longer open.');
    }
    const kept = keptAnswers(filling.definition, input.answers);
    const scored = scoreQuestionnaire(filling.definition, answerValues(kept));
    await insertQuestionnaireResult(tx, {
      linkId: link.id,
      due: filling,
      rawAnswers: kept,
      score: scored.status === 'scored' ? scored.score : null,
      answered: scored.answered,
      missing: scored.missing,
    });
    if (!(await questionnairesDone(tx, link.id))) return false;
    await completePatientLink(tx, link);
    return true;
  },
});

/**
 * Sends one questionnaire filled on the link behind `token`: 'next' while others remain, 'done'
 * after the last; anything else is the link's own page again.
 */
export async function submitQuestionnaire(
  token: string,
  form: FormData,
  ip?: string,
): Promise<'next' | 'done' | 'link'> {
  const opened = await verifyPatientLink(token);
  if (opened.status === 'used' && opened.purpose === 'questionnaire') return 'done';
  if (opened.status !== 'valid' || opened.link.purpose !== 'questionnaire') return 'link';
  const posted = form.get('answers');
  if (typeof posted !== 'string') return 'link';
  let answers: unknown;
  try {
    answers = JSON.parse(posted);
  } catch {
    return 'link';
  }
  const parsed = questionnaireSubmissionSchema.safeParse({
    key: form.get('key'),
    kbVersionId: form.get('kbVersionId'),
    version: form.get('version'),
    answers,
  });
  if (!parsed.success) return 'link';
  try {
    return (await fillQuestionnaire(opened.link, parsed.data, ip)) ? 'done' : 'next';
  } catch (error) {
    if (error instanceof QuestionnaireClosedError || error instanceof PatientLinkError) {
      return 'link';
    }
    // Sent twice at once: the other send stands (unique, 23505) or closed the link (42501).
    const code =
      (error as { cause?: { code?: string } }).cause?.code ?? (error as { code?: string }).code;
    if (code === '23505' || code === '42501') return 'link';
    throw error;
  }
}
