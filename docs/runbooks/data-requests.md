# Data requests

ADM-03: "Data requests register and patient data export". Sources:
- PRD M16: "data export and deletion requests".
- PRD section 2: "Audit log and data export | Full" for the Super Admin only.
- TAD section 5, DPDP Act 2023: "data export and deletion requests handled by the Super Admin (deletion may mean anonymising where clinical retention applies)".
- PRD decision 20, "Data retention period" (open, client and lawyer).

Every choice below is a recommended default chosen under the user's standing approval, 29 October 2026 (DECISION ADM-03), for the client to confirm.

## Who

The Super Admin only (`data_requests.manage`, `data.export`). Never Velyx support: a request and an export hold everything about a patient. Row level security refuses everyone else too.

## Recording a request

From the patient's record, **Record a data request**:
- **They ask for:** **A copy of their data**, **Correct their data** or **Delete their data**.
- **Received on:** the day it reached the clinic, never in the future.
- **What they asked for:** in the Super Admin's words: what, how they asked, how to reply. No clinical details.

It is due `privacy.request_response_days` after it was received (30, a placeholder until the client's lawyer confirms the DPDP period, DECISION ADM-03), fixed when it is recorded. **Data requests** (Home, Setup) lists them: open ones first, soonest due, an overdue one tagged **Overdue**.

## A copy of their data

While an export request is open, its page offers **Download their data**: one JSON file, `clinic-mx-<OP number>-data.json`.
- **What it holds:** the patient's row, then every row that points at them, at one of their episodes, appointments, consultations, sessions, plans of care, bills, AI sheets or patient links, from a reviewed list of tables (`internal.patient_export_tables`, used by `internal.patient_export`). Staff names and ids on their records stay: they say who cared for them.
- **What it leaves out:** other patients' cases the AI sheet was shown (AI-05 similar confirmed cases, in the sheet and in the AI run's input) and the AI provider's costs and counts; staff work items (tasks, notifications) and the audit trail, which are the clinic's records. Uploaded reports and photos are listed by their file entries, not attached; send those separately if asked.
- **A new table:** one that points at a patient fails a database test until it is reviewed: added to the list (with any columns to hide) or to the tables left out. Nothing new reaches a patient unreviewed.
- **Who and when:** the database refuses anyone but the Super Admin, and any request that is not an open export request. The download is a POST, so no link from another site starts one. Each download is audited as `export` on the request, with the address, in the Super Admin's part of the audit log (`/app/audit`).
- Send it to the patient by a channel they trust; then close the request.

## Correction and deletion

- **Correction:** correct their details on their record (audited as usual), then close the request saying what changed.
- **Deletion:** not built. It waits for the clinic's retention period (DECISION #20); clinical records may need keeping, and deletion may then mean anonymising. Record the request, tell the patient what happens, and close it with what was said.

## Closing

**What was done**, then **Close as done** or **Close as declined**. A request is closed once: the database refuses any later change, any change but closing while it is open (its id included), and removing or emptying the table (`internal.data_request_guard`; DELETE and TRUNCATE are also revoked). Who recorded and closed it are always the signed in Super Admin. The list shows open requests soonest due first, then closed ones, latest closed first.

## Tests

- `packages/schemas/src/data-requests.test.ts`: what a request holds, the due day, overdue, closing.
- `packages/db/src/integration/data-requests.integration.test.ts`: recorded and closed once by the Super Admin, kept; nobody else (Centre Manager, Finance, Front Desk, physio, Velyx support) reads, writes or exports; the export only for an open export request, holding the patient's records and never another patient's AI case, audited on the request; who recorded and closed it, its id and truncation; every table that points at a patient reviewed.
- `apps/web/e2e/data-requests.spec.ts`: record, download and close a request at 360 px and desktop; a deletion request; nobody else.
