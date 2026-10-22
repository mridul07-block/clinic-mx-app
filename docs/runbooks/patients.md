# Patients

SCH-01, PRD M1, TAD sections 3 and 4.

## The rules

- **Keyed by person, not phone number.** Several patients can share one mobile, so a family can
  use one number. The mobile is not unique.
- **One record, every centre.** Every signed in staff member, in any centre, can find and read
  every patient (PRD J7.6).
- **New patients need little.** A name and a mobile are enough (Frontend Specification, New
  booking). Email, date of birth, sex and occupation are optional; the health form fills them
  later.
- **Who changes them.** The Super Admin, Centre Managers and the Front Desk add patients and edit
  their details (`patients.edit_contact`). Physiotherapists and Finance read them only
  (`patients.view_contact`). Nobody deletes a patient.

## Decisions (user, 22 October 2026)

- **OP numbers.** An OP number is the registering centre's code, a dash and a 5 digit number from
  that centre's sequence, for example `HSR-00042`. Beyond 99999 it simply grows a digit.
  - The patient keeps it for life, whichever centre they visit later.
  - The Super Admin sets each centre's code when adding the centre (`docs/runbooks/centres.md`).
- **A mobile already on file.** When staff add a patient whose mobile is on file, the form lists
  the patients on that number with their OP numbers. Staff then either open one of them, or choose
  "Add as a new person". Nothing is refused.
- **Sex.** Female, male or other, optional until the health form. The health form asks about
  pregnancy only for female.

Also decided while building SCH-01:

- **The registering centre** is one of the active centres the staff member sees. It issues the
  OP number and never changes.
- **Out of scope here:** guardians (SCH-02), episodes (SCH-03), the full patient record (CLN-12)
  and the search inside the booking sheet (SCH-07).

## Guardians (SCH-02)

PRD J2.7: a patient under 18 needs a guardian, who signs the consent and attends.

- **The age is a setting.** `patients.adult_age_years` is 18 (rule 6). A patient's age comes from
  their date of birth on today's IST date (`ageOn`). With no date of birth the age is unknown, so
  nothing is flagged.
- **Several guardians per patient** (user decision, 22 October 2026), for example both parents.
  Each has a name, a relationship and a mobile. The mobile starts as the patient's own and can be
  changed.
- **Relationships** come from a fixed list (user decision): Mother, Father, Legal guardian,
  Other relative.
- **Flagged, not blocked** (user decision). A patient under 18 shows "Under 18" and, with no
  guardian yet, an amber "Guardian needed" tag. Booking still needs only a name and a mobile; the
  hard gate is the consent (INT-07), where the guardian signs.
- **Removed, never deleted.** Removing a guardian sets `removed_at` and drops them from the list.
  The row stays, because consent records point to the guardian who signed. A removed guardian
  cannot be edited.
- **When the section shows.** On the patient's page, when the patient is under 18, has no date of
  birth, or already has guardians. Those who edit patients add, edit and remove guardians; everyone
  else reads them.

## Screens

| Path | What it shows |
| --- | --- |
| `/app/patients` | "Patients" on home, for everyone with `patients.view_contact`. Search by mobile or name. Digits, with or without spaces, dashes or +91, search mobiles; anything else searches names, ignoring case. At least two characters; up to 20 results, by name. "Add patient" appears for those who edit patients. |
| `/app/patients/new` | Name and mobile. A centre to choose, or "Registered at …" when the person has one. Optional fields under "More details". When the mobile is on file: the patients on it, with Open and "Add as a new person". |
| `/app/patients/[id]` | The OP number and registering centre. The details: a form for those who edit, a list for others. "Also on this mobile" lists the others sharing the number. |

## How OP numbers are issued

- **A trigger sets the number.** `patient_op_number` runs before every insert on `patient`, and
  replaces whatever the caller gave.
