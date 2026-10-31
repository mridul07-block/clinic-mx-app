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
- a knowledge base version: the consultation keeps the live one (rule 4; the newest approved,
  or before any approval the newest import, SET-06). Before the first
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

## Screening (CLN-04)

PRD J3.3: "Region specific red flag and precaution screening is mandatory; the record cannot be
signed without it." Decisions (user, 24 October 2026):

- **Each item is a deliberate check.** Nothing is preselected. Beside each item is what the patient
  said ("Patient said: No", "3 kg", "Not answered"), and the clinician taps Yes or No (or enters the
  number).
- **Each precaution is its own item**, confirmed Yes or No. Pregnancy is listed only for a female
  patient.
- **A confirmation that differs from the patient** is recorded and tagged "Changed from the
  patient's answer".
- **Red flag found** (CLN-11, below the items): the consultant records what they found in one of
  the framework's five categories (`docs/runbooks/red-flag-alerts.md`). Every category but
  Monitor with caution asks where to, the reason and the question for the specialist, puts the
  episode On hold and generates the referral letter; the safety advice is queued. The red flags
  recorded in the consultation are listed there, read only once it is signed. Signing is not
  held back by a red flag.

**The items** come from `screeningItems` in `packages/schemas/src/screening.ts`:
- the framework's red flag questions for the region Subjective shows (the clinician's change, else
  the patient's): the universal ones, plus the back or neck ones (`questionsFor`);
- the weight loss follow-ups (how many kg, over how many months), asked once the clinician confirms
  weight loss Yes;
- then each health check condition, without "None of these".

The wording is the framework's and the form's, as the patient saw it. Each item shows "Not
confirmed", "Confirmed" (same as the patient) or "Changed from the patient's answer".
Confirmations are stored in `sections.screening.confirmed` by item key (question keys and
`precaution.<value>`), each checked against its item. A confirmation left on an item that is no
longer asked (after a region change) is kept but not counted.

**The gate:** `signingBlockers(sections, patientAnswers)` (`packages/schemas/src/consultations.ts`)
gives "Signing needs every screening item confirmed: n left." until every item asked is confirmed.
The Sign step shows it under "Before signing" with a link to Screening, or "Screening complete."
**CLN-09's sign service must refuse on any reason from `signingBlockers`**, computed on the server
with the answers from `consultationIntake`. The page alone is not the gate.

## Objective (CLN-05)

PRD J3.4: side by side measures with an automatic deficit or LSI, special test rows, and 0 to 3
quality ratings. Decisions (user, 24 October 2026):

- The measures are each region's own, from its workbook's Progress Tracker, imported into the
  knowledge base (`docs/runbooks/knowledge-base.md`).
- The special tests are added from the region's Special Tests sheet.
- The 0 to 3 ratings are built without definitions: no source gives them, so the line "Grade
  definitions are awaiting the clinic." shows (DECISION CLN-05 in `docs/PROGRESS.md`).

**Region and side.** The region defaults to Subjective's region's workbook (back is Lumbar spine
and SIJ, neck is Cervical spine, wrist and hand is Forearm and wrist), and any of the 9 can be
chosen. The involved side is Left or Right.

**Measures,** under the workbook's section titles, in the workbook's words and units:

- **LSI** (involved and uninvolved): "LSI 80% · Not yet", Pass at the workbook's target (0.9). A
  timed hop is uninvolved over involved. The heel raise also needs 25 repetitions.
- **Deficit** (range, involved and uninvolved): "Deficit 12 deg · Mild deficit", banded as each
  workbook bands it.
- **Against a reference:** one value with "Normal 80 deg" (Full, Mild deficit, Restricted) or
  "Target 30 mmHg" (Pass, Not yet).
- **Markers:** one value with its direction ("Lower is better").
- **Grades:** 0, 1, 2 or 3 with the direction.

`measureResult` (`packages/schemas/src/objective.ts`) does the workbook's arithmetic live. It shows
nothing until both inputs are there, and never divides by zero.

**Special tests:** "Add a test" lists the region's tests by category. Each added test shows its
targets and "Positive finding: ...", a result (Positive, Negative or Not tested, as the Frontend
Specification words it) and a one-line interpretation (up to 200 characters).

**Storage.** Everything lives in `sections.objective` (region, side, measures by key, tests),
autosaved with the draft. A measure emptied of values is no longer recorded. The page reads the
measures and tests of the consultation's own knowledge base version (`knowledgeObjective`), so a
later import never changes an open consultation. **When signing arrives (CLN-09), the signed values
are written to the TAD's `measure` and `special_test_result` rows** for the baseline (J5.3) and
the Progress tab.

