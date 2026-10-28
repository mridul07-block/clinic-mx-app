import {
  answerText,
  visibleFields,
  visibleScreens,
  type HealthFormAnswers,
  type HealthFormDefinition,
} from '@clinic-mx/schemas';
import Link from 'next/link';
import { submitAction } from '../../../../modules/intake/actions';
import { patientPrimaryClass, patientSecondaryClass } from './patient-ui';

// Check and submit (INT-05, PRD J2.3): every screen shown, its answers read back with Change to
// go back to it, then Submit. A plain form post, so it works without scripts; after it the link
// is used and its page thanks the patient. A returning patient's answer to "Has anything
// changed?" (INT-08) shows after Part A, and may be changed until submit.

export function CheckAndSubmit({
  token,
  form,
  answers,
  reports,
  backHref,
  detailsChanged,
}: {
  token: string;
  form: HealthFormDefinition;
  answers: HealthFormAnswers;
  /** Report photos added on History. */
  reports: number;
  backHref: string;
  /** A returning patient's answer (INT-08); undefined for a first form. */
  detailsChanged?: boolean | null;
}) {
  const here = `/p/${token}`;
  return (
    <>
      <h1 className="text-xl font-semibold text-ink">Check and submit</h1>
      <p className="text-ink">Check your answers, then submit them.</p>
      <div className="flex flex-col gap-4 pb-28" data-testid="check-submit">
        {visibleScreens(form, answers).map((screen) => [
          <section
            key={screen.key}
            aria-labelledby={`${screen.key}-answers`}
            className="flex flex-col gap-3 rounded-panel border border-line p-4"
            data-check={screen.key}
          >
            <div className="flex items-center justify-between gap-3">
              <h2 id={`${screen.key}-answers`} className="font-semibold text-ink">
                {screen.title}
              </h2>
              {screen.consent ? null : (
                <Link
                  href={`${here}?screen=${screen.key}`}
                  className="inline-flex min-h-12 items-center px-2 font-medium text-accent underline"
                  aria-label={`Change ${screen.title}`}
                >
                  Change
                </Link>
              )}
            </div>
            {screen.consent ? (
              <p className="text-ink">Agreed and signed</p>
            ) : (
              <dl className="flex flex-col gap-2">
                {visibleFields(screen, answers).map((field) => {
                  const answer = answers[field.key];
                  return (
                    <div key={field.key} className="flex flex-col">
                      <dt className="text-sm text-ink-secondary">{field.label}</dt>
                      <dd className={answer === undefined ? 'text-ink-secondary' : 'text-ink'}>
                        {answer === undefined ? 'Not answered' : answerText(field, answer)}
                      </dd>
                    </div>
                  );
                })}
                {screen.reports ? (
                  <div className="flex flex-col">
                    <dt className="text-sm text-ink-secondary">Report photos</dt>
                    <dd className={reports > 0 ? 'text-ink' : 'text-ink-secondary'}>
                      {reports > 0 ? `${String(reports)} added` : 'None added'}
                    </dd>
                  </div>
                ) : null}
              </dl>
            )}
          </section>,
          screen.consent && detailsChanged !== undefined ? (
            <section
              key={`${screen.key}-changes`}
              aria-labelledby="changes-answers"
              className="flex flex-col gap-3 rounded-panel border border-line p-4"
              data-check="changes"
            >
              <div className="flex items-center justify-between gap-3">
                <h2 id="changes-answers" className="font-semibold text-ink">
                  Has anything changed?
                </h2>
                <Link
                  href={`${here}?screen=changes`}
                  className="inline-flex min-h-12 items-center px-2 font-medium text-accent underline"
                  aria-label="Change your answer to Has anything changed?"
                >
                  Change
                </Link>
              </div>
              <p className="text-ink">
                {detailsChanged === null
                  ? 'Not answered'
                  : detailsChanged
                    ? 'Something changed'
                    : 'No changes'}
              </p>
            </section>
          ) : null,
        ])}
      </div>
      <form
        action={submitAction}
        className="fixed inset-x-0 bottom-0 border-t border-line bg-surface px-4 py-3"
      >
        <input type="hidden" name="token" value={token} />
        <div className="mx-auto flex w-full max-w-signin gap-3">
          <Link href={backHref} className={patientSecondaryClass}>
            Back
          </Link>
          <button type="submit" className={patientPrimaryClass}>
            Submit
          </button>
        </div>
      </form>
    </>
  );
}
