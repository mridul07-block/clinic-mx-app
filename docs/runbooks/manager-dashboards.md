# Centre Manager dashboards (DSH-03)

This covers the Centre Manager's Alerts, Centres, Outcomes, Team and Feedback screens, from
Frontend Specification section 6 and the chart table in section 8. The figures come from DSH-01
(`internal.kpi_daily`, `docs/runbooks/kpis.md`) and are drawn with the DSH-02 charts
(`docs/runbooks/charts.md`).

## Decisions (28 October 2026)

These are recommended defaults chosen under the user's standing approval of 28 October 2026. They
are recorded in the DECISION register as "DSH-03" for the client to confirm.

**Where it is**

- The dashboard lives at `/app/dashboard/alerts`, `centres`, `outcomes`, `team` and `feedback`,
  with a tab row across them.
- It is for the Super Admin and Centre Managers (`dashboard.clinical_operations`). The home link is
  "Dashboard".
- Centre Managers land on Alerts after signing in (`homePath`).
- The phone bottom tab bar (Frontend Specification section 4) is not built. No ticket covers it, so
  it is a DECISION for a navigation shell ticket.

**What a manager sees**

- Only counts, only for their own centres, and never an amount of money.
- A manager without the Treats patients tick still sees the counts of what they cannot open row by
  row (notes, reassessments, diagnoses, bills), through SECURITY DEFINER count functions.

**Alerts**

- Live counts per centre, each linking to its list:
  - red flags not closed: emergencies, waiting for review, reviewed, referred;
  - notes started and not signed;
  - reassessments waiting for the consultant's decision;
  - new symptoms, adverse events and worse or escalated sessions still to review (tasks held by
    consultants, counted only; ALT-02);
  - 6 week reviews overdue (ALT-02; each a task held by the consultant, so counted only);
  - episodes On hold (no list of them exists yet, so the line says they show on each patient's
    record), and Lost to follow up.
- Two items wait for the tickets that bring them, with no clinical rule invented here:
  - "Stalled progress": plateau and no change wait for the clinic's thresholds (DECISION ALT-02).
  - "Service recovery" comes with discharge feedback (PAT-08).

**Centres**

Today, at each centre:

- **Utilisation:** booked minutes of the appointments holding a slot, no shows included, clipped
  to each person's roster at the centre with approved leave cut out.
- **No shows** today.
- **Waiting:** from the later of arrival and the booked start, to the start of the visit. It shows
  the median and the longest for today, and how many are waiting now with the longest wait. A wait
  over `day.running_late_minutes` says "running late".
- **Payment pending:** unpaid bills counted "today" and "earlier", with no amounts. This is the
  Centre Manager's payment pending view from IAM-05.

Then:

- **KPI cells** in one panel: consultations, plan acceptance, no shows and active patients for the
  last 7 days, against the 7 days before.
- **Appointments per centre** for the last 7 days, with today hatched "so far".
- **How bookings came in** over `dashboard.channel_days` (30), as sorted bars in the data blue. The
  Frontend Specification draws a donut, but the design system reserves the centre colours for
  centres and has no three other categorical colours.
  - new bookings only, without reschedules;
  - front desk is labelled "Front desk (phone)";
  - bookings made by Clinic Mx (the 6 week reviews) are stated under the donut.
- **Busy hours** over `dashboard.busy_hours_days` (28): visits the patient came to, by weekday and
  hour. An hour nobody came to is 0, the lightest step, and with no visits at all the page says so.
- **Status words** use the design system's tones: "On target" in green (`active`), "Off target" in
  amber (`waiting`), never red. The Figures page follows suit. "Running late" is in the readable
  amber text colour.

**Outcomes**

- **Window:** the last 30 days, the last 90 days (the default) or the last 12 months.
- **Bullet graphs:** completion and conversion against their SOP targets. The grey mark is the
  window before.
- **Not measured yet:** meaningful change and reinjury, with the tickets that bring them.
- **Funnel:** episodes whose first attended consultation is in the window, with opening entries
  left out. The stages are:
  1. held;
  2. plan proposed;
  3. started treatment (paid);
  4. discharged;
  5. discharged with goals met.

  Those still in treatment are counted beside it, so a recent window is not read as drop off.
