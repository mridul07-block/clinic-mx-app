# Report photos and scans

ALT-08, with INT-02 (the desk adds them at check in) and INT-05 (the patient adds them on the
health form). TAD section 9, rule 9 (the browser never calls `*.supabase.co`), rule 10 (access is
enforced twice).

## The path of a report

| Step | Where | What happens |
| --- | --- | --- |
| **1. On the phone** | `apps/web/lib/shrink-photo.ts` | A photo is redrawn in the browser at most 1600 px on its longest side, as a JPEG (quality 0.82). A PDF goes as it is. A photo the browser cannot redraw goes as it is. |
| **2. Checked** | `apps/web/modules/front-desk/report-files.ts` | Only JPEG, PNG and PDF, by their first bytes, not the name. At most `reports.max_file_mb` (4 MB ceiling, the hosting limit). |
| **3. Stored** | `report-store.ts` | Our server writes the file to the private `reports` bucket as `<patient id>/<report id>.<ext>`, with the service role. No browser ever reaches the bucket. |
| **4. Recorded** | `patient_report` | One row per file, audited: the kind, size, visit, and who added it (a staff member, or the patient's link). |
| **5. Opened** | `/app/reports/<id>` | Clinicians only (below). The file is sent from our domain, `inline`, `private, no-store`, `nosniff`. |

## Who sees what (user decisions, 23 October 2026)

| Who | The list (kind, size, who added it, when) | The file |
| --- | --- | --- |
| Clinicians: the Super Admin, and Managers and physios with the Treats patients tick (`clinical.read`), at any centre | "Reports" on the patient record | Opens full size in a new tab |
| Those who check in (Front Desk, Centre Managers) | In the check-in drawer, to see what was added | Never; the drawer says "Only clinicians open reports, from the patient record." |
| Velyx support | As the desk does | Never |
| Finance | None | Never |
| The patient (their health form link) | Their own reports on that form | Never shown again |

When the reader cannot see the staff member's name (staff rows are visible only at shared centres),
the list says "staff". A report the patient added says "the patient".

## Where it is enforced

| Layer | What |
| --- | --- |
| `apps/web/modules/reports/services.ts` | `reportsOfPatient` and `reportFile` need `clinical.read`; anyone else gets an empty list or "not found", and the bucket is never touched |
| `patient_report_clinical_read` | Clinicians read the rows at any centre; support never |
| Column grant | No staff member selects `file_path` from the table at all |
| `internal.report_file(id)` | A security definer function: gives the file's path to a clinician only, nothing to anyone else |
| The `/app` proxy | A signed out request goes to sign in before the route runs |

## Tests

| Test | Covers |
| --- | --- |
| `apps/web/modules/reports/services.test.ts` | A clinician gets the list and the file; the desk, Finance, a manager without the tick and support get nothing, and the bucket is not touched |
| `packages/schemas/src/today.test.ts` | Report sizes and who added it, in words |
| `packages/db/src/integration/intake.integration.test.ts` | A physio at another centre and the Super Admin get the file; the desk and a manager list it without the file; support lists it; Finance sees nothing; no staff member reads `file_path` (42501) |
| `apps/web/e2e/reports.spec.ts` | 360 px and desktop: the desk adds a 3000 by 2000 photo; a physio at Koramangala opens it as a 1600 by 1067 JPEG, `private, no-store`; the desk sees no Reports and gets 404; signed out goes to sign in |

**Negative check:** drop `patient_report_clinical_read` and the database test and the end-to-end
open both fail.