## Assessment (CLN-06)

PRD J3.6: a four part working diagnosis (tissue diagnosis from the knowledge base, movement
diagnosis, irritability suggested from pain, stage from duration) and the client's diagnosis
category, coded automatically. The parts are the client's Consultation SOP v2 §10.1 ("A diagnosis
missing any of these components is incomplete"). Decisions (user, 24 October 2026):

- **Tissue diagnosis:** one knowledge base condition. Anything outside the knowledge base goes in
  Notes.
- **Movement diagnosis:** one line of text (200 characters). The chosen condition's "Underlying
  biomechanical cause" from each workbook that lists it shows beneath as a reference.
- **Irritability:** suggested from the worse of Pain now and Pain with activity (the clinician's
  value where Subjective changed it).
- **Category:** the client's 44 categories are knowledge data. A condition mapped to one (SET-12's
  draft, 245 of 332) suggests it, shown as chosen with "Suggested from the condition"; the
  clinician can change it, and choosing another condition keeps a category they picked. For a
  condition with none, the clinician picks.

**Search.** "Tissue diagnosis" is a combobox over the consultation's version: every word typed must
appear in the name, a synonym, a workbook's name for it or the ID (case and accents ignored).
Conditions the Objective's workbook lists come first, then names starting with the first word; at
most 20. Arrow keys, Enter and Escape work; the chosen condition shows as a card with Change (and
"Keep ..." to go back).

**Suggestions, never chosen for the clinician** (rule 3), each marked "Suggested" with its reason:

| Part | Suggested from | Bands (settings) |
| --- | --- | --- |
| Irritability (High, Moderate, Low) | The worse of Pain now and Pain with activity, "worst 7/10 (pain with activity)" | Above `assessment.irritability_high_above` (5) High; below `assessment.irritability_low_below` (3) Low; else Moderate |
| Stage (Acute, Subacute, Chronic, Reactive, Degenerative) | Duration and its unit in weeks (days / 7; months 365.25 / 12 days; years 365.25 days), "6 weeks" | Under `assessment.acute_weeks_below` (3) Acute; over `assessment.chronic_weeks_above` (12) Chronic; else Subacute. Reactive and Degenerative are never suggested |

The settings are placeholders from the SOP until the client confirms them (DECISION CLN-06 in
`docs/PROGRESS.md`). So 3 months (13 weeks) reads Chronic. The SOP's clinical features for each
irritability level show beneath it, word for word.

**Provisional** is ticked by default: the confirmed diagnosis is the one at review or discharge
(TAD "learning label").

**Signing.** `signingBlockers` now also lists "The working diagnosis needs its four parts: tissue,
movement, irritability and stage." until all four are in; each reason links to its section. The
category is not required (87 conditions have no suggestion). Sign shows "n of 4 parts".

**Storage.** Everything lives in `sections.assessment` (condition ID, movement, irritability, stage,
category code, provisional), autosaved with the draft; older drafts read with empty parts. The
page reads the consultation's own version (`knowledgeAssessment`) and the settings once, so it works
offline. **When signing arrives (CLN-09), the TAD's `diagnosis` row is written** with the version;
the sign service checks the condition and category exist in that version and keeps the
clinician's category, or the condition's suggested one when none was chosen.

## Plan (CLN-07)

PRD J3.7: goals (the patient's own among them), interventions, modalities checked against
precautions, frequency, home programme, review dates and outcome questionnaires; the ticket adds the
treating physio. Decisions (user, 24 October 2026):

- **Precaution links** are drafted from the client's documents into the plan catalog (knowledge
  data, `docs/runbooks/knowledge-base.md`), each citing its source and marked "Awaiting clinical
  sign-off":

  | Modality | Warns about | Source |
  | --- | --- | --- |
  | Electrotherapy (US, IFT, TENS, EMS, combination) | Implant, pregnancy | Blueprint Part B statement |
  | PEMF | Implant, pregnancy | Blueprint Part B statement |
  | Radial and Focused Shockwave | Bleeding, pregnancy, cancer, chronic infection | Blueprint Part B (RSW) and SOP v2 §12.3 |
  | Spinal DSO traction | Osteoporosis | Blueprint Part B statement |
  | Laser, Dry needling, Zero Gravity Treadmill | Nothing | No source names one |

