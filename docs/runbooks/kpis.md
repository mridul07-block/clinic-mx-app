# Figures: the KPI query layer (DSH-01)

The source is PRD section 9 ("the SOP's own KPIs become the product's targets, tracked automatically
on the dashboards from launch") and the KPI cards in Frontend Specification section 8. Ticket
DSH-01 asks for daily aggregates for every metric in PRD section 9, by centre.

## Decisions (user, 28 October 2026)

**Live from the records.** `internal.kpi_daily(from, to)` counts every figure when it is read, by
centre and IST day. There is no nightly table, so:

- a late signature or an undone payment corrects its own day;
- today's figures are always current.

Two moments of an episode are stamped for the figures:

- `episode.plan_proposed_at`, the first time the episode reached Plan proposed;
- `episode.activated_at`, the first time it reached Active.

The `episode_milestones` trigger sets them, and no one else can set or change them. Older episodes
got theirs from the audit trail when the migration ran.

**Conversion:** the share of episodes that became Active (paid), out of those whose signed
consultation proposed a plan.

- It is counted on the day the plan was proposed.
- Episodes with a red flag referral are left out, whether the referral put them On hold before or
  after the plan was proposed.
- Opening entries (SCH-13) are left out, because they had no consultation.

**Plan acceptance:** of the same episodes, the share whose newest choice is Package or Pay per
session.

**Completion:** the share discharged with Goals achieved or Independent management, out of the
episodes discharged after treatment began (Active at some point).

- It is counted on the day of discharge.
- Lost to follow up counts as not completed once the episode is discharged.
- Opening entries are included.

**Not measured yet:** every PRD section 9 figure is in the catalogue, with its target as a setting.
A figure that no ticket has built data for yet shows "Not measured yet" and what will bring the
data.

**The screen:** a plain table at `/app/figures`:

- **For:** the Super Admin, through the home link "Figures" and the permission
  `dashboard.overview`;
- **Periods:** today, the last 7 days and the last 30 days, overall and by centre.

The dashboards (DSH-03 to DSH-05) draw the same figures as charts.

## The figures

Each measured figure gives one row per centre and IST day. The row has a numerator and, for a share,
a denominator. Over a period the days are added up, and a share divides the sums. Active patients
takes the value on the last day instead.

A per cent is shown whole, unless rounding would carry it across its target: then it shows one
decimal on its own side ("99.5%" under a 100% target, never "100%"). Money is shown in lakhs from 1
lakh ("₹18.4 L"), as the Frontend Specification asks for dashboards.

| Figure | Counted | Day | Target |
| --- | --- | --- | --- |
| Red flag documentation | Of the first consultation of each episode that the patient came to (checked in, in progress or completed), those signed. Signing needs complete screening. | visit | `kpi.target_red_flag_documentation_percent` (100) |
| Consultation to treatment conversion | As defined above | plan proposed | `kpi.target_conversion_percent` (over 75) |
| Plan acceptance | As defined above | plan proposed | none |
| Treatment completion | As defined above | discharge | `kpi.target_completion_percent` (over 80) |
| Notes signed same day | Of the consultation and session notes started, those signed on the same IST day. A day is counted only once it has ended. | visit | `kpi.target_notes_same_day_percent` (over 95) |
| No show rate | Of the visits the patient came to or that were marked a no show, the no shows. Past visits nobody marked are left out. | visit | none (tracked monthly) |
| Health form completion before consultation | Of the consultations the patient came to, those whose health form was submitted (alone or with help) by the booked start | visit | `kpi.target_health_form_percent` (over 90) |
| Consultations | Consultation visits completed (signed) | visit | none |
| Active patients | Patients with an Active or Under review episode at the end of the day (or now, for today). It is rebuilt from each episode's status history in the audit trail. A patient with episodes at two centres counts at each centre, and once in the all-centres row (no centre). | end of day | none |
| Revenue | Payments not undone, in paise. Finance and the Super Admin only. | payment recorded | none |

These figures are not measured yet:

| Figure | What brings the data | Target setting |
| --- | --- | --- |
| Meaningful change by 6 week review | OUT-02 and SET-08 | `kpi.target_meaningful_change_percent` (over 85) |
| Return to sport by 12 months | PAT-10, plus a decision on how the level is recorded | `kpi.target_return_to_sport_percent` (over 85) |
| Reinjury within 12 months | Counting the follow up answers (Injured again within 12 months of discharge), recorded since PAT-10 | `kpi.target_reinjury_percent` (under 15) |
| Patient satisfaction | A question out of 5 the client has not given (DECISION PAT-04) | `kpi.target_satisfaction_score` (over 4.5) |
| Net Promoter Score | Daily figures; the Feedback screen shows it from discharge feedback (PAT-07) | `kpi.target_nps` (over 60) |
| Right diagnosis in AI top 3 | AI-03 | none: set after the first 3 months (DECISION DSH-01) |
| Booking Flow completion | WA-04 | `kpi.target_booking_flow_percent` (over 80) |
| Session note time | A decision, because nothing records how long a note takes (DECISION DSH-01) | `kpi.target_session_note_minutes` (under 3) |

When a ticket brings a figure's data, it makes three changes:

1. adds the figure's CTE to `internal.kpi_daily`;
2. adds its key to `measuredKpiKeys`;
3. marks it measured in the catalogue.

A unit test keeps the two lists the same.

## Who sees what

| Who | Figures | Centres |
| --- | --- | --- |
| Super Admin | all | all |
| Centre Manager | clinical and operational, no money | their centres |
| Finance | revenue only | all |
| Anyone else | refused (42501) | |

`internal.kpi_daily` is SECURITY DEFINER, because it counts rows the reader could not list one by
one. It returns counts only, never a patient.

- **Role:** it checks the role from the token.
- **Centres:** it keeps each row to the centres the reader sees (`internal.jwt_sees_centre`).
- **App check:** the app checks `dashboard.overview` for the Figures page first.
- **Period:** at most `kpi.max_range_days` (366) days, and never backwards. Anything else is
  refused with 22023.

| Piece | Where |
| --- | --- |
| Catalogue, targets, period sums, status words | `packages/schemas/src/kpis.ts` |
| Settings | `kpi.*` in `packages/schemas/src/settings.ts` |
| Milestones, backfill, `internal.kpi_daily`, setting rows | `supabase/migrations/20261027184154_kpis_rules.sql` |
| Reader | `packages/db/src/kpis.ts` (`kpiDaily`, under `withStaffAccess`) |
| Service | `apps/web/modules/reporting/kpis.ts` (`figuresView`) |
| Screen | `/app/figures` |

## Tests

| Test | Covers |
| --- | --- |
| `packages/schemas/src/kpis.test.ts` | Every PRD section 9 metric has a figure with a target setting (or the PRD's note). The measured keys match. Values; the over, at least and under comparisons; period sums; the last day. |
| `packages/db/src/integration/kpis.integration.test.ts` | Each figure on its day and at its centre. Cases: a later consultation in the same episode, late signing, a form submitted after the start, an unmarked past visit, the newest choice, a referral on hold before and after the plan was proposed, discharge before treatment, opening entries, a patient at two centres, active patients across a pause and a return, an undone payment. Also who sees what, refusals, and milestones stamped only once. |
| `apps/web/modules/reporting/kpis.test.ts` | Periods overall and by centre against their targets. No data is not shown as 0%. Rows for figures not measured yet. Super Admin only. |
| `apps/web/e2e/figures.spec.ts` | At 360 px and desktop: the Super Admin's figures, and a held consultation counted in HSR Layout's figure. A Centre Manager and Finance are refused. |

**Negative checks:** the database test fails in each of these cases:

- **No centre scope:** a manager sees Whitefield.
- **No "resolved visits only" rule:** the unmarked past visit is counted.
- **No referral exclusion:** an episode referred after its plan was proposed counts in conversion.
- **No all-centres row:** a patient treated at two centres counts twice overall.
- **Re-stamping:** a pause and return moves the activation to the later time.
