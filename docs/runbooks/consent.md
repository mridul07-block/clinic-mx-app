# Consent

Part A comes with the health form (INT-06, `docs/runbooks/health-form.md`). This page is Part B, the pre-treatment consent.

## Part B

BIL-03: "Part B consent pages". Sources:
- PRD J4.4: "Part B consent on the patient's phone via QR (tablet as backup): general terms always; package terms only with a package; modality statements only for planned modalities."
- PRD J4.5: "Declining a modality removes only that modality; declining a general term blocks treatment; declining a package term blocks the package only."
- Blueprint Module 3, Part B: the statements, word for word; "Each statement is recorded with a tick, timestamp, form version and the patient's e-signature."

Every choice below is a recommended default chosen under the user's standing approval, 30 October 2026 (DECISION BIL-03), for the client to confirm.

## The statements

`partBStatements` in `packages/schemas/src/part-b-consent.ts`, pinned by a test: new wording is a new version, never an edit.

| Group | Statements | Asked |
| --- | --- | --- |
| General terms | The plan statement (the diagnosis and the planned modalities filled in from the record); the right to decline | Always |
| Package terms | Valid three months from payment; one reschedule per 10 sessions, none on the Zero Gravity Treadmill; the refund policy | Only when the patient's latest choice is a package |
| Modalities | Electrotherapy, Radial Shockwave, Focused Shockwave, PEMF, Spinal DSO traction, Laser (the Blueprint's words); Dry needling and the Zero Gravity Treadmill | One card per modality in the signed plan of care |

- **Dry needling and the Zero Gravity Treadmill (DECISION #21):** the clinic has not sent their wording. Their cards say the wording is awaited and that the physiotherapist explains the treatment before it is used; they are version 0 and marked "Wording awaited from the clinic". Replace them with version 1 when the wording arrives.
- **The plan statement** fills `[auto-filled from the consultation record]` with the signed diagnosis's name and `[auto-listed from the plan of care]` with the modalities. The words the patient read are kept on their record (`consent_record.shown_text`).
- **Package terms** quote "three months" and "once for every 10 booked sessions" as the Blueprint words them; if `packages.validity_months` or the reschedule allowance changes, the statement needs a new version too.

## Asking

On **Plan and payment**, **Part B consent** shows where it stands, each planned treatment agreed, declined or not asked yet, and while something is left to ask:
- **Show Part B consent QR:** the episode's consent link (the `consent` purpose, tied to the episode, single use, `links.consent_hours`). The patient scans it with their phone camera.
- **Open Part B on tablet:** the same link on a kiosk tablet at the centre, as backup.

The desk sees no diagnosis: the plan statement's words are filled in for the patient only.

## Signing

The patient's page asks the statements not yet agreed, in order: general terms, package terms, treatments. Each needs **I agree** or **I do not agree**.
- **Who signs:** the patient, or for a patient under `patients.adult_age_years` a guardian on file (INT-07), as for Part A.
- **The signature:** when anything is agreed, drawn on the pad (a PNG in the private `signatures` bucket) or a typed full name; declining needs none, and all declined is recorded unsigned.
- **Recorded:** one `consent_record` row per statement (stage B, the episode, the statement's key and version, the modality for a treatment card, agreed or declined, the signature and signer), then the link is used. Records are never changed; a change of mind is a new record and the latest counts.
- **Afterwards:** "Thank you. Your consent is with the clinic."; with anything declined, "the front desk will speak to you about it".

## What a decline does (PRD J4.5)

- **A general term:** no treatment: the desk sees **Declined**, "a general term was declined. No treatment." A new link asks the declined statements again.
- **A package term:** no package: record another choice, or ask again.
- **A treatment:** only that treatment is left out ("declined: leave it out"); the rest goes ahead.

## In the database

- `internal.part_b_for_link()` (the patient's link) and `internal.part_b_for_episode(episode)` (staff at the episode's centre) read the newest plan of care of a signed consultation, its modalities, whether the latest choice is a package, the latest Part B decision on each statement and, for the patient only, the diagnosis's name.
- The patient adds Part B rows only through their open consent link, for its episode, never for a visit (`consent_record_patient_add_part_b`); the desk issues and reads consent links at the episode's centre (`patient_link_consent_issue`, `_read`); the patient marks theirs used.

## Tests

- `packages/schemas/src/part-b-consent.test.ts`: the pinned wording, which statements are asked, the plan statement's fills, signing what is agreed, the decline rules.
- `packages/db/src/integration/part-b-consent.integration.test.ts`: the desk at another centre cannot issue; the patient reads and decides through the open link only, for its episode only; staff read without the diagnosis; a package choice is seen.
- `apps/web/e2e/part-b-consent.spec.ts`: the desk's QR, the patient's phone at 360 px and desktop, a treatment declined, all declined.
