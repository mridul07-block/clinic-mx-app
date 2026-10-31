# Discovery visits and prototype tests (OPS-01)

For the Velyx Labs team visiting the clinic. OPS-01's done when: "All three centres visited;
prototypes tested with a receptionist, a consultant and a treating physio" (PRD phase 0).

The product is built, so the "prototype" is the staging site itself. These are task tests on real
screens, not clickable mock-ups. They find what the staff cannot do or misread before the rehearsal
week (OPS-03) and the training sessions (`docs/guides/session-plan.md`). Prepared on 31 October
2026, the visits wait for the clinic's dates.

## Before the visits

- **Dates:** agree one half day per centre with each Centre Manager, at a quiet hour (not Monday
  morning), and ask for one receptionist, one consultant and one treating physio for 30 minutes
  each. Testing at one centre per role is enough. Visit all three to observe.
- **Logins:** a staging login per tester, made by the Super Admin (`docs/runbooks/staff.md`), with
  the tester's role and centre.
- **Practice data:** staging holds generated practice data only. Each test uses a practice patient
  named "Test Patient" with a made-up mobile number, set up beforehand: one booked and checked in
  for the consultant, one in a treatment plan for the physio. Never type a real patient's details.
- **Kit:**
  - each tester's own phone (the screens are built for phones first);
  - the centre's tablet if it has one;
  - this page printed;
  - a timer.
- **Consent to observe:** ask each tester if you may take notes and time the tasks. Record no
  names in the notes, only the role and centre ("Receptionist, HSR").

## At each centre: what to observe (about 60 minutes)

Watch the desk and the treatment floor at work before testing anything. Note:

- **The arrival:** how a patient arrives, how they are found and checked in, and where the queue
  forms.
- **Devices:** what is on the desk (computer, tablet, phones) and whether there is Wi-Fi and
  mobile signal at the desk, in each treatment room and in the gym.
- **Paperwork:** how the health form and consent are done today, on paper or otherwise, and how
  long they take.
- **Rescheduling:** how a reschedule or a cancellation arrives (phone, WhatsApp, in person).
- **Clinicians' notes:** where the clinicians write, and whether they write during or after the
  session.
- **Payments:** card, UPI or cash, and who takes them.
- **Anything the software does not cover** that happens more than once a day.

## The task tests (30 minutes per role)

**How to run each one:**

- Give the task in the words below, then stay quiet. Ask the tester to think aloud. Help only when
  they are stuck for 2 minutes, and note that you helped.
- Do not show the quick guide first: these tests find what the screens alone don't make clear.
- For each task, record:
  - **done:** yes, with help, or no;
  - **time;**
  - **what they misread or looked for and could not find.**

**Receptionist** (`docs/guides/front-desk.md` has the expected path):

1. "Test Patient has just walked in for a consultation booked today. Check them in."
2. "They have no smartphone. Get their health form filled in."
3. "A new caller wants a consultation tomorrow afternoon. Book them."
4. "Test Patient wants to move their next session to Friday. Do it."
5. "The consultation is over and the patient chose a package. Take the payment."

**Consultant** (`docs/guides/consultant.md`):

1. "Test Patient is checked in for a consultation. Start it and work through the history."
2. "Confirm the screening and record the knee findings you would normally record."
3. "Choose the diagnosis and the category you would use." (This also checks the suggested category,
   SET-12.)
4. "Write a plan of care with two modalities, choose the treating physio, and sign."
5. "Show the patient what their condition means."

**Treating physio** (`docs/guides/physiotherapist.md`):

1. "Test Patient is here for session 2. Start it."
2. "Write today's note: the same treatment as last time, pain 4 out of 10."
3. "Something went wrong today: the patient felt faint. Record it."
4. "Close the session and book the next one."
5. "Find how the patient's pain has changed since the first session."

**After the tasks, ask each tester:**

- What was hardest?
- What would slow you down on a busy day?
- What do you do today that you could not find here?

## Afterwards

Within two days, write up each centre's notes in this form:

| Role, centre | Task | Done (yes, with help, no) | Time | What went wrong | Fix |
| --- | --- | --- | --- | --- | --- |

Then:

- **Fixes:** each one becomes a ticket or joins one. A task anyone could not do is fixed before the
  rehearsal week.
- **Guides and training:** quick guide wording that would have helped goes into
  `docs/guides/`, and the training session plan is adjusted.
- **Decisions:** answers to open decisions heard on the visit (PRD section 10) go to the DECISION
  register in `docs/PROGRESS.md` with the date and who said it.
- **Closing OPS-01:** mark it done in `docs/PROGRESS.md` once all three centres are visited and
  all three roles tested.