- **A warned modality** shows an amber Precaution block with each precaution, who said so ("Patient
  ticked" or "Confirmed" in Screening) and the source. Keeping it needs a one-line "Reason to keep
  it"; signing waits for one.
- **Home programme:** rows typed by the physio (exercise, dose, note), with the condition's
  "Physiotherapy specific exercise" from its workbooks beneath. Knee and Bone Stress have no such
  column. Picking from the exercise library with videos comes with SET-07.
- **Questionnaires:** the Objective workbook's instruments and PSFS (Blueprint Module 8). Those
  whose "Use for" names the chosen condition are ticked and marked "Suggested" until the clinician
  changes the list.

**Precautions in force** (`precautionsInForce`): each one the clinician confirmed yes in Screening,
and each one the patient ticked that the clinician has not answered. A Screening "No" clears the
patient's tick.

**Questionnaire suggestion** (`suggestedQuestionnaires`): the "Use for" is split into terms at
commas and slashes. A term matches when each of its words is in the condition's name or synonyms
(case and accents ignored; words of 5 letters or more compare on their first 5, so "meniscus" meets
"Meniscal"). Patellar Tendinopathy suggests VISA-P; a meniscal tear suggests KOOS; PSFS is never
suggested.

**The rest:**

- **Goals:** up to 20 lines. "Add as a goal" copies the patient's goals (Subjective's value) as a
  row marked "Patient's goal".
- **Interventions:** Exercise, Manual therapy, Movement retraining, Technology-assisted
  interventions (the Blueprint's treatment note).
- **Frequency:** sessions a week (1 to 7) and weeks (1 to 52).
- **Investigations advised** and **Referral advised** (ALT-06, user decision 25 October 2026;
  SOP section 14.1): optional, up to 500 characters each, in the clinician's own words; the
  consultation summary prints each only when filled. Signing stores them on `plan_of_care`
  (`investigations_advised`, `referral_advised`).
- **Review date:** defaults to the visit's date plus `clinical.review_weeks` (6); OUT-06 books it.
- **Treating physio:** the active staff with the Treats patients tick at the visit's centre
  (`treatingPhysios`), defaulting to the consultant, who is always offered even where not assigned
  to that centre.

**Storage.** Everything lives in `sections.plan`. `''` (review date, treating physio) and `null`
(questionnaires) mean the default; `resolvedPlan` fills them in, on screen and for the sign service.
**When signing arrives (CLN-09), the TAD's `plan_of_care` and `plan_modality` rows are written**
from the resolved plan; Part B consent (BIL) reads the planned modalities. Sign shows "n of 5 parts"
(goals, interventions, modalities, frequency, home programme).

## Signing (CLN-09)

PRD J3.9: signing locks the record; later changes are addenda. Signing needs the Treats patients
tick, checked at that moment (TAD). Decisions (user, 24 October 2026):

- Signing completes the visit (In progress to Completed) in the same transaction; the physio lands
  on My patients today, where it shows Done.
- A special test added without a result holds signing back ("Not tested" is a result). A side by
  side measure with one side entered is kept as that side only.
- "Sign and finish" asks once: "Signing locks this consultation. Later changes are addenda." with
  Sign and Keep editing.
- Addenda are added on the signed consultation by clinicians who read it.

**What Sign checks** (`signingBlockers`, on screen and again on the server): every screening item
confirmed; the four part working diagnosis; a result for each special test; a reason for each
modality kept despite a precaution. Each reason links to its section. "Sign and finish" is off
until none is left.

**What signing does** (`signConsultationService`, one transaction under row level security):

1. Saves the device draft first and signs only the version just saved (`saveNow`); a newer save
   answers "Your latest changes are still saving. Try again."
2. Reads the Treats patients tick from the staff record now (not the token).
3. Runs the gates again with the health form and the consultation's own knowledge base version,
   and `signedRecord`, which refuses anything the version no longer holds (condition, category,
   measure, test, modality, questionnaire) or a treating physio who does not treat there.
4. `signConsultation`: the consultation becomes signed (who, `now()`), then the record's rows are
   written and the visit completed:

   | Table | From |
   | --- | --- |
   | `measure` | Objective: one row per side entered (`limb` involved or uninvolved, `side` from the involved side, the other side for uninvolved), single values without a limb; the unit from the knowledge base |
   | `special_test_result` | Objective's tests and results |
   | `diagnosis` | Assessment: the condition (a foreign key into its version), movement, irritability, stage, provisional; the category is the clinician's, else the condition's suggested one |
   | `plan_of_care` (version 1) | Plan, resolved: goals and home programme rows left blank are dropped; the review date, questionnaires and treating physio defaults filled in |
   | `plan_modality` | Plan's modalities and their reasons (parameters with SES-05) |

Signing also queues, in the same transaction and through the database (staff cannot add jobs),
the consultation summary and its WhatsApp message (ALT-06, PRD J4.1): the summary is
generated by the queue and appears on the patient record's Documents tab; the message waits
for the WhatsApp tickets. Each addendum queues the summary's next version, which prints it.
See `docs/runbooks/documents.md`.

## Addenda (CLN-09)

A signed consultation opens read only, with "Signed by <name> on <date, time>. Changes are
addenda." on every step, for its consultant and for clinicians (the Super Admin, and staff with
the Treats patients tick) at any centre (CLN-12, kickoff decision C1); the patient record's Notes
link to it, and an open by anyone but its consultant is a record view
(`docs/runbooks/patient-record.md`). Sign shows the addenda (who, when, the text) and "Add
addendum" (up to 5,000 characters) for clinicians with the tick at the episode's centre, and for
its consultant. Addenda never change.

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
| Signed only by its own consultant, active with the Treats patients tick at that moment, changing only status, who and when | Policy `consultation_sign`, trigger `consultation_guard` (`internal.staff_treats`) |
| The record's rows written only in the signing transaction (`signed_at = now()`), by the signer, on the consultation's episode and version; never updated or deleted | Policies `*_sign` (`internal.signing_consultation`); no update or delete policies |
| The record, its addenda, its visit and its health form read by its consultant, clinicians at the episode's centre, and once signed clinicians at any centre (CLN-12) | `internal.reads_consultation`, `consultation_signed_record_read`, `appointment_signed_consultation_read`, `consultant_health_form` |
| Addenda added by clinicians with the tick now, on a signed consultation at the episode's centre (or their own), as themselves | Policy `addendum_add` (`internal.adds_addendum`, replaced by `patient_record_rules`) |
| A physio completes their own started visit only once its consultation is signed | Trigger `appointment_physio_change` |