- **Where the number comes from.** It calls `internal.next_centre_number(centre, 'op_number')`.
  That function upserts `centre_sequence` with `last_value + 1 RETURNING`.
- **Why numbers never repeat.** The upsert holds the sequence row's lock until the transaction
  ends, so two patients added at once get different numbers.
- **Why numbers have no gaps.** A rolled back insert gives its number back.
- **Server only.** `centre_sequence` has no policies; only that SECURITY DEFINER function changes
  it. It is not audited: the patient row it numbers is the event.
- **Fixed once issued.** `patient_number_fixed` refuses any change to the OP number or the
  registering centre. `centre_code_fixed` refuses any change to a centre's code.
- **Later numbers.** Appointment IDs and bill numbers can add kinds to `centre_sequence_kind`.

## Under the hood

| Part | Where |
| --- | --- |
| Schemas: `patientDetailsSchema`, `newPatientSchema`, `patientUpdateSchema`, `patientSearch` | `packages/schemas/src/patients.ts` |
| Tables `patient` and `centre_sequence`, and `centre.code` | `packages/db/src/schema/patients.ts`, `supabase/migrations/20261022140903_patients.sql` |
| Triggers, sequence function, row level security, audit | `supabase/migrations/20261022140933_patient_rules.sql` |
| Database functions: `insertPatient`, `updatePatient`, `patientRecord`, `patientsOnPhone`, `searchPatients` | `packages/db/src/patients.ts` |
| Services, each a `staffService` on `patients.edit_contact`: `addPatient` (target: the registering centre), `editPatient`, and for guardians `addGuardian`, `editGuardian`, `removeGuardianService` | `apps/web/modules/patients/services.ts` |
| Table `guardian` with its rules and the `patients.adult_age_years` setting | `supabase/migrations/20261022160646_guardians.sql`, `20261022160647_guardian_rules.sql` |
| Row level security: every signed in staff member reads; the three roles insert at a centre they see and update; nobody deletes; support read only | `docs/runbooks/row-level-security.md` |

`patient_link.patient_id` now references `patient`. The key is `NOT VALID`, so links made before
SCH-01 stay as they were, and every new link must name a real patient.

## Test data

Tests make patients with generated details only (rule 12): "Test Patient" and a short id, on a
`+91 99` mobile with random digits. They are never deleted. The helpers are:

- `packages/db/src/integration/fake-patients.ts`;
- `apps/web/e2e/patients.ts`.

## Checking it

| Test | What it covers |
| --- | --- |
| `packages/schemas/src/patients.test.ts` | Name and mobile only, optional details, bad input, the date of birth limits, search by mobile or name, centre codes |
| `apps/web/modules/patients/services.test.ts` | The matches unless confirmed, the registering centre must be the person's, roles, support read only, edits never touch the OP number |
| `packages/db/src/integration/patients.integration.test.ts` | Two people on one mobile; consecutive numbers per centre; no gaps after a rollback; no repeat when two are added at once; an OP number a caller gives is ignored; the number and centre are fixed; reads by every role; searches; inserts and updates by role; audit; no delete |
| `packages/db/src/integration/centres.integration.test.ts` | A code cannot change, repeat, or break the format |
| Guardian tests | Schemas: the relationship list, age on a birthday, 29 February. Services: a missing patient, a removed guardian, roles. Database: several per patient, removal kept and hidden, reads by every role, writes by the three roles, audit, the setting. End to end: the front desk adds a child aged 10 and sees "Guardian needed", adds the mother and father, edits one and removes one; a physiotherapist reads guardians with no Add, Edit or Remove. |
| `apps/web/e2e/patients.spec.ts` | 360 px and desktop. **Front Desk:** adds a patient, then a second person on the same mobile through "Add as a new person"; finds both by mobile and one by name; edits a detail while the OP number stays; no browser request to Supabase. **Physiotherapist:** finds and reads a Koramangala patient from HSR Layout, with no Add or Edit. |
