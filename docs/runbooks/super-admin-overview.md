# Super Admin overview (DSH-05)

Frontend Specification section 6 gives the Super Admin an "Overview across all centres", and the
section 4 tabs for the role are "Overview, Alerts, Settings, More". Ticket DSH-05 asks for all
centres at a glance plus the AI's top 3 accuracy by month.

## Decisions (28 October 2026)

These are recommended defaults chosen under the user's standing approval of 28 October 2026. They
are recorded in the DECISION register as "DSH-05" for the client to confirm.

- **Where:** the Overview is at `/app/overview`, for the Super Admin (`dashboard.overview`). The
  Super Admin lands there after signing in, and home keeps an "Overview" link.
- **Today:** a card per active centre showing:
  - collected today;
  - utilisation;
  - no shows;
  - who is waiting now ("running late" past `day.running_late_minutes`);
  - payment pending.
- **Last 7 days:** the week's cells against the week before. They are consultations, plan
  acceptance, no shows and active patients, plus revenue, which the Super Admin may see.
- **SOP targets:** the targets over the last 90 days, as on the Centre Manager's Outcomes:
  completion, conversion, meaningful change and reinjury. The last two say what brings them.
- **Revenue:** by month against the year before.
- **AI accuracy:** the AI's right diagnosis in its top 3 by month is shown as "Not measured yet".
  It comes with AI-03, and its target is set after the first 3 months, as the PRD says.
- **Links** go to the dashboard (alerts and outcomes), Finance and All figures.

The Overview adds no data reads of its own. It is built from the Centre Manager's Centres and
Outcomes views and Finance's Collections and Revenue views, which the Super Admin reads in full.
The week's figures panel and the target cards are shared components
(`components/dashboard/kpi-panel.tsx`, `outcome-bullet-card.tsx`).

## How it works

| Piece | Where |
| --- | --- |
| Service | `apps/web/modules/reporting/overview.ts` (`overviewView`, which checks `dashboard.overview`) |
| Screen | `apps/web/app/(staff)/app/(signed-in)/overview/page.tsx` |
| Landing | `homePath('super_admin')` in `apps/web/modules/auth/next-path.ts` |

## Tests

| Test | Covers |
| --- | --- |
| `apps/web/modules/reporting/overview.test.ts` | Every centre with today's money (none shows ₹0), revenue for the week against the week before, the targets over 90 days, AI top 3 waiting for AI-03, and the Super Admin alone |
| `apps/web/modules/auth/next-path.test.ts` | The Super Admin lands on `/app/overview` |
| `apps/web/e2e/super-admin-overview.spec.ts` | At 360 px and on desktop: a temporary Super Admin lands on the Overview, and HSR Layout's money today matches the records. The week has revenue. The four targets and the AI line show, and the page fits the screen. A Centre Manager and Finance are refused. |
| `apps/web/e2e/auth.spec.ts` | Each role's landing page |

**Review:** an adversarial review confirmed 4 defects, all fixed:

- **Landing after setup:** finishing two step setup at a first sign in, and opening the two step
  page when already through, ignored the role's landing screen. Both now follow `homePath`.
- **Two specs:** the templates and support access specs clicked home links straight after a Super
  Admin signed in. They now open home first.
- **The panel's fifth cell:** on a tablet, revenue broke mid-number. Five cells now sit three to a
  row on a tablet and one row on a wide screen.
