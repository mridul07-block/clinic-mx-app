import {
  episodeStatusLabels,
  formatIstDate,
  formatRupees,
  planSheetQuerySchema,
} from '@clinic-mx/schemas';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { z } from 'zod';
import { secondaryButtonClass } from '../../../../../../components/forms';
import { Tag } from '../../../../../../components/tag';
import { requirePermission } from '../../../../../../modules/access/require-permission';
import { planSheetOf } from '../../../../../../modules/billing/plan-sheet';

export const metadata: Metadata = { title: 'Plan and payment · Clinic Mx' };

const amount = 'tabular-nums text-right whitespace-nowrap';

/**
 * The plan and payment sheet (BIL-01, PRD J4.2, Frontend Specification section 7): for the front
 * desk, the recommended plan read only and what it costs per session or as a package. The session
 * type is chosen with a plain form, so the sheet works without scripts. The patient's choice,
 * Part B consent, the bill and payment come with BIL-02 onwards.
 */
export default async function PlanSheetPage({
  params,
  searchParams,
}: {
  params: Promise<{ episodeId: string }>;
  searchParams: Promise<{ session?: string | string[] }>;
}) {
  const staff = await requirePermission('bills.view_amounts');
  const { episodeId } = await params;
  if (!z.guid().safeParse(episodeId).success) notFound();
  const query = planSheetQuerySchema.parse(await searchParams);
  const sheet = await planSheetOf(staff, episodeId, query.session);
  if (!sheet) notFound();
  const { plan, options } = sheet;

  return (
    <main className="flex w-full max-w-signin flex-col gap-6 px-4 py-6">
      <div className="flex flex-col gap-1.5">
        <Link
          href={`/app/patients/${sheet.patientId}`}
          className="text-sm text-ink-muted underline underline-offset-2"
        >
          {sheet.patientName}
        </Link>
        <h1 className="text-title font-semibold">Plan and payment</h1>
        <p className="flex flex-wrap items-center gap-2 text-sm text-ink-secondary">
          <span className="font-mono text-ink">{sheet.opNumber}</span>
          {sheet.centreName ? <span>· {sheet.centreName}</span> : null}
          <Tag tone="outline">{episodeStatusLabels[sheet.episodeStatus]}</Tag>
        </p>
      </div>

      {!plan ? (
        <p className="text-ink-muted" data-testid="no-plan">
          No plan yet. The plan appears here once the consultation is signed.
        </p>
      ) : (
        <>
          <section aria-labelledby="plan" className="flex flex-col gap-2">
            <h2 id="plan" className="font-semibold text-ink">
              Recommended plan
            </h2>
            <dl
              data-testid="recommended-plan"
              className="grid grid-cols-[minmax(0,10rem)_1fr] gap-x-3 gap-y-1.5 text-sm"
            >
              <dt className="text-ink-secondary">Frequency</dt>
              <dd>
                {plan.sessionsPerWeek !== null && plan.weeks !== null
                  ? `${String(plan.sessionsPerWeek)} a week for ${String(plan.weeks)} weeks`
                  : 'Not set in the plan'}
              </dd>
              <dt className="text-ink-secondary">Planned sessions</dt>
              <dd className="tabular-nums">
                {options?.plannedSessions ?? 'Not known until the frequency is set'}
              </dd>
              <dt className="text-ink-secondary">Modalities</dt>
              <dd>{plan.modalities.map((m) => m.name).join(', ') || 'None'}</dd>
              <dt className="text-ink-secondary">Treating physio</dt>
              <dd>{plan.treatingPhysio ?? 'Not set'}</dd>
              <dt className="text-ink-secondary">Review date</dt>
              <dd>{formatIstDate(plan.reviewDate)}</dd>
            </dl>
            <p className="text-sm text-ink-muted">Read only: the consultant sets the plan.</p>
          </section>

          {sheet.sessionItems.length > 1 ? (
            <form method="get" className="flex flex-col gap-2" data-testid="session-type">
              <fieldset className="flex flex-col gap-1">
                <legend className="mb-1 font-semibold text-ink">Session type</legend>
                {sheet.sessionItems.map((item) => (
                  <label key={item.key} className="flex min-h-11 items-center gap-3">
                    <input
                      type="radio"
                      name="session"
                      value={item.key}
                      defaultChecked={item.key === options?.perSession.item.key}
                      className="size-4 shrink-0 accent-accent"
                    />
                    <span className="flex-1">{item.label}</span>
                    <span className={amount}>{formatRupees(item.amountPaise)}</span>
                  </label>
                ))}
              </fieldset>
              <button type="submit" className={`${secondaryButtonClass} sm:w-auto sm:self-start`}>
                Update
              </button>
            </form>
          ) : null}

          {options ? (
            <section
              aria-labelledby="per-session"
              className="flex flex-col gap-2"
              data-testid="per-session"
            >
              <h2 id="per-session" className="font-semibold text-ink">
                Pay per session
              </h2>
              <div className="flex items-baseline justify-between gap-3 rounded-panel border border-line bg-surface p-3">
                <span className="text-sm text-ink-secondary">
                  {options.plannedSessions !== null
                    ? `${String(options.plannedSessions)} sessions × ${formatRupees(options.perSession.item.amountPaise)}`
                    : `${options.perSession.item.label}, per session`}
                </span>
                <span className={`${amount} text-lg font-semibold text-ink`}>
                  {formatRupees(
                    options.perSession.totalPaise ?? options.perSession.item.amountPaise,
                  )}
                </span>
              </div>
              {options.modalities.length > 0 ? (
                <ul className="flex flex-col gap-1 text-sm" data-testid="modality-prices">
                  {options.modalities.map((modality) => (
                    <li key={modality.name} className="flex justify-between gap-3">
                      <span>{modality.name}</span>
                      <span className={amount}>
                        {modality.perUsePaise === null
                          ? 'Price not set'
                          : `${formatRupees(modality.perUsePaise)} per use`}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : null}
            </section>
          ) : (
            <p className="text-ink-muted">
              No session price is set up yet. Finance adds the session items on Prices.
            </p>
          )}

          {options ? (
            <section aria-labelledby="packages" className="flex flex-col gap-2">
              <h2 id="packages" className="font-semibold text-ink">
                Packages
              </h2>
              {options.packages.length === 0 ? (
                <p className="text-sm text-ink-muted" data-testid="no-packages">
                  No packages set up yet. Finance adds them on Prices.
                </p>
              ) : (
                <ul className="flex flex-col gap-2" data-testid="package-options">
                  {options.packages.map((offer) => (
                    <li
                      key={offer.id}
                      data-testid="package-option"
                      className="flex flex-col gap-1 rounded-panel border border-line bg-surface p-3"
                    >
                      <span className="flex items-baseline justify-between gap-3">
                        <span className="font-medium text-ink">{offer.name}</span>
                        <span className={`${amount} font-semibold text-ink`}>
                          {formatRupees(offer.pricePaise)}
                        </span>
                      </span>
                      <span className="text-sm text-ink-secondary">
                        {offer.sessions} sessions · {formatRupees(offer.perSessionPaise)} a session
                      </span>
                      <span className="text-sm text-ink-secondary">{offer.cover}</span>
                      <span className="text-sm text-ink-muted">{offer.validity}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ) : null}

          <p className="text-sm text-ink-muted">
            Prices come from the price master and cannot be changed here. The patient’s choice,
            consent and payment come next.
          </p>
        </>
      )}
    </main>
  );
}