- **Top diagnoses:** by the latest signed diagnosis of each episode.
- **Outcomes by diagnosis:** the mean pain during activity, from the first signed consultation (as
  confirmed, otherwise as the health form gave it) to the last signed session, for episodes
  discharged after treatment.
  - Means are weighted by episodes across centres.
  - A diagnosis is drawn only with at least `kpi.min_outcome_episodes` (3). Smaller ones are
    listed as too few.
  - Questionnaire scores replace pain when OUT-02 brings them.
  - Each episode's last signed session is found once (index `session_episode_signed_idx`), so the
    page stays quick as sessions grow.

**Team**

- Notes signed the same day by each physio, by the note's writer, over the last 30 closed days,
  against `kpi.target_notes_same_day_percent`.
- Visits each physio's patients came to over the last 7 days. A visit counts for whoever started it
  (the covering physio under SES-08).
- A link to rosters and leave.

**Feedback**

- After the consultation (PAT-04): Yes and No for each of the four questions over 30 days, 90 days
  or 12 months, then by centre and by the physio who held the consultation (grouped by id, so two
  people with one name stay apart), and what patients wrote. Read under the reader's access: the
  Super Admin every centre, a Centre Manager theirs. See `docs/runbooks/feedback.md`.
- Satisfaction (no question is out of 5 yet) and the Net Promoter Score (PAT-07) stay "Not
  measured yet"; themes and service recovery come with PAT-07 and PAT-08.

**Week strip**

- The week strip is now seven squares, as Frontend Specification section 5 says. This is a DSH-02
  follow up.

## How it works

| Piece | Where |
| --- | --- |
| Count functions | `supabase/migrations/20261027203753_manager_dashboards.sql`: `internal.reads_dashboards`, `manager_alert_counts`, `payment_pending_counts`, `team_daily`, `kpi_funnel`, `kpi_diagnosis_outcomes`. All are SECURITY DEFINER, for the Super Admin and Centre Managers only (42501 for anyone else), scoped by `jwt_sees_centre`, and return counts and staff ids only. Periods are capped by `kpi.max_range_days`. |
| Readers | `packages/db/src/dashboards.ts`. Appointment figures (arrivals, appointments per day, booking channels, busy hours) are read under the reader's own row level security. Utilisation uses `loadPeople` and `windowsOn`. |
| Pure rules | `packages/schemas/src/dashboards.ts`: `utilisationMinutes`, `waitMinutes`, `median`, the windows, the alert items and the funnel stages |
| Services | `apps/web/modules/reporting/manager.ts`: one view per tab, each checking `dashboard.clinical_operations` |
| Screens | `apps/web/app/(staff)/app/(signed-in)/dashboard/` and `components/charts/funnel.tsx` |
| Settings | `dashboard.busy_hours_days` (28), `dashboard.channel_days` (30), `kpi.min_outcome_episodes` (3) |

## Tests

| Test | Covers |
| --- | --- |
| `packages/schemas/src/dashboards.test.ts` | Utilisation clipping, waiting from the later of arrival and start, the median, windows and change words, the labels and links |
| `packages/db/src/integration/manager-dashboards.integration.test.ts` | Each count function on generated records. A manager sees only their centres and the Super Admin sees all. Unpaid bills have no amount column. Team notes add up to the centre's figure. The funnel leaves opening entries out. Diagnosis pain runs from the first consultation to the last session. Arrivals, bookings, busy hours and utilisation (75 of 240 minutes) work. Physios, the desk and Finance are refused. |
| `apps/web/modules/reporting/manager.test.ts` | Every tab's view: sums and centre shares, today at a centre, the KPI cells, weighted pain and small groups, team figures, a year window asked for one year at a time, and refusals |
| `apps/web/e2e/manager-dashboards.spec.ts` | At 360 px and on desktop: a temporary Centre Manager lands on Alerts. The episodes on hold match the records. Each tab shows, there is no money, and nothing is wider than the screen. Finance and physios are refused. |

**Negative checks:** the database test fails in each case:

- without the centre scope in `manager_alert_counts`, a manager sees Whitefield;
- without the opening entry exclusion in the funnel, the opening entry is counted;
- crediting notes to the visit's physio instead of the writer misplaces the covering physio's note.

**Review:** an adversarial review confirmed 11 defects. All are fixed with tests:

- a per-episode scan of every session;
- "No new bookings" shown while Clinic Mx's own bookings existed;
- the KPI panel without hairlines;
- tabs that overflowed without their baseline;
- a reserved centre colour on the channel donut;
- empty busy hours shown as "No data";
- an "Open the list" with no list;
- status words in the wrong tones;
- low-contrast "running late" text;
- round key swatches on the square week strip;
- a team test that could not tell the writer from the visit's physio.
