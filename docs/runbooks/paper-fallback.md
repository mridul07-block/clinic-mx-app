# Paper fallback

OPS-05: "Paper fallback: printed health form and consent at each centre". Sources:
- PRD resilience: "a paper fallback for launch week".
- TAD section 13: "A printed paper fallback (health form, consent) is kept at each centre for launch week and outages".
- TAD risks: "Staff fall back to paper".

Every choice below is a recommended default chosen under the user's standing approval, 29 October 2026 (DECISION OPS-05), for the client to confirm.

## What is printed

**"Health form and consent"** is an A4 PDF on the centre's letterhead (`docs/runbooks/documents.md`). It is blank and about no patient.

**Patient:** lines for the full name, mobile number and date, and the OP number, which the clinic fills in.

**Part A consent:**
- Both statements word for word (`consentStatements`, version 1), each with "I agree" and "I do not agree" boxes.
- "A parent or guardian signs for a patient under 18." The age comes from `patients.adult_age_years`.
- A signature line and the name of the person signing.
- The guardian's relationship, from the same list the desk uses.

**The health form:** every screen and question of the current version (`currentHealthFormVersion`, hf-3), in order, in the live form's own words (`paperForm` in `packages/schemas/src/paper-forms.ts`).
- **Yes or no:** two boxes.
- **Numbers:** a line with the unit.
- **Dates:** a line marked "Day / month / year".
- **Free text:** two ruled lines.
- **Choices:** boxes, with "Tick one." or "Tick any that apply." unless the question already says so.
- **Pain scales:** boxes 0 to 10 with the scale's own end labels.
- **The body chart:** its zones as boxes.

**Conditional questions:** the phone shows some questions only after an earlier answer. Paper prints them anyway, with a note made from that answer's words, such as "Answer only if Body region is Back." An option shown only after an answer gets "(Only if Gender is Female)".

**Footer:** "Health form hf-3 · Part A consent version 1" and when it was printed.

**What is not printed:**
- **Part B:** it waits for its texts (BIL-03; decisions 9 and 21).
- **Report photos:** the desk adds them at check-in.

**Wording still to approve:** the form's wording awaits the client's approval with the live form (INT-05). The paper-only words also go to the client:
- the opening line;
- the Patient lines;
- the tick instructions;
- the "Answer only if" notes.

Also for the client (INT-05):
- **The body chart:** paper prints its zones to tick, not a chart, under the live label "Pain site (mark it on the body chart)".
- **"None of these":** paper does not say it is ticked alone.
- **Required questions:** paper does not mark which questions the phone requires. "Fill in with the patient" asks for them when the answers are entered.

## Who prints it, and where

**Who:** those who check patients in at the centre (`check_in.manage`): the Super Admin, its Centre Managers and its front desk. Anyone else gets "not found".

**Where:**
- "Paper health form and consent (PDF)" under the centre's name on Today;
- the centre's page beside the letterhead preview;
- `/app/centres/<id>/paper-forms`.

**How it is served:** rendered on each request, `private, no-store`. It is never stored and never logged, as it holds no patient data. The PDF fonts ship with the route (`next.config.ts`).

## Keeping and using it

- **Stock:** each centre keeps a printed stack at the desk for launch week and any outage. Reprint when the form version in the footer changes; old copies are thrown away.
- **Filling it in:** when the online form cannot be used, the patient fills in the paper copy at the desk.
- **Entering it afterwards:** once Clinic Mx is back, the desk enters the answers with the patient through "Fill in with the patient" in the check-in drawer (`docs/runbooks/health-form.md`, assisted mode). That records Part A consent electronically before the consultation, as the consent gate requires.
- **The signed paper:** it can be added as a report photo at check-in. Nothing is typed in from paper without the patient.

## Tests

| File | Covers |
| --- | --- |
| `packages/schemas/src/paper-forms.test.ts` | every field once, in order, in the live words; Part A word for word and its version; the "Answer only if" notes from earlier answers' words; each kind of answer; a whole screen shown only after an answer |
| `apps/web/modules/documents/paper.test.tsx` | an A4 PDF of several pages on Plex for the desk at the centre, the Super Admin and a Centre Manager; nothing for the desk at another centre, a physio, Finance or a centre that is not there. Without the permission check it fails |
| `apps/web/e2e/paper-forms.spec.ts` | 360 px and desktop: the link on Today opens the PDF (`private, no-store`); a physio and the desk at another centre get not found; signed out goes to sign in |
