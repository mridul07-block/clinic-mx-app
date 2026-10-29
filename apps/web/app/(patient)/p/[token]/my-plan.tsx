import {
  addDays,
  firstName,
  formatIstDate,
  formatIstDateTime,
  istDate,
  packageLine,
  painPoints,
  painSentence,
  planWeek,
  planWeekStart,
  weekStripDays,
  type MyPlan,
} from '@clinic-mx/schemas';
import { ChartTable } from '../../../../components/charts/chart-table';
import { WeekStrip } from '../../../../components/charts/week-strip';
import { tickExerciseAction } from '../../../../modules/patient-links/actions';
import { LineChart } from '../../../../components/charts/line-chart';

// My plan (PAT-01, in part; PRD M13, Frontend Specification "My plan"; docs/runbooks/my-plan.md):
// the patient's own page for their episode, in the patient voice. The week of the plan, the next
// visit with its map, the home exercises as the plan lists them, the package's sessions (gold, never
// a price) and the pain line with its sentence. Videos come with the exercise library (SET-07);
// changing a visit is by calling the clinic until WhatsApp's reschedule (WA-05, DECISION PAT-01).

const panel = 'flex flex-col gap-2 rounded-panel border border-line bg-surface p-4';
const pain = (value: number | null) => (value === null ? 'Not recorded' : String(value));

