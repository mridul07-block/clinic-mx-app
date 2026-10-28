import Link from 'next/link';
import { reviewDetailsAction } from '../../../../modules/intake/actions';
import { patientPrimaryClass, patientSecondaryClass } from './patient-ui';

// "Has anything changed?" (INT-08, PRD J2.8): after Part A a returning patient sees the details
// carried over from their last form and answers. No changes keeps them and goes on to today's
// problem; Something changed opens those screens filled in, to change. A plain form post, so it
// works without scripts. Wording awaits the client's approval of patient wording, as the screens.

export function ChangesReview({
  token,
  submittedOn,
  details,
  answered,
  backHref,
}: {
  token: string;
  submittedOn: string;
  details: { title: string; items: { key: string; label: string; text: string }[] }[];
  /** The answer so far, when the patient comes back to change it. */
  answered: boolean | null;
  /** Back to Part A. */
  backHref: string;
}) {
  return (
    <>
      <h1 className="text-xl font-semibold text-ink">Has anything changed?</h1>
      <p className="text-ink">
        These details are from your form on {submittedOn}. Tell us if anything is different now.
      </p>
      {answered === null ? null : (
        <p className="text-ink-secondary" data-testid="changes-answered">
          You said: {answered ? 'Something changed' : 'No changes'}
        </p>
      )}
      <div className="flex flex-col gap-4 pb-44" data-testid="changes-review">
        {details.map((group) => (
          <section
            key={group.title}
            aria-label={group.title}
            className="flex flex-col gap-3 rounded-panel border border-line p-4"
          >
            <h2 className="font-semibold text-ink">{group.title}</h2>
            <dl className="flex flex-col gap-2">
              {group.items.map((item) => (
                <div key={item.key} className="flex flex-col" data-detail={item.key}>
                  <dt className="text-sm text-ink-secondary">{item.label}</dt>
                  <dd className="break-words text-ink">{item.text}</dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
      <form
        action={reviewDetailsAction}
        className="fixed inset-x-0 bottom-0 border-t border-line bg-surface px-4 py-3"
      >
        <input type="hidden" name="token" value={token} />
        <div className="mx-auto grid w-full max-w-signin gap-3">
          <button type="submit" name="changed" value="no" className={patientPrimaryClass}>
            No changes
          </button>
          <div className="flex gap-3">
            <Link href={backHref} className={patientSecondaryClass}>
              Back
            </Link>
            <button
              type="submit"
              name="changed"
              value="yes"
              className={`${patientSecondaryClass} flex-1`}
            >
              Something changed
            </button>
          </div>
        </div>
      </form>
    </>
  );
}
