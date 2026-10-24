# Consultation

The consultation screen at `/app/consultations/<id>` (CLN-02; PRD J3.2: "Consultation screen
sections: Subjective, Screening, Objective, Assessment, Plan, Sign. Everything autosaves.";
Frontend Specification "Consultation": "Vertical stepper … one section at a time on phones with
Next pinned").

Decisions (user, 24 October 2026):

- **Each section holds a notes box** for now. CLN-03 to CLN-07 add the structured fields
  (source labels, the screening items, measures, the diagnosis, the plan of care) beside it, and the
  box stays as the section's notes.
- **No consultation before the health form.** The health form (with Part A consent) opens the
  episode the consultation belongs to. Until it is submitted, Start consultation says "The health
  form is needed before the consultation. The front desk can open it on the tablet."
- **Desktop:** the vertical stepper on the left, one section on the right with Back and Next.
  **Phones:** one section per screen, "Step 3 of 6", Back and Next pinned at the bottom. The step is
  in the address (`?section=objective`), so a reload or the browser's Back stays put.

## Opening it

Start consultation on My patients today (`startVisit`, `apps/web/modules/my-patients/services.ts`)
marks the visit In progress and opens its consultation in the same transaction
(`openConsultation`, `packages/db/src/consultations.ts`), then goes to the screen. Opening is
once per appointment; a repeat finds the same one. It needs:

- a Consultation type visit, checked in, on its day, by its own physio (CLN-01's rules);
- the Consultant tick (`consultant_records.write`): "Only a consultant starts a consultation.";
- the episode the health form opened (see above);
- a knowledge base version: the consultation keeps the newest one (rule 4). Before the first
  import: "The knowledge base is not loaded yet. Ask the Super Admin to import it."

Once started, the row on My patients today shows "Open consultation". Start session is unchanged
(SES-03 opens the session note).

## The steps

Subjective, Screening, Objective, Assessment and Plan each have a "Notes" box (up to 10,000
characters). On desktop a filled dot in the stepper marks a section with notes. Sign lists the five
sections as "Notes added" or "Nothing yet", each with Edit. The Sign and finish button and its gates
(screening complete, CLN-04; the tick at signing, CLN-09) come with those tickets. Nothing here
signs.

## Subjective (CLN-03)

What the patient told us on the health form, field by field, with a source label (Frontend
Specification "Source label"). Decisions (user, 24 October 2026):

- **Fields**, grouped as on the form, with the form's own wording (`subjectiveGroups`,
  `packages/schemas/src/subjective.ts`):
  - **The problem:** region, pain site (body chart), main complaint, onset, how it started,
    duration, pain now, pain with activity, aggravating and easing factors;
  - **Activity and goal:** activities (and Other, when ticked), level, hours per week, goals;
  - **History:** previous injuries, surgeries, investigations, regular medicines;
  - **About the patient:** occupation and dominant side.
  
  Warning signs and the health check belong to Screening (CLN-04).
- **Labels:**
  - "Patient reported" shows the patient's answer;
  - "Not answered" means the patient left it empty;
  - "Clinician confirmed" appears once the clinician changes the field, and only then. An untouched
    answer stays Patient reported.
- **The patient's words stay:** an edited field shows "Patient reported: …" (or "nothing")
  beneath it.

Only the clinician's changes are stored, in `sections.subjective.confirmed` (by field key), each
checked against its field: a known choice, a whole number in range, text within its length, or
known body chart zones. Empty means the clinician cleared it. The patient's answers are read live
from the submitted health form, which never changes. Below the fields, "Other notes" is the
section's notes box. Sign counts the confirmed fields ("3 confirmed").

The answers reach the consultant through `internal.consultant_health_form(visit)`
(`consultationIntake`, migration `consultation_subjective_rules`). It is a SECURITY DEFINER
function that returns the submitted form only to the visit's own treating physio. Staff otherwise
read only a few columns of `intake_response` (INT-11), so the front desk never sees the answers.

## Autosave

The screen adopts FND-08 (`docs/runbooks/autosave.md`): one draft per consultation (kind
`consultation`) holds every section, so moving between steps never splits an edit. It is saved by
`PUT /app/consultations/<id>/save` (`saveConsultation`, `apps/web/modules/consultations/services.ts`)
at the version it started from: 200 `saved`, or 409 `conflict` with the saved sections ("Keep my
version" or "Use the saved version"). Offline, "Saved on this device" and the "Offline, changes will
sync" bar; the draft is sent on reconnect, also from a closed screen (`draftSavers.consultation`).

## Rules

Enforced twice. The service: only its own consultant opens or saves it; a signed one refuses with
"This consultation is signed. Changes are addenda." The database (migration `consultation_rules`):

| Rule | Where |
| --- | --- |
| Read by its consultant, and by clinical staff (Treats tick) at the episode's centre (CLN-12 shows it) | Policy `consultation_read` |
| Opened only by the appointment's physio with the Consultant tick, on their checked in or started visit, on that visit's episode, as a draft | Policy `consultation_open` |
| Saved only by its consultant while a draft | Policy `consultation_save` |
| While a draft only `sections` (and `version`, `updated_at`) change; a signed one never changes (23514) | Trigger `consultation_guard` |
| Signed exactly when `signed_at` and `signed_by` are set | Check `consultation_signed` |
| Velyx support never writes; nobody deletes; every change audited | Restrictive policies, `audit_change` |

Each save is an audited update (actor, before, after), one per autosave.

## Checking it

| Test | What it checks |
| --- | --- |
| `packages/db/src/integration/consultations.integration.test.ts` | Under row level security: opened once with the knowledge version and the episode; saves bump the version, a stale one conflicts, audited as the consultant. Refused: another consultant, a booked visit, a physio without the Consultant tick, support (42501); another consultant updates nothing, the desk reads nothing; changing the physio or episode (23514); a signed one (nothing as the consultant, 23514 as the owner). |
| `apps/web/modules/consultations/services.test.ts` | Own consultation only, every section; save at the version; conflict answers the saved sections; signed, someone else's, no tick, support refused. |
| `apps/web/modules/my-patients/services.test.ts` | Start consultation opens the consultation; refused without the Consultant tick, before the health form, or before the knowledge base. |
| `packages/schemas/src/consultations.test.ts`, `apps/web/lib/drafts/savers.test.ts` | Sections, steps, Back and Next; the saver's endpoint. |
| `packages/schemas/src/subjective.test.ts` | The form's fields and wording; sources; answers checked against their fields; Other shown only when ticked. |
| `apps/web/e2e/consultation.spec.ts` | 360 px and desktop. Start consultation opens Subjective; notes save; Next pinned in view at 360 px, the stepper on desktop; a reload keeps the step and the notes; Back; Sign lists the sections; offline then reconnect saves; refused before the health form, then opens; the desk cannot open it. Subjective (CLN-03): the form's answers Patient reported, a blank one Not answered; edits to the complaint, pain and surgeries become Clinician confirmed with the patient's words beneath, untouched ones stay; the body chart on desktop; saved and kept through a reload; Sign counts them. |

The database test also checks that the consultant reads their visit's submitted form, and another
physio and the desk read nothing.

Negative checks: when `consultant_health_form` does not check the physio, the "nobody else" database
test fails (CLN-03). Without the `consultation_guard` trigger, the "keeps who, where and which version
fixed" and "never changes once signed" database tests fail (CLN-02).