Each save is an audited update (actor, before, after), one per autosave.

## Checking it

| Test | What it checks |
| --- | --- |
| `packages/db/src/integration/consultations.integration.test.ts` | Under row level security: opened once with the knowledge version and the episode; saves bump the version, a stale one conflicts, audited as the consultant. Refused: another consultant, a booked visit, a physio without the Consultant tick, support (42501); another consultant updates nothing, the desk reads nothing; changing the physio or episode (23514); a signed one (nothing as the consultant, 23514 as the owner). |
| `apps/web/modules/consultations/services.test.ts` | Own consultation only, every section; save at the version; conflict answers the saved sections; signed, someone else's, no tick, support refused. |
| `apps/web/modules/my-patients/services.test.ts` | Start consultation opens the consultation; refused without the Consultant tick, before the health form, or before the knowledge base. |
| `packages/schemas/src/consultations.test.ts`, `apps/web/lib/drafts/savers.test.ts` | Sections, steps, Back and Next; the saver's endpoint. |
| `packages/schemas/src/screening.test.ts` | Region questions (knee, back, none), follow ups only after a confirmed yes, pregnancy only for a female patient, what the patient said, progress ignoring stale keys, the signing gate, answers checked against their items. |
| `packages/schemas/src/assessment.test.ts` | Irritability bands at 2/3 and 5/6 from the worse score, settings honoured; durations in weeks and the stage at 3 and 12 weeks; the clinician's Subjective answers first; search by name, synonym and ID with the Objective's workbook first; the four parts, old drafts, limits and the signing reason; the categories file shape. |
| `packages/schemas/src/signed-record.test.ts` | The rows signing writes: both sides with their sides, single values, one side kept, the clinician's category over the condition's suggestion, the suggestion when none was chosen, defaults resolved, blanks dropped; everything the version no longer holds refused; the special test result reason; the addendum's length. |
| `packages/db/src/integration/clinical-record.integration.test.ts` | Under row level security: signing writes the rows and completes the visit, audited as the consultant; a signed consultation and its rows never change, and no rows are written outside the signing transaction; another physio, support or a deactivated consultant (token still saying treats) cannot sign, nor at another version; a visit is completed only once signed; addenda by the consultant and a colleague at the centre, not on a draft, not as someone else, not by the desk, another centre or support, who also read nothing. Removing the live tick check fails it. |
| `apps/web/lib/drafts/controller.test.ts` | `saveNow` answers the saved version, or nothing while changes stay unsaved. |
| `packages/schemas/src/plan.test.ts` | Precautions in force (a Screening confirmation over the patient's tick, pregnancy only for a female patient); warnings and the reason to keep a modality; the signing reason; questionnaires offered and suggested (VISA-P, KOOS, Kujala, none for PSFS); defaults resolved; parts, old drafts and limits; the catalog file shape. |
| `packages/db/src/knowledge/plan-catalog.test.ts` | The committed catalog: 8 modalities with their links (PEMF, shockwave, traction, laser), 19 questionnaires, QuickDASH for elbow and wrist; repeated keys, repeated or unknown precautions stop the import. |
| `packages/db/src/knowledge/categories.test.ts` | The committed file: 44 categories in order, SET-12's 245 mapped; a mapping to an unknown condition or category, or a repeated code, stops the import. |
| `packages/schemas/src/objective.test.ts` | LSI, inverted LSI, heel raise count, deficit bands (absolute and not), reference and target, the Objective section and its limits. |
| `packages/db/src/knowledge/build.test.ts` | Against the real workbooks: LSI targets, the timed hop, the heel raise, each workbook's bands, cervical references, joint position error at most, 10 grades, special tests with their categories; an unknown header stops the import. |
| `packages/schemas/src/subjective.test.ts` | The form's fields and wording; sources; answers checked against their fields; Other shown only when ticked. |
| `apps/web/e2e/consultation.spec.ts` | 360 px and desktop. Start consultation opens Subjective; notes save; Next pinned in view at 360 px, the stepper on desktop; a reload keeps the step and the notes; Back; Sign lists the sections; offline then reconnect saves; refused before the health form, then opens; the desk cannot open it. Subjective (CLN-03): the form's answers Patient reported, a blank one Not answered; edits to the complaint, pain and surgeries become Clinician confirmed with the patient's words beneath, untouched ones stay; the body chart on desktop; saved and kept through a reload; Sign counts them. Screening (CLN-04): a back pain form shows the back questions and pregnancy, no neck questions or follow ups, "0 of N"; Sign is blocked with "N left"; weight loss Yes adds the follow ups; the saddle Yes is marked changed; diabetes Confirmed; with all confirmed, Sign no longer names screening but still waits for the working diagnosis; kept through a reload. Objective (CLN-05): a knee form defaults to Knee; quadriceps 32 and 40 "LSI 80% · Not yet", then 36 "LSI 90% · Pass"; the timed hop 2.4 and 2.2 "LSI 92% · Pass"; effusion grade 2; Lachman added Positive with its positive finding and an interpretation; saved, kept through a reload; Sign shows "4 recorded". Assessment (CLN-06): Sign's "Go to Assessment"; "patellar tend" lists Patellar Tendinopathy (KNE-004, Knee) first and Enter chooses it; the Knee workbook's cause shows; with pain 4 now and 7 with activity, High is suggested and nothing selected, Moderate chosen; 6 weeks suggests Subacute, chosen; category Knee - PFPS; Provisional ticked; saved, kept through a reload; Change with no match keeps the condition; Sign shows "4 of 4 parts" and no diagnosis reason. Plan (CLN-07): with pregnancy and a bleeding disorder ticked, the patient's goal added and a second goal; Exercise; Radial Shockwave warns about both, "Awaiting clinical sign-off"; Sign waits for a reason and "Go to Plan" returns; the reason, 2 a week for 6 weeks, an exercise and dose; the review date is the visit plus 6 weeks; VISA-P ticked and Suggested, KOOS added; the consultant is the treating physio; saved, kept through a reload; Sign shows "5 of 5 parts". Signing (CLN-09): a ready draft with Lachman unanswered is held back and "Sign and finish" is off; Negative chosen, Sign and finish, the confirmation, Sign; back on My patients today; the record's rows and the completed visit in the database; reopened read only with "Signed by"; the consultant adds an addendum; a colleague at HSR Layout opens it and adds one. |

The database test also checks that the consultant reads their visit's submitted form, and another
physio and the desk read nothing.

Negative checks: with the LSI worked out the wrong way round, two objective unit tests fail
(CLN-05). When `screeningProgress` calls screening complete regardless, two screening unit tests
fail (CLN-04). When `consultant_health_form` does not check the physio, the "nobody else" database
test fails (CLN-03). Without the `consultation_guard` trigger, the "keeps who, where and which version
fixed" and "never changes once signed" database tests fail (CLN-02).
