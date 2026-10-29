# Role based training: session plan

For the clinic's training lead and the Centre Managers. Ticket OPS-04.

## The shape

- **One session per role, about 60 minutes:** Front Desk, Physiotherapist, Centre Manager,
  Finance, Super Admin.
- **On the staging site, never the live one.** Staging holds practice data only. Every patient
  used in training is a practice patient named "Test Patient" with a made-up mobile number. Never
  type a real patient's name, number or health details.
- **Each person follows their own quick guide** in `docs/guides/` (`front-desk.md`,
  `physiotherapist.md`, `consultant.md`, `centre-manager.md`, `finance.md`, `super-admin.md`),
  printed on A4 or open on their phone, plus `signing-in-and-security.md`, which everyone reads.
- **Every trainee uses their own phone** for at least part of the session, because the screens
  are built for phones first.
- **It runs alongside the rehearsal week** (OPS-03: the full journey run on staging in all three
  centres with practice patients). Train each role in the first days of that week, so the
  rehearsal journeys that follow are the trainees' own practice. Keep a short catch-up slot at the
  end of the week for anyone who missed a session or joins late.

## Every session, the same 60 minutes

| Minutes | What |
| --- | --- |
| 0 to 10 | Sign in on staging, set up two step verification where the role needs it, find the landing screen |
| 10 to 20 | Walk through the role's guide: tabs, tags, what is not live yet |
| 20 to 50 | Hands-on exercises (below), each trainee on their own login |
| 50 to 60 | Questions, who to ask, and notes on any guide wording that confused anyone |

The trainer demonstrates each task once, then the trainees do it themselves.

## Hands-on exercises

**Front Desk** (held at each centre's desk, with the tablet):

1. Book a new practice patient from the Calendar, then a walk in from Today.
2. Check the patient in, with the identity tick.
3. Show the health form QR and fill it in on a phone; then send it to the desk tablet; then fill
   it in with the patient.
4. Add a report photo (a photo of a blank page).
5. Open the plan and payment sheet, record a choice, mark the bill paid, undo the payment, and
   book the plan sessions.
6. Mark a no show, take and close the call task, then undo a no show.
7. Print the paper health form and consent.

**Physiotherapist** (every physio, consultants included):

1. Start a visit for a practice patient the trainer has checked in.
2. Write the session note, watch it save, and close the session.
3. Check the patient's record and add an addendum to a signed note.
4. Handle a practice red flag alert and work through your tasks.
5. Look at your outcomes.

**Consultants** stay 15 minutes longer and follow the consultant's guide: run a practice
consultation, write the plan of care and sign it, then review a reassessment and practise a
discharge on a practice patient.

**Centre Manager** (Centre Managers also sit in on the Front Desk session at their centre, as
they can check patients in):

1. Do the daily checks on the Dashboard tabs.
2. Open a practice red flag alert and close a task.
3. Decide a practice leave request and set a physio's hours.
4. Allow a practice patient to book themselves again.
5. Check the paper fallback stock at the desk.

**Finance:**

1. Check today's collections, including the payments made in the Front Desk session.
2. Follow up the practice patients' unpaid money.
3. Give an Other discount on a practice bill.
4. Check packages and read revenue.
5. Record a refund on a practice bill, and download a CSV.

**Super Admin:**

1. Read the Overview across the centres.
2. Add a practice staff login, change its centres, reset its two step verification and
   deactivate it.
3. Turn on Velyx support access for one hour with a reason, end it early, and read what support
   opened.
4. Walk through centres, prices and packages, settings, knowledge base versions, patient content
   and opening entries. On staging, agree any change with Velyx first, so the rehearsal is not
   disturbed.

## What to have ready

- **A staging login for every trainee,** in their own role, ticks and centres. The Super Admin
  invites them; while staging cannot send email, each invite is a one-time link handed over in
  person. Sort this out the week before.
- **An authenticator app** on the phone of everyone except the Front Desk (Google Authenticator or
  Microsoft Authenticator).
- **A practice centre** on staging that works end to end: physio hours, appointment types,
  consultant fees, session prices and at least one package type, and its letterhead for the paper
  form.
- **A tablet for each desk,** charged and on the centre's Wi-Fi, to set up as a kiosk in the Front
  Desk session.
- **Practice appointments made in advance:** some earlier the same day, so a no show can be
  marked, and some checked in, for the physio session.
- **Printed guides** for each role, and a screen the trainer can share.

## Not live yet: say it in every session

- WhatsApp messages are not sent; the desk shows the patient a QR code instead.
- The AI preparation sheet and "Recheck with findings" stay off until the AI key and its blind
  test are done.
- Part B consent waits for the clinic's consent texts.
- Exercise videos wait for the clinic's video library.
- Questionnaires wait for the clinic's instruments, licences and sign-off.
- Patient content appears only once a consultant approves it.
- Diagnosis categories wait for the clinic's mapping.

## What the clinic supplies

| Item | Detail | By when |
| --- | --- | --- |
| Dates | The rehearsal week, and a slot for each session at each centre | Two weeks before |
| Staff at each centre | Name, work email, role, centres, and the Treats patients and Consultant ticks | Two weeks before |
| Venues | A room at each centre with Wi-Fi and a screen, and the desk itself for the Front Desk session | One week before |
| Devices | A tablet per desk; staff bring their own phones | One week before |
| Guide review | One person per role reads their guide against the screens and marks any wording to change | Before the first session |
| Training lead | One named person who runs the sessions with Velyx and keeps the attendance list | Two weeks before |

## After the sessions

- Fold the trainees' notes on wording into the guides before launch.
- Anyone who could not finish the exercises repeats them during the rehearsal week.
- Each Centre Manager confirms that every person at their centre has signed in to staging once.
