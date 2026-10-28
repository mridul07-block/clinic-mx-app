import {
  answerText,
  pruneAnswers,
  readAnswer,
  visibleFields,
  visibleScreens,
  type HealthFormAnswer,
  type HealthFormAnswers,
  type HealthFormDefinition,
  type ParseContext,
} from './health-form';

/**
 * A returning patient's health form (INT-08, PRD J2.8: "Returning patients get prefilled details
 * with 'Has anything changed?'"). Recommended defaults chosen under the user's standing approval,
 * 28 October 2026: the details that stay with a person carry over from their latest submitted form
 * (about you, activity, history); what belongs to today's problem or to safety is asked again every
 * time: the problem, the warning signs (red flag rules), the health check (precautions; PRD J2.4
 * "mandatory") and the goals. After Part A the patient sees the details and answers "Has anything
 * changed?": No changes keeps them and skips the screens they fill; Something changed opens those
 * screens filled in, to change. Pure: the page and the services decide with these.
 */

/** The fields carried over from an earlier form, by key. */
export const carriedFieldKeys: readonly string[] = [
  'date_of_birth',
  'sex',
  'occupation',
  'dominant_side',
  'activities',
  'activity_other',
  'activity_level',
  'activity_hours',
  'injuries',
  'surgeries',
  'investigations',
];

const carried = new Set(carriedFieldKeys);

/** The page between Part A and the questions where a returning patient answers the review. */
export const HEALTH_FORM_CHANGES = 'changes';

/**
 * The details to carry over: the earlier form's answers to the carried fields this form still
 * asks, each read again as if posted today (an answer the field would refuse is dropped), with what
 * is on the patient record winning (INT-05: About you starts from the record). Empty when the
 * earlier form gives nothing, and then the patient is not treated as returning.
 */
export function carriedDetails(
  form: HealthFormDefinition,
  earlier: HealthFormAnswers,
  onFile: HealthFormAnswers,
  context: ParseContext,
): Record<string, HealthFormAnswer> {
  const read = (from: HealthFormAnswers) => {
    const kept: Record<string, HealthFormAnswer> = {};
    for (const screen of form.screens) {
      for (const field of screen.fields) {
        const given = carried.has(field.key) ? from[field.key] : undefined;
        const answer = given === undefined ? undefined : readAnswer(field, given, context);
        if (answer !== undefined) kept[field.key] = answer;
      }
    }
    return kept;
  };
  const fromForm = pruneAnswers(form, read(earlier));
  if (Object.keys(fromForm).length === 0) return {};
  return pruneAnswers(form, { ...fromForm, ...read(onFile) });
}

/** Every field of a screen is a carried one: No changes may fill it all (About you, History). */
function whollyCarried(screen: HealthFormDefinition['screens'][number]): boolean {
  return screen.fields.length > 0 && screen.fields.every((field) => carried.has(field.key));
}

/**
 * For a returning patient, the review is due once Part A is done and until answered: no other
 * screen is saved, and the form is not submitted, until then.
 */
export function detailsReviewDue(
  form: HealthFormDefinition,
  detailsChanged: boolean | null,
  done: readonly string[],
): boolean {
  return (
    detailsChanged === null &&
    form.screens.filter((screen) => screen.consent).every((screen) => done.includes(screen.key))
  );
}

/**
 * No changes: the details join the answers on the screens the patient has not sent in this form
 * (a screen they sent is theirs, a field they cleared included), and each screen that holds only
 * carried fields, all it needs answered, counts as sent.
 */
export function carryOver(
  form: HealthFormDefinition,
  answers: HealthFormAnswers,
  done: readonly string[],
  details: HealthFormAnswers,
): { answers: Record<string, HealthFormAnswer>; doneScreens: string[] } {
  const sent = new Set(
    form.screens
      .filter((screen) => done.includes(screen.key))
      .flatMap((screen) => screen.fields.map((field) => field.key)),
  );
  const open = Object.fromEntries(Object.entries(details).filter(([key]) => !sent.has(key)));
  const merged = pruneAnswers(form, { ...open, ...answers });
  const filled = visibleScreens(form, merged)
    .filter(
      (screen) =>
        !done.includes(screen.key) &&
        whollyCarried(screen) &&
        visibleFields(screen, merged).every(
          (field) => field.optional || merged[field.key] !== undefined,
        ),
    )
    .map((screen) => screen.key);
  return { answers: merged, doneScreens: [...new Set([...done, ...filled])] };
}

const same = (a: HealthFormAnswer | undefined, b: HealthFormAnswer | undefined) =>
  JSON.stringify(a) === JSON.stringify(b);

/**
 * Something changed, after No changes: the screens No changes filled, still exactly as carried,
 * are to be sent again, so the patient goes through them filled in. A screen the patient has
 * changed since stays sent: it is theirs.
 */
export function uncarry(
  form: HealthFormDefinition,
  answers: HealthFormAnswers,
  done: readonly string[],
  details: HealthFormAnswers,
): string[] {
  const filled = new Set(
    form.screens
      .filter(
        (screen) =>
          whollyCarried(screen) &&
          screen.fields.every((field) => same(answers[field.key], details[field.key])),
      )
      .map((screen) => screen.key),
  );
  return done.filter((key) => !filled.has(key));
}

/** The details as the review lists them: by screen, each answer in the form's words. */
export function detailsShown(
  form: HealthFormDefinition,
  details: HealthFormAnswers,
): { title: string; items: { key: string; label: string; text: string }[] }[] {
  return visibleScreens(form, details)
    .map((screen) => ({
      title: screen.title,
      items: visibleFields(screen, details).flatMap((field) => {
        const answer = carried.has(field.key) ? details[field.key] : undefined;
        return answer === undefined
          ? []
          : [{ key: field.key, label: field.label, text: answerText(field, answer) }];
      }),
    }))
    .filter((group) => group.items.length > 0);
}
