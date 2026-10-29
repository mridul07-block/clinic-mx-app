# Navigation on phones

UI-01: "Phone bottom tab bar per role". Sources:
- Frontend Specification section 4, "Bottom tabs by role (phones)".
- Design system v2: a 3 px gold bar marks the current section; lucide icons at 1.75 stroke.

Every choice below is a recommended default chosen under the user's standing approval, 29 October 2026 (DECISION UI-01), for the client to confirm.

## The tabs

`phoneTabsFor(staff)` in `packages/schemas/src/phone-tabs.ts` gives each role its tabs, in the specification's order and words, then **More**.

| Role | Tab | Screen | Shown to those allowed |
| --- | --- | --- | --- |
| Front Desk | Today | `/app/today` | `check_in.manage` |
| | Calendar | `/app/calendar` | `calendar.view` |
| | Patients | `/app/patients` | `patients.view_contact` |
| Physiotherapist | My patients | `/app/my-patients` | `visits.start` |
| | Today | `/app/calendar` (their own day) | `calendar.view` |
| | Notes | `/app/tasks` (their Tasks inbox) | `tasks.view` |
| Centre Manager | Alerts, Centres, Outcomes | `/app/dashboard/{alerts,centres,outcomes}` | `dashboard.clinical_operations` |
| Finance | Bills | `/app/finance/collections`; Revenue and Refunds count as Bills | `dashboard.finance` |
| | Unpaid | `/app/finance/unpaid` | `dashboard.finance` |
| | Packages | `/app/finance/packages` | `dashboard.finance` |
| Super Admin | Overview | `/app/overview` | `dashboard.overview` |
| | Alerts | `/app/alerts` | `red_flags.view` |
| | Settings | joins with ADM-02 | |
| Everyone | More | `/app` (Home) | |

- **Who sees a tab:** a tab shows only when the person may open its screen, the same check the page makes (`accessScope`, own records included). A physio without the Treats patients tick has no My patients; Velyx support has no Alerts.
- **More:** Home, which lists every screen the person may open. Nothing is reachable only from the bar.
- **Notes:** no screen lists a physio's own unsigned notes, and the nightly unsigned notes flag goes to the Centre Manager (CLN-10), so Notes is the physio's Tasks inbox. The client confirms, or names the screen it should be.
- **Alerts means two screens:** for a Centre Manager it is the dashboard's Alerts (the specification lists it first among their dashboard screens); for the Super Admin it is the red flag alerts. The client confirms.
- **The current tab:** the longest matching path wins (`currentPhoneTab`), so `/app/patients/<id>` is Patients; More is current on Home only.

## Where the bar shows

- **Phones only:** below 768 px (`md:hidden`). There is no tablet rail or desktop sidebar yet; on wider screens Home is the way round, as before.
- **Not on screens with their own bottom actions:** a consultation (`/app/consultations/<id>`, Back and Next) and a session (`/app/sessions/<id>`, Close session). Pages under them, such as Explain to patient, show the bar (`screensWithoutTabs`).
- **Never covers content:** the bar keeps clear of the phone's home indicator (`safe-area-inset-bottom`), and a spacer of the bar's full height, inset included, ends every page under it.
- **Patients:** the patient pages (`/p/...`) and the kiosk have no bar.

## The bar

`apps/web/components/phone-tab-bar.tsx`, rendered by the signed-in staff layout.
- `nav` "Main", each tab a link at least 56 px tall, an 18 px icon over its word.
- Icons in ink-muted; the current tab: ink and semibold, `aria-current="page"`, the 3 px gold bar on top.

## Tests

- `packages/schemas/src/phone-tabs.test.ts`: each role's tabs and words, tabs a person may not open, the current tab, the screens without the bar.
- `apps/web/e2e/navigation.spec.ts`: at 360 px each role sees its tabs and the current one marked, More goes Home, the bar stands aside in a consultation; on desktop there is no bar.
