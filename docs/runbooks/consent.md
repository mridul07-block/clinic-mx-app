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

- **Dry needling and the Zero Gravity Treadmill (DECISION #21):** the clinic has not sent their wording. They are version 0: never asked or agreed. The patient's page says "Not asked yet: Dry needling… It will not be used until you have read and agreed to it", the desk reads "consent wording awaited: do not use", and nothing else waits on them. When the wording arrives, add it as version 1 here and in `internal.part_b_statements()`; patients are then asked it.
- **Versions:** a decision counts only on its statement's current version, so new wording (a new version) is asked again. The database's list of statements and versions (`internal.part_b_statements()`) is kept the same as the app's by a test.
- **The plan statement** fills `[auto-filled from the consultation record]` with the name of the diagnosis in the newest signed consultation (provisional or not; "not recorded" without one) and `[auto-listed from the plan of care]` with the plan's interventions, then its modalities. The words the patient read are kept on their record (`consent_record.shown_text`); managers without the Treats patients tick do not see them in the audit log (they name the diagnosis).
- **Treatments** come in the knowledge base's order (`kb_modality.sort`).
- **Package terms** quote "three months" and "once for every 10 booked sessions" as the Blueprint words them; if `packages.validity_months` or the reschedule allowance changes, the statement needs a new version too.

## Asking

On **Plan and payment**, **Part B consent** shows where it stands, each planned treatment agreed, declined or not asked yet, and while something is left to ask:
- **Show Part B consent QR:** the episode's consent link (the `consent` purpose, tied to the episode, single use, `links.consent_hours`). The patient scans it with their phone camera.
- **Open Part B on tablet:** the same link on a kiosk tablet at the centre, as backup.

The desk sees no diagnosis on the sheet: the plan statement's words are filled in for the patient's page only (the desk should not open the patient's link itself). The section hides the QR once the episode is discharged or lost to follow up.

## Signing

The patient's page asks the statements not yet agreed, in order: general terms, package terms, treatments. Each needs **I agree** or **I do not agree**.
- **Who signs:** the patient, or for a patient under `patients.adult_age_years` a guardian on file (INT-07), as for Part A.
- **The signature:** when anything is agreed, drawn on the pad (a PNG in the private `signatures` bucket) or a typed full name; declining needs none, and all declined is recorded unsigned.
- **Recorded:** one `consent_record` row per statement (stage B, the episode, the statement's key and version, the modality for a treatment card, agreed or declined, the signature and signer), then the link is used. Records are never changed; a change of mind is a new record and the latest counts.
- **Exactly what was read:** the page posts a fingerprint of the cards it showed; if the plan or the record changed since, the save is refused and the page shows the new words.
- **Sent twice** (the phone and the tablet at once): the second sees the link's page, already done.
- **Afterwards:** "Thank you. Your consent is with the clinic."; with anything declined, "the front desk will speak to you about it".

## What a decline does (PRD J4.5)

- **Any decline:** the front desk at the episode's centre gets a high task, "Part B consent declined: speak to the patient" (one not closed per episode, however many declines arrive at once: `task_open_part_b_declined_key`), as the Blueprint says declining "alerts reception".
- **A general term:** no treatment: the desk sees **Declined**, "a general term was declined. No treatment." A new link asks the declined statements again.
- **A package term:** no package: record another choice, or ask again.
- **A treatment:** only that treatment is left out ("declined: leave it out"); the rest goes ahead. The session note does not give it (BIL-04 below).

## A treatment added later (BIL-04)

Blueprint Module 3: "If a modality is added to the plan later, the software requests that modality's consent before the session in which it is first used." Recommended defaults chosen under the user's standing approval, 30 October 2026 (DECISION BIL-04), for the client to confirm.

- **What counts:** Part B asks for every treatment the plan's newest signed version plans or one of the episode's session notes ticks. A treatment with no decision yet is "not asked yet" on **Plan and payment**, and the next session is held: "Consent for a newly planned treatment is needed before this session." (the gate's `missing_modality`, once the terms are decided; while a term is undecided too, the plain "Part B consent is needed.").
- **In the session note:** a treatment is given only with the patient's agreement on its card's current version. The note opens without the treatments declined or awaiting wording (the plan still lists them, unticked), and Close session is held while one is ticked: "The patient declined Laser in Part B consent: untick it.", "Dry needling is not used until the clinic's consent wording arrives: untick it." or "PEMF needs the patient's Part B consent first: ask the front desk for the consent QR, or untick it." The database refuses to sign such a note too (`internal.session_part_b`). An episode entered with an opening entry (consented on paper) is not checked.
- **Asking:** the same **Show Part B consent QR** or **Open Part B on tablet**. What was agreed before is not asked again, so the patient sees the new treatment's card alone, agrees or declines, and signs as before.
- **Declined:** that treatment is left out and the rest goes ahead, with the desk's task (as above).
- **Removed from the plan:** nothing is asked; its earlier decision stays on the record.

## In the database

- `internal.part_b_for_link()` (the patient's link) and `internal.part_b_for_episode(episode)` (staff at the episode's centre) read the newest plan of care of a signed consultation, its modalities, whether the latest choice is a package, the latest Part B decision on each statement and, for the patient only, the diagnosis's name.
- The patient adds Part B rows only through their open consent link, for its episode, never for a visit, naming a real statement on its current version (never one awaiting wording) with its own modality, the words shown on the plan statement only, and their own guardian on file (`consent_record_patient_add_part_b`); the desk issues and reads consent links at the episode's centre (`patient_link_consent_issue`, `_read`); the patient marks theirs used once something is recorded through it.
- **Paper:** there is no paper Part B. During an outage, treatment waits until the patient signs on the phone or the tablet (DECISION BIL-03).

## Tests

- `packages/schemas/src/part-b-consent.test.ts`: the pinned wording, which statements are asked, the plan statement's fills, signing what is agreed, the decline rules, a treatment added later asked alone, each treatment's own consent; `packages/schemas/src/sessions.test.ts`: Close session held for a treatment not agreed; `apps/web/modules/sessions/services.test.ts`: the note opens without a declined treatment.
- `packages/db/src/integration/part-b-consent.integration.test.ts`: the desk at another centre cannot issue; the patient reads and decides through the open link only, for its episode only; forged statements, versions, modalities, words and guardians are refused; a link is used only once something is recorded; a decline gives the desk a task; staff read without the diagnosis; a package choice is seen; the statement lists match; a treatment in a later plan version holds the gate until its card is agreed; a treatment a session note ticks is asked, and the note is signed only once it is agreed; two declines at once give one task.
- `apps/web/e2e/part-b-consent.spec.ts`: the desk's QR, the patient's phone at 360 px and desktop, a treatment declined, all declined, a treatment added later asked alone; `apps/web/e2e/session-check-in.spec.ts`: Dry needling planned but awaiting its wording is not prefilled, and holds Close session when ticked.