export function MyPlanPage({
  plan,
  now,
  token,
  changed,
}: {
  plan: MyPlan;
  now: Date;
  /** The page's own token, which the tick forms post back. */
  token: string;
  /** The plan changed under a tick (PAT-02): the page says so above the exercises. */
  changed: boolean;
}) {
  const points = painPoints(
    undefined,
    plan.pain.map((reading) => ({
      number: reading.number,
      at: new Date(reading.signedAt),
      pain: { rest: reading.rest, activity: reading.activity, after: reading.after },
    })),
  );
  const sentence = painSentence(points);
  const recorded = points.some((point) => point.activity !== null);
  const phone = plan.next?.phone ?? plan.centrePhone;
  // PAT-03: after discharge, the page is the patient's maintenance page.
  const maintenance = plan.maintenance;
  const written = maintenance
    ? (
        [
          ['my-plan-return', 'Your return plan', maintenance.returnPlan],
          ['my-plan-flare', 'Your flare plan', maintenance.flarePlan],
          ['my-plan-needs', 'Ongoing needs', maintenance.ongoingNeeds],
          ['my-plan-recommendations', 'Recommendations', maintenance.recommendations],
        ] as const
      ).flatMap(([id, title, text]) => (text ? [{ id, title, text }] : []))
    : [];
  return (
    <div className="flex flex-col gap-4" data-testid="my-plan">
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold text-ink">Hello {firstName(plan.name)}</h1>
        {maintenance ? (
          <p className="text-ink-secondary" data-testid="my-plan-discharged">
            Discharged on {formatIstDate(istDate(new Date(maintenance.dischargedAt)))}.
            {plan.plan && plan.plan.homeProgramme.length > 0 ? ' Keep up your exercises.' : ''}
          </p>
        ) : plan.plan ? (
          <p className="text-ink-secondary" data-testid="my-plan-week">
            {planWeek(new Date(plan.plan.since), plan.plan.weeks, now)}
          </p>
        ) : null}
      </div>

      {maintenance ? (
        <section
          aria-labelledby="my-plan-check-up"
          className={panel}
          data-testid="my-plan-check-up"
        >
          <h2 id="my-plan-check-up" className="font-semibold text-ink">
            Book a check up
          </h2>
          {/* DECISION PAT-03: no self booking yet (WhatsApp, WA-04); the clinic books it. */}
          {phone ? (
            <a
              href={`tel:${phone.replace(/\s/g, '')}`}
              className="inline-flex min-h-12 items-center font-medium text-accent underline"
            >
              Call the clinic to book a check up
            </a>
          ) : (
            <p className="text-ink-secondary">Call the clinic to book a check up.</p>
          )}
        </section>
      ) : null}

      {written.length > 0 ? (
        <section aria-label="Your plan from here" className="flex flex-col gap-4">
          {written.map((entry) => (
            <section
              key={entry.id}
              aria-labelledby={entry.id}
              className={panel}
              data-testid={entry.id}
            >
              <h2 id={entry.id} className="font-semibold text-ink">
                {entry.title}
              </h2>
              <p className="whitespace-pre-line text-ink">{entry.text}</p>
            </section>
          ))}
        </section>
      ) : null}

      {plan.aboutCondition ? (
        // CLN-08: the diagnosis in plain words, as a consultant who treats patients approved it.
        <section aria-labelledby="my-plan-about" className={panel} data-testid="my-plan-about">
          <h2 id="my-plan-about" className="font-semibold text-ink">
            About your condition
          </h2>
          <p className="whitespace-pre-line text-ink">{plan.aboutCondition}</p>
        </section>
      ) : null}

      {maintenance ? null : (
        <section aria-labelledby="my-plan-next" className={panel} data-testid="my-plan-next">
          <h2 id="my-plan-next" className="font-semibold text-ink">
            Your next visit
          </h2>
          {plan.next ? (
            <>
              <p className="text-lg text-ink">{formatIstDateTime(new Date(plan.next.startsAt))}</p>
              <p className="text-ink">
                {plan.next.type} with {plan.next.physio}, {plan.next.centre}
              </p>
              <div className="flex flex-wrap gap-x-5 gap-y-2">
                {plan.next.mapLink ? (
                  <a
                    href={plan.next.mapLink}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex min-h-12 items-center font-medium text-accent underline"
                  >
                    Map
                  </a>
                ) : null}
                {phone ? (
                  <a
                    href={`tel:${phone.replace(/\s/g, '')}`}
                    className="inline-flex min-h-12 items-center font-medium text-accent underline"
                  >
                    To change it, call the clinic
                  </a>
                ) : (
                  <p className="inline-flex min-h-12 items-center text-ink-secondary">
                    To change it, call the clinic.
                  </p>
                )}
              </div>
            </>
          ) : (
            <>
              <p className="text-ink-secondary">No visit is booked yet.</p>
              {phone ? (
                <a
                  href={`tel:${phone.replace(/\s/g, '')}`}
                  className="inline-flex min-h-12 items-center font-medium text-accent underline"
                >
                  Call the clinic to book
                </a>
              ) : (
                <p className="text-ink-secondary">Call the clinic to book.</p>
              )}
            </>
          )}
        </section>
      )}

      <section
        aria-labelledby="my-plan-exercises"
        className={panel}
        data-testid="my-plan-exercises"
      >
        <h2 id="my-plan-exercises" className="font-semibold text-ink">
          {maintenance ? 'Your maintenance exercises' : 'Your exercises'}
        </h2>
        {changed ? (
          <p role="status" className="text-ink-secondary">
            Your plan has changed. Here it is as it is now.
          </p>
        ) : null}
        {plan.plan && plan.plan.homeProgramme.length > 0 ? (
          <>
            <p className="text-sm text-ink-secondary">
              Tick each exercise when you have done it today.
            </p>
            <ul className="flex flex-col divide-y divide-line">
              {plan.plan.homeProgramme.map((row, index) => {
                const done = plan.tickedToday.includes(index);
                return (
                  <li
                    key={[index, row.exercise].join('-')}
                    className="flex items-center justify-between gap-3 py-2"
                    data-testid="my-plan-exercise"
                  >
                    <span className="flex flex-col">
                      <span className="font-medium text-ink">{row.exercise}</span>
                      {row.dose ? <span className="text-ink-secondary">{row.dose}</span> : null}
                      {row.note ? (
                        <span className="text-sm text-ink-secondary">{row.note}</span>
                      ) : null}
                    </span>
                    <form action={tickExerciseAction}>
                      <input type="hidden" name="token" value={token} />
                      <input type="hidden" name="index" value={String(index)} />
                      <input type="hidden" name="exercise" value={row.exercise} />
                      <input type="hidden" name="done" value={done ? 'no' : 'yes'} />
                      <button
                        type="submit"
                        aria-pressed={done}
                        aria-label={`${row.exercise}: ${done ? 'done today, tap to undo' : 'mark done today'}`}
                        className={`flex min-h-14 min-w-28 items-center justify-center rounded-control border px-3 font-semibold ${
                          done
                            ? 'border-accent bg-accent text-on-accent'
                            : 'border-line-control bg-surface text-ink'
                        }`}
                      >
                        {done ? 'Done today' : 'Mark done'}
                      </button>
                    </form>
                  </li>
                );
              })}
            </ul>
            <WeekStrip
              label={
                maintenance
                  ? 'Days you did your exercises, last 7 days'
                  : 'Days you did your exercises this week'
              }
              days={weekStripDays(
                // After discharge the plan's weeks are over: the last seven days instead.
                maintenance
                  ? addDays(plan.today, -6)
                  : planWeekStart(new Date(plan.plan.since), plan.today),
                plan.tickedDays,
                plan.today,
                plan.trackedFrom,
              )}
            />
          </>
        ) : (
          <p className="text-ink-secondary">
            {maintenance
              ? 'No home exercises were set in your plan.'
              : 'Your physio adds your exercises to your plan.'}
          </p>
        )}
      </section>

      {plan.package && !maintenance ? (
        <section aria-labelledby="my-plan-package" className={panel} data-testid="my-plan-package">
          <h2 id="my-plan-package" className="font-semibold text-ink">
            {plan.package.name}
          </h2>
          <div
            role="progressbar"
            aria-label="Sessions used"
            aria-valuemin={0}
            aria-valuemax={plan.package.total}
            aria-valuenow={plan.package.used}
            className="h-3 overflow-hidden rounded-full bg-surface-sunken"
          >
            <div
              className="h-3 rounded-full bg-brand"
              style={{
                width: `${String(Math.round((plan.package.used / Math.max(1, plan.package.total)) * 100))}%`,
              }}
            />
          </div>
          <p className="text-ink">
            {String(plan.package.used)} of {String(plan.package.total)} sessions used
          </p>
          <p className="text-sm text-ink-secondary" data-testid="my-plan-package-line">
            {packageLine(plan.package, istDate(now))}
          </p>
        </section>
      ) : null}

      <section aria-labelledby="my-plan-pain" className={panel} data-testid="my-plan-pain">
        <h2 id="my-plan-pain" className="font-semibold text-ink">
          Your pain during activity
        </h2>
        {recorded ? (
          <>
            {sentence ? (
              <p className="text-ink-secondary" data-testid="my-plan-pain-sentence">
                {sentence}
              </p>
            ) : null}
            <LineChart
              label={`Pain during activity, 0 to 10. ${sentence ?? ''}`}
              points={points.map((point) => ({ label: point.label, value: point.activity }))}
              min={0}
              max={10}
            />
            <ChartTable
              caption="Pain at each session, 0 to 10"
              columns={['Session', 'During activity', 'At rest', 'After treatment']}
              rows={points.map((point) => [
                `${point.label}, ${formatIstDate(istDate(point.at))}`,
                pain(point.activity),
                pain(point.rest),
                pain(point.after),
              ])}
            />
          </>
        ) : (
          <p className="text-ink-secondary">
            {maintenance
              ? 'No pain readings were recorded.'
              : 'Your physio records it at each session.'}
          </p>
        )}
      </section>
    </div>
  );
}
