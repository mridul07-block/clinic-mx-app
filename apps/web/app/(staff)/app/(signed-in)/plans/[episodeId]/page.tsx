import type { BillEntry, PlanChoiceEntry } from '@clinic-mx/db';
import {
  billKindLabels,
  billStatusLabels,
  can,
  documentDate,
  documentDateTime,
  documentTime,
  episodeStatusLabels,
  formatIstDate,
  formatRupees,
  paymentMethodLabels,
  planChoiceLabels,
  planSheetQuerySchema,
} from '@clinic-mx/schemas';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { z } from 'zod';
import { secondaryButtonClass } from '../../../../../../components/forms';
import { PackageMeter } from '../../../../../../components/package-meter';
import { Tag } from '../../../../../../components/tag';
import { requirePermission } from '../../../../../../modules/access/require-permission';
import { planSheetOf, type PlanSheet } from '../../../../../../modules/billing/plan-sheet';
import {
  planSessionsOf,
  type PlanSessionsView,
} from '../../../../../../modules/scheduling/plan-sessions';
import { DiscountForm, RemoveDiscountForm } from './discount-forms';
import { MakeBillForm } from './make-bill-form';
import { PaymentForm, UndoPaymentForm } from './payment-forms';
import { PlanChoiceForm, type ChoiceOption } from './plan-choice-form';
import { PlanSessionsForm } from './plan-sessions-form';

export const metadata: Metadata = { title: 'Plan and payment · Clinic Mx' };

const amount = 'tabular-nums text-right whitespace-nowrap';

const billTones = { unpaid: 'waiting', paid: 'done', cancelled: 'neutral' } as const;

/**
 * One bill: its number, what it is for, its lines at the price master's amounts with any discount
 * (BIL-07), its total.
 */
