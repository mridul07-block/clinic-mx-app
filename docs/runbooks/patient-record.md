# Patient record

The patient page at `/app/patients/<id>` (CLN-12; Frontend Specification section 6: "Patient
record: summary card, episodes, signed notes, progress tab, documents, alerts; Add addendum").

Decisions (user, 24 October 2026):

- **Centres.** Signed records are part of the patient's record wherever they were made (kickoff
  decision C1). Clinicians (`clinical.read`: the Super Admin, and staff with the Treats patients
  tick; never Velyx support) read a patient's signed consultations, their rows and addenda, the
  visit and health form behind them, precautions and the red flag alert history at any centre.
  Drafts keep their own rules. Operational lists (Alerts, the emergency banner, Today, My
  patients) keep their centre scope.
- **Record views.** Each time a clinician opens the record, and each time someone other than its
  consultant opens a signed consultation, a `view` row goes into the audit trail as them, with the
  request's address (PRD M16).
- **Tabs.** Overview, Notes, Documents and Alerts, chosen by `?tab=`, so each tab has its own
  address. Anyone without `clinical.read` (Front Desk, Centre Manager, Finance, support) sees
  Overview only, as before, whatever the address asks for. The Progress tab joins with the outcome
  tickets.
- **Documents.** Generated documents (ALT-05, `docs/runbooks/documents.md`): each with its
  newest version and the earlier ones; then the report photos and scans (ALT-08).
- **Addenda.** Each signed note on Notes opens to its addenda and "Add addendum" (the CLN-09
  component). Adding one keeps CLN-09's rule: the Treats patients tick, at the episode's centre or
  on one's own note. A clinician at another centre reads the addenda without the form.

## The tabs

| Tab | Shows |
| --- | --- |
| Overview | For clinicians, the summary card first. Then the contact details (or the edit form), episodes for those without clinical access, their invoices for those who see amounts (BIL-09), their packages' meters for the desk, physios and Finance (BIL-08), self booking, guardians and "Also on this mobile" |
| Notes | Each episode (region, status, centre, dates, discharge reason) with its signed notes, newest first: "Consultation · date, time · consultant", the diagnosis, "Open note" (the read-only consultation) and "Addenda (n)" |
| Documents | Documents (each with its newest version to open and "Earlier versions"; until one is generated, "Consultation summaries and letters appear here once they are generated."), then Reports |
| Alerts | The patient's red flag alerts at every centre, open first: rule, triage, status, lifecycle (raised, reviewed, referred, closed, who and when), decision; "Open in Alerts" for an open one the reader acts on at its centre |

The Alerts tab shows a count of open alerts, in amber.

**The summary card** is about the current episode: the newest one still open, else the newest
closed one (`currentEpisode`, `packages/schemas/src/patient-record.ts`). It shows, in this order:

1. open red flag alerts on it (linking to Alerts);
2. its precautions;
3. region, status, centre and dates;
4. the diagnosis from its newest signed note: condition, movement diagnosis, irritability, stage, Provisional;
5. the plan of care at its newest version: goals (the patient's marked), sessions a week for weeks, review date, treating physio, interventions and modalities, home programme size;
6. "Last signed note <date, time> by <name>";
7. the next Booked or Confirmed visit the reader can see, or "No visit booked."

## Where it lives

| Piece | File |
| --- | --- |
| Page | `apps/web/app/(staff)/app/(signed-in)/patients/[patientId]/page.tsx` |
| Summary card, Notes, Alerts | `.../patients/[patientId]/clinical-record.tsx` |
| Tabs (links, `aria-current`) | `apps/web/components/record-tabs.tsx` |
| Clinical part, record view | `clinicalRecordOf`, `apps/web/modules/patients/record.ts` |
| Reads | `signedNotesOf`, `episodePlan`, `episodePrecautions`, `patientAlertHistory`, `nextVisitOf`, `logClinicalView`, `packages/db/src/patient-record.ts` |
| Tab and episode choice | `patientRecordTab`, `currentEpisode`, `worksAtCentre`, `packages/schemas/src/patient-record.ts` |

## Rules

Enforced twice: the service gives the clinical part only for `clinical.read`; the database
(migration `patient_record_rules`) holds the same.

| Rule | Where |
| --- | --- |
| A signed consultation and its rows, addenda, visit and health form are read by clinicians at any centre | `internal.reads_consultation` (signed and `internal.jwt_clinical_reader()`), policy `consultation_signed_record_read` |
| Drafts are read by their consultant and clinicians at the episode's centre, as before | `internal.reads_consultation`, `consultation_read` |
| Precautions are read by clinicians at any centre | Policy `precaution_record_read` |
| The alert history is given to clinicians only; `red_flag_alert` itself stays centre scoped | `internal.patient_alert_history(patient_id)` |
| Names on a record from another centre (who signed, wrote, treats; the centre) are read by clinicians | `internal.record_staff_name`, `internal.record_centre_name` |
| Addenda are added only at the episode's centre, or on one's own note | `internal.adds_addendum` (the centre tested directly) |
| A record view is written only by a clinician, as the transaction's own staff member | `internal.record_view(entity, id)` |

## Checking it

| Test | Covers |
| --- | --- |
| `packages/schemas/src/patient-record.test.ts` | Tabs for clinicians and others; the current episode; who works at a centre |
| `apps/web/modules/patients/record.test.ts` | The summary for the open episode; one record view; addenda only at one's centres or on one's own note; nothing and no view for the desk, a manager or support |
| `apps/web/modules/consultations/services.test.ts` | A signed consultation from another centre: read only, no addendum form, the treating physio's name, a record view; none for its own consultant |
| `packages/db/src/integration/clinical-record.integration.test.ts` ("the patient record") | Under row level security: a Koramangala physio and the Super Admin without the tick read an HSR signed note, its diagnosis, plan, addenda, precautions, alert history and visit, but the Alerts list still leaves the alert out; drafts stay at their centre; another centre adds no addendum; the desk, a manager, Finance and support read none of it; a record view is written as the clinician and refused for the desk |
| `apps/web/e2e/patient-record.spec.ts` | At 360 px and desktop: a Koramangala physio reads the summary, Notes (no addendum form), Documents and Alerts, with a record view logged; the consultant adds an addendum from Notes; the desk sees no tabs and no clinical details |

Without the signed clause in `internal.reads_consultation`, the database test "is read by
clinicians at any centre" fails.
