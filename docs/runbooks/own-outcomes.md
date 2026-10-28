# My patients' outcomes

DSH-06: "Physio own outcomes". Done when: my patients' outcomes and adherence. Sources: PRD section
2 (dashboards: physiotherapists see "Own patients"), M15 ("My patients (physio)"), J5.7 (adherence
from the exercise ticks on My plan). The Frontend Specification has no screen for it. Recommended
defaults chosen under the user's standing approval, 28 October 2026 (DECISION DSH-06).

## What it shows

`/app/my-patients/outcomes`, linked from My patients ("My patients' outcomes"):

- **Whose episodes:** those whose newest plan of care names the reader as treating physio, at any
  centre (a physio who moves centres keeps their patients' outcomes). A colleague's episodes and
  figures are never shown, and there is no ranking.
- **Who may open it:** physiotherapists and the Super Admin with the Treats patients tick
  (`dashboard.own_patients`), never Velyx support. The desk, Finance and Centre Managers are sent to
  "Not allowed".
- **The figures:** the Centre Manager's Outcomes tab (DSH-03, `docs/runbooks/manager-dashboards.md`)
  with the same definitions, windows (30 days, 90 days, 12 months) and the clinic's SOP targets
  for context: treatment completion and consultation to treatment conversion (with the window
  before), the funnel, top diagnoses, and pain during activity from baseline to discharge by
  diagnosis (diagnoses with fewer than `kpi.min_outcome_episodes` episodes held back).
- **The whole funnel**, as the Centre Manager's: an episode consulted while a red flag held it On
  hold has a plan naming the physio but no proposed plan, so it shows between "Consultation held"
  and "Plan proposed".
- **Not measured yet:** meaningful change (questionnaires, OUT-02 and SET-08), reinjury (PAT-10)
  and home exercise adherence (the ticks on My plan, PAT-01 and PAT-02), each saying what brings it.

## How it works

| Part | Where |
| --- | --- |
| Who reads, and whose episodes | `internal.reads_own_outcomes()`, `internal.own_episodes()` (`*_own_outcomes.sql`) |
| The figures | `internal.own_kpi_daily` (completion and conversion as `internal.kpi_daily`), `internal.own_funnel` and `internal.own_diagnosis_outcomes` (generated from `internal.kpi_funnel` and `internal.kpi_diagnosis_outcomes`, the centre scope replaced by the reader's episodes); SECURITY DEFINER, refusing anyone else (42501) |
| Readers | `kpiDaily`, `kpiFunnel`, `kpiDiagnosisOutcomes` with `scope: 'own'` |
| Service | `outcomesFor` in `apps/web/modules/reporting/manager.ts` (shared with the Centre Manager's tab), `ownOutcomes` in `own-outcomes.ts` |
| Page | `my-patients/outcomes/page.tsx` |

The own readers are copies of the Centre Manager's: a change to those definitions must change these
too. Two database tests keep them so: "copies the centres' funnel and diagnosis definitions
exactly" compares the function definitions line for line, but for who reads and whose episodes
(and checks the outcome figures' exclusions and reasons in both); "counts only the episodes whose
plan names them" checks the two clinicians' figures add up to what the centre gained.

## Tests

| Test | Covers |
| --- | --- |
| `packages/db/src/integration/own-outcomes.integration.test.ts` | Conversion 2 of 3 and completion 1 of 1 from the reader's own episodes only, never a colleague's; only the two outcome figures; the funnel; parity with the centres' figures; the newest plan wins; any centre; diagnoses as the centres count them; refused to the desk, Finance, a Centre Manager (with the tick too), the Super Admin without the tick and support; the physio and the Super Admin who treats read theirs; over 366 days refused; `own_episodes` not callable |
| `apps/web/modules/reporting/own-outcomes.test.ts` | Reads with the own scope; the whole funnel; adherence to come; the refusals |
| `apps/web/modules/reporting/manager.test.ts` | The Centre Manager's tab unchanged (centres scope) |
| `apps/web/e2e/own-outcomes.spec.ts` | 360 px and desktop: a physio's consulted, treated and discharged episode gives completion and conversion 1 of 1 (100%), four bullets, adherence to come, five funnel stages, its diagnosis, no amounts; the desk, Finance and a Centre Manager are sent away |

**Negative checks (28 October 2026):** with `internal.own_episodes` taking the oldest plan, the
newest plan database test failed; with the opening entry exclusion taken out of `own_funnel`, the
definitions test failed.

**Review (28 October 2026):** an adversarial review found the funnel hiding an episode consulted
while a red flag held it (now the whole funnel), the parity test unable to catch the copies drifting
(now compared line for line), the database test's dates fixed when it loads (now read up to
tomorrow, so a run across midnight IST passes) and an e2e test claiming a link check it did not
make (renamed). All are fixed.