function BillCard({
  entry,
  episodeId,
  canCollect,
  discounts,
}: {
  entry: BillEntry;
  episodeId: string;
  canCollect: boolean;
  discounts: PlanSheet['discounts'];
}) {
  const cancelled = entry.status === 'cancelled';
  const unpaid = entry.status === 'unpaid';
  return (
    <li
      data-testid="bill"
      className="flex flex-col gap-2 rounded-panel border border-line bg-surface p-3"
    >
      <span className="flex flex-wrap items-center justify-between gap-2">
        <span className="flex flex-col">
          <span className="font-mono text-sm text-ink">{entry.number}</span>
          <span className="text-sm text-ink-secondary">{billKindLabels[entry.kind]}</span>
        </span>
        <Tag tone={billTones[entry.status]}>{billStatusLabels[entry.status]}</Tag>
      </span>
      <ul className="flex flex-col gap-1 text-sm">
        {entry.lines.map((line) => {
          const off = line.discount;
          // Finance's Other discount stays with Finance; a preset is the desk's too.
          const changes = unpaid && (off?.presetId === null ? discounts.other : discounts.preset);
          return (
            <li key={line.id} className="flex flex-col gap-1">
              <span className="flex justify-between gap-3">
                <span>
                  {line.description}
                  {line.quantity > 1
                    ? ` · ${String(line.quantity)} × ${formatRupees(line.unitPaise)}`
                    : null}
                </span>
                <span className={amount}>{formatRupees(line.amountPaise)}</span>
              </span>
              {off ? (
                <span className="flex flex-col" data-testid="bill-discount">
                  <span className="flex justify-between gap-3 text-ink-secondary">
                    <span>
                      Less: {off.name}
                      {off.percent === null ? null : ` (${String(off.percent)}%)`}
                    </span>
                    <span className={amount}>{formatRupees(-off.paise)}</span>
                  </span>
                  <span className="text-ink-muted">
                    {[off.reason, off.byName ? `By ${off.byName}` : null, documentDateTime(off.at)]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                </span>
              ) : null}
              {changes ? (
                <>
                  <DiscountForm
                    episodeId={episodeId}
                    lineId={line.id}
                    presets={discounts.presets}
                    other={discounts.other}
                    replacing={off !== null}
                  />
                  {off ? <RemoveDiscountForm episodeId={episodeId} lineId={line.id} /> : null}
                </>
              ) : null}
            </li>
          );
        })}
      </ul>
      <span className="flex justify-between gap-3 border-t border-line pt-2">
        <span className="font-medium text-ink">Total</span>
        <span className={`${amount} font-semibold text-ink ${cancelled ? 'line-through' : ''}`}>
          {formatRupees(entry.totalPaise)}
        </span>
      </span>
      {cancelled && entry.cancelReason ? (
        <span className="text-sm text-ink-muted">{entry.cancelReason}</span>
      ) : null}
      {entry.payment ? (
        <span className="flex flex-col gap-0.5 text-sm text-ink-secondary" data-testid="paid">
          <span>
            Paid by {paymentMethodLabels[entry.payment.method]}
            {entry.payment.reference ? (
              <>
                {' · Ref '}
                <span className="font-mono">{entry.payment.reference}</span>
              </>
            ) : null}
          </span>
          <span>
            Recorded by {entry.payment.recordedByName ?? 'a former staff member'},{' '}
            {documentDateTime(entry.payment.recordedAt)}
          </span>
          {entry.payment.invoiceNumber ? (
            entry.payment.invoiceDocumentId ? (
              <Link
                href={`/app/documents/${entry.payment.invoiceDocumentId}`}
                className="underline underline-offset-2"
                data-testid="invoice-link"
              >
                Invoice <span className="font-mono">{entry.payment.invoiceNumber}</span> (PDF)
              </Link>
            ) : (
              <span data-testid="invoice-pending">
                Invoice <span className="font-mono">{entry.payment.invoiceNumber}</span> is being
                made.
              </span>
            )
          ) : null}
        </span>
      ) : null}
      {canCollect && entry.status === 'unpaid' ? (
        <PaymentForm
          episodeId={episodeId}
          billId={entry.id}
          total={formatRupees(entry.totalPaise)}
          totalPaise={entry.totalPaise}
        />
      ) : null}
      {canCollect && entry.payment?.undoable ? (
        <UndoPaymentForm episodeId={episodeId} paymentId={entry.payment.id} />
      ) : null}
    </li>
  );
}

/** The episode's bills (BIL-05), and the consultation fee when it is due but not billed. */
function Bills({ sheet }: { sheet: PlanSheet }) {
  const fee = sheet.unbilledFee;
  return (
    <section aria-labelledby="bills" className="flex flex-col gap-2">
      <h2 id="bills" className="font-semibold text-ink">
        Bills
      </h2>
      {fee ? (
        fee.feeSet ? (
          <div className="flex flex-col gap-2" data-testid="fee-unbilled">
            <p className="text-sm text-ink-secondary">The consultation fee is not billed yet.</p>
            {fee.canMake ? <MakeBillForm episodeId={sheet.episodeId} /> : null}
          </div>
        ) : (
          <p className="text-sm text-ink-secondary" data-testid="fee-not-set">
            Consultation fee not set for {fee.consultantName}. Ask the Super Admin to set it on
            Staff.
          </p>
        )
      ) : null}
      {sheet.bills.length > 0 ? (
        <ul className="flex flex-col gap-2" data-testid="bills">
          {sheet.bills.map((entry) => (
            <BillCard
              key={entry.id}
              entry={entry}
              episodeId={sheet.episodeId}
              canCollect={sheet.canCollect}
              discounts={sheet.discounts}
            />
          ))}
        </ul>
      ) : fee ? null : (
        <p className="text-sm text-ink-muted" data-testid="no-bills">
          No bills yet.
        </p>
      )}
      <p className="text-sm text-ink-muted">
        Prices come from the price master; bills cannot be edited here. The desk applies a discount
        from the clinic&apos;s list; any other discount is Finance&apos;s. The whole total is paid
        at once; partial payments are not taken yet.
      </p>
    </section>
  );
}

/** The episode's packages (BIL-08): active once paid, with sessions used, expiry and reschedules. */
function Packages({ sheet }: { sheet: PlanSheet }) {
  if (sheet.packages.length === 0) return null;
  return (
    <section aria-labelledby="bought-packages" className="flex flex-col gap-2">
      <h2 id="bought-packages" className="font-semibold text-ink">
        Package
      </h2>
      <ul className="flex flex-col gap-2" data-testid="packages">
        {sheet.packages.map((entry) => (
          <li key={entry.id}>
            <PackageMeter entry={entry} today={sheet.today} expiringDays={sheet.expiringDays} />
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * Book plan sessions (SCH-11, PRD J4.8): what the plan asks for and what is booked, and for those
 * who book at the centre, the pattern form once the episode is Active.
 */
function PlanSessions({ view }: { view: PlanSessionsView }) {
  return (
    <section
      aria-labelledby="plan-sessions"
      className="flex flex-col gap-2"
      data-testid="plan-sessions"
    >
      <h2 id="plan-sessions" className="font-semibold text-ink">
        Book plan sessions
      </h2>
      {view.planned === null ? (
        <p className="text-sm text-ink-muted">
          The plan sets no frequency, so there are no plan sessions to book.
        </p>
      ) : (
        <p className="text-sm tabular-nums text-ink-secondary" data-testid="plan-sessions-counts">
          {view.planned} planned · {view.booked} booked · {view.done} done · {view.toBook} to book
          {view.packageLeft !== null ? ` · package: ${String(view.packageLeft)} left` : ''}
        </p>
      )}
      {view.planned === null ? null : view.episodeStatus !== 'active' ? (
        <p className="text-sm text-ink-muted" data-testid="plan-sessions-unpaid">
          Book plan sessions once the plan is paid.
        </p>
      ) : view.mayBook && view.appointmentTypeId ? (
        <PlanSessionsForm
          episodeId={view.episodeId}
          toBook={view.toBook}
          today={view.today}
          physios={view.physios}
          suggestedPhysioId={view.suggestedPhysioId}
        />
      ) : view.toBook === 0 ? (
        <p className="text-sm text-ink-muted">All planned sessions are booked.</p>
      ) : null}
    </section>
  );
}

/** What was chosen, in words: the package or the session type with it. */
function choiceText(entry: PlanChoiceEntry): string {
  if (entry.choice === 'package') return `Package: ${entry.packageName ?? 'not found'}`;
  if (entry.choice === 'per_session') {
    return `${planChoiceLabels.per_session} (${entry.sessionLabel ?? 'not found'})`;
  }
  return planChoiceLabels[entry.choice];
}

function recordedText(entry: PlanChoiceEntry): string {
  return `Recorded by ${entry.recordedByName ?? 'a former staff member'}, ${documentDateTime(entry.recordedAt)}`;
}

/** The patient's choice that counts, and what follows from it. */
function CurrentChoice({ entry }: { entry: PlanChoiceEntry }) {
  return (
    <div
      className="flex flex-col gap-1 rounded-panel border border-line bg-surface p-3"
      data-testid="current-choice"
    >
      <span className="font-medium text-ink">{choiceText(entry)}</span>
      <span className="text-sm text-ink-secondary">{recordedText(entry)}</span>
      {entry.followUpAt ? (
        <span className="text-sm text-ink-secondary" data-testid="follow-up">
          Follow-up call and WhatsApp nudge on {documentDate(entry.followUpAt)} at{' '}
          {documentTime(entry.followUpAt)}
        </span>
      ) : null}
      {entry.choice === 'no_thanks' ? (
        <span className="text-sm text-ink-secondary">
          The plan and all clinical information stay on the record.
        </span>
      ) : null}
    </div>
  );
}

/**
 * The plan and payment sheet (BIL-01, PRD J4.2, Frontend Specification section 7): for the front
 * desk, the recommended plan read only and what it costs per session or as a package. The session
 * type is chosen with a plain form, so the sheet works without scripts. The patient's choice is
 * recorded below it (BIL-02); Part B consent, the bill and payment come with BIL-03 onwards.
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
  const planSessions =
    sheet.plan && can(staff, 'bookings.manage')
      ? await planSessionsOf(staff, episodeId)
      : undefined;
  const { plan, options } = sheet;
  const [current, ...earlier] = sheet.choices;
  const choiceOptions: ChoiceOption[] = options
    ? [
        ...options.packages.map((offer) => ({
          value: ['package', offer.id].join(':'),
          label: `Package: ${offer.name}`,
          amount: formatRupees(offer.pricePaise),
          helper: offer.cover,
        })),
        {
          value: 'per_session',
          label: `Pay per session (${options.perSession.item.label})`,
          amount: formatRupees(
            options.perSession.totalPaise ?? options.perSession.item.amountPaise,
          ),
        },
        {
          value: 'think_about_it',
          label: planChoiceLabels.think_about_it,
          helper: 'The patient gets a WhatsApp nudge and the front desk a call task later.',
        },
        {
          value: 'no_thanks',
          label: planChoiceLabels.no_thanks,
          helper: 'The plan and all clinical information stay on the record.',
        },
      ]
    : [];

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
        <p
          className="flex flex-wrap items-center gap-2 text-sm text-ink-secondary"
          data-testid="sheet-header"
        >
          <span className="font-mono text-ink">{sheet.opNumber}</span>
          {sheet.centreName ? <span>· {sheet.centreName}</span> : null}
          <Tag tone="outline">{episodeStatusLabels[sheet.episodeStatus]}</Tag>
        </p>
      </div>

      {!plan ? (
        <>
          <p className="text-ink-muted" data-testid="no-plan">
            No plan yet. The plan appears here once the consultation is signed.
          </p>
          <Bills sheet={sheet} />
          <Packages sheet={sheet} />
        </>
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

          <Bills sheet={sheet} />
          <Packages sheet={sheet} />
          {planSessions ? <PlanSessions view={planSessions} /> : null}

          <section aria-labelledby="choice" className="flex flex-col gap-2">
            <h2 id="choice" className="font-semibold text-ink">
              Patient’s choice
            </h2>
            {current ? (
              <CurrentChoice entry={current} />
            ) : (
              <p className="text-sm text-ink-muted" data-testid="no-choice">
                No choice recorded yet.
              </p>
            )}
            {sheet.canRecordChoice && options ? (
              <PlanChoiceForm
                key={current?.id ?? 'none'}
                episodeId={sheet.episodeId}
                session={options.perSession.item.key}
                options={choiceOptions}
              />
            ) : null}
            {earlier.length > 0 ? (
              <details className="text-sm">
                <summary className="min-h-11 cursor-pointer py-2.5 text-ink-secondary">
                  Earlier choices ({earlier.length})
                </summary>
                <ul className="flex flex-col gap-1.5" data-testid="earlier-choices">
                  {earlier.map((entry) => (
                    <li key={entry.id} className="flex flex-col">
                      <span>{choiceText(entry)}</span>
                      <span className="text-ink-muted">{recordedText(entry)}</span>
                    </li>
                  ))}
                </ul>
              </details>
            ) : null}
          </section>

          <p className="text-sm text-ink-muted">Consent comes next.</p>
        </>
      )}
    </main>
  );
}
