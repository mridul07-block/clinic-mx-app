# Red flag alerts

ALT-01, PRD M11 and J3.10, Frontend Specification "Alert card", "Emergency banner" and "Alert
tiers", TAD `red_flag_alert`.

A submitted health form raises an alert for each red flag rule its answers meet (INT-10,
`docs/runbooks/health-form.md`). From then on, a clinician takes each alert through its life:

| Step | Who | What it records | Then |
| --- | --- | --- | --- |
| **Raised** | the health form | the rule, triage, tier, action, knowledge base version, sign-off | an emergency shows its banner |
| **Reviewed** ("I'm reviewing") | a clinician | who and when | the banner goes |
| **Referred** (Refer) | a clinician, after reviewing | where to, who and when | the episode goes On hold |
| **Closed** (Close with decision) | a clinician, after reviewing or referring | the written decision, who and when | nothing changes again |

Nothing else is allowed. A Raised alert cannot be referred or closed before someone reviews it, and
a closed alert never changes. The audit trail keeps every step ("Acknowledgements are logged").

## Decisions (user, 23 October 2026)

- **Only clinicians act:** staff with the Treats patients tick (`red_flags.act`). The Super Admin and
  Centre Managers without the tick see every alert at their centres but do not act.
- **The banner shows to everyone at the patient's centre**, Finance excepted, on every staff page.
- **Refer puts the episode On hold** (PRD J3.10), through the episode machine; an episode already On
  hold stays as it is. The referral letter comes with ALT-07; the WhatsApp safety advice with the
  WhatsApp tickets.
- **Close needs a written decision**, in free text. There is no fixed list until the client gives
  one.

## Who sees what

| Role | Alerts (`/app/alerts`) | Banner | Acts |
| --- | --- | --- | --- |
| Physiotherapist | at their centres | rule, patient, "I'm reviewing" | yes |
| Centre Manager, Super Admin | at their centres (all for the Super Admin) | rule, patient, "Open alerts" (or "I'm reviewing" with the tick) | with the tick |
| Front Desk | none | "Clinician review needed before <patient> leaves", "Open patient" | no |
| Finance | none | none | no |
| Velyx support | none | none | no |

## The banner

- **Where:** `EmergencyBanner` (`apps/web/components/emergency-banner.tsx`), rendered by the
  signed-in layout above every staff page, one for each Raised emergency at the person's centres.
- **Live:** `EmergencyWatch` checks `/app/alerts/live` every `live.refresh_seconds` (3) and draws
  the page again when the set of open emergencies changes. A new emergency appears, and an
  acknowledged one goes, without anyone navigating. The check carries the live header, so it never
  counts as activity for the idle sign out.
- **No clinical detail for the desk:** the banner reads `internal.open_emergencies()`, a security
  definer function that returns only the alert, episode, visit, patient and centre ids and the time
  raised. The rule's name comes from the alert itself, which only alert readers can read.

## Where it is enforced

| Layer | What |
| --- | --- |
| `packages/schemas/src/red-flag-alerts.ts` | `alertTransition`: the moves and their refusals; `referAlertSchema`, `closeAlertSchema` |
| `apps/web/modules/alerts/services.ts` | `reviewAlert`, `referAlert`, `closeAlert`: `red_flags.act` at the alert's centre, the move, the hold |
| `red_flag_alert_read` | clinicians, or the Super Admin and Centre Managers, at a centre they see; never support |
| `red_flag_alert_act` and the column grant | clinicians at a centre they see may change only the lifecycle columns |
| `red_flag_alert_lifecycle` trigger | only the four moves; the actor columns must be the signed in clinician; a referral needs where to and a close needs a decision; it stamps the times and keeps what was recorded before |

## Tests

| Test | Covers |
| --- | --- |
| `packages/schemas/src/red-flag-alerts.test.ts` | every allowed and refused move, the order, the inputs |
| `apps/web/modules/alerts/services.test.ts` | review, refer (with and without the hold), close, refusals, who acts, what each banner shows |
| `packages/db/src/integration/intake.integration.test.ts` | readers by role, the banner function, the moves stamped and audited, the trigger's and grant's refusals, non-clinicians refused |
| `apps/web/e2e/red-flag-alerts.spec.ts` | 360 px and desktop: the desk's banner, the physio's banner and "I'm reviewing" (gone for the desk too, live), Refer (episode On hold), Close, the audit trail |

The end to end clean up (`removePipelineRows` in `e2e/intake.ts`) deletes each test's alerts: an
emergency left Raised would show its banner on every page at the centre in later tests.

**Negative check:** drop the `red_flag_alert_lifecycle` trigger and the database tests that refuse
a skipped move, and that expect the stamped times, fail.
