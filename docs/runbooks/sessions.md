# Treatment sessions

## Session check in (SES-01)

Sources: PRD J5.1 ("One tap check in shows 'Session n of N, consent and payment complete'") and M9 (check in gate), and the Frontend Specification ("Gate blocked: 'Consent and payment are needed before the first session.'"). Decisions made by the user on 25 October 2026.

### What a session is

An appointment whose type is in `packages.session_appointment_types` (Session, Zero Gravity Treadmill). The same setting decides package sessions for the reschedule allowance (SCH-10, `docs/runbooks/calendar.md`). Consultations and reviews are not sessions.

### Session n of N

- **N:** the planned sessions of the episode's newest plan (sessions per week × weeks). Without a frequency the label is "Session n" alone. The package meter stays separate (BIL-08).
- **n:** once a session appointment of the episode is checked in, it is 1 + the episode's earlier checked in, in progress or completed session appointments, in order of arrival. No-shows and cancellations never count. Undoing a check in gives the number back, because n is worked out on read.
- SES-03 stores the session row with its number when the session starts.
- **The read:** `internal.session_progress(appointment_ids)` (SECURITY DEFINER, `supabase/migrations/20261025175542_session_progress_rules.sql`) returns the number, the planned total and the episode's status. It answers only for appointments at centres the reader sees, so the front desk gets N without reading the plan. `sessionProgress` in `packages/db/src/sessions.ts` wraps it, and `sessionView` and `sessionGate` in `packages/schemas/src/sessions.ts` give the words.

### The gate

| Episode | Gate | What is shown |
| --- | --- | --- |
| Active, Under review (the chosen plan is paid, BIL-06) | Met | "Session 1 of 12, payment complete", and "Part B consent is not checked yet." |
| Intake pending, Awaiting consultation, Plan proposed | Blocked | "Consent and payment are needed before the first session." |
| On hold, Discharged, Lost to follow up | Blocked | "The episode is On hold." (and so on) |
| No episode | Blocked | "Not part of an episode yet." |

- **Check in:** the front desk can still check the patient in, because they are here.
- **Where the gate shows:**
  - the check-in drawer's Session section
  - Today ("Session n of N" and "Gate blocked" tags)
  - My patients ("Gate blocked: …" in place of Start session)
- **Enforced:** `startVisit` (`apps/web/modules/my-patients/services.ts`) refuses Start session with the gate's message while it is blocked.
- **Consent (DECISION SES-01):** Part B consent (BIL-03) waits for the client's texts. Until then payment alone gates, and BIL-03 adds consent to `sessionGate`.

### Tests

| Test | Covers |
| --- | --- |
| `packages/schemas/src/sessions.test.ts` | the label with and without a frequency; the gate per status; the view |
| `packages/db/src/integration/clinical-record.integration.test.ts` (session check in) | numbered 1, 2, 3 in check-in order, a treadmill visit counted, a review and a consultation not; undo gives the number back; planned from the plan; the physio reads it; the desk at another centre gets nothing; the status before payment |
| `apps/web/modules/my-patients/services.test.ts` | Start session refused for Plan proposed, On hold and no episode; allowed for Under review and for other types |
| `apps/web/e2e/session-check-in.spec.ts` | 360 px and desktop: a paid package episode's session checked in through the drawer, "Session 1 of 12, payment complete"; Today's tags; the physio starts it; an unpaid patient's session held at the gate with no Start session |

**Negative check:** make `sessionGate` always met, and the Start session unit test fails.
