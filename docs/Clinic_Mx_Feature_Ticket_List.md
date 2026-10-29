# Clinic Mx: Feature Ticket List

20 October 2026 · Velyx Labs

## How to read this list

Clinic Mx launch scope is 160 tickets in 15 epics; each ticket traces to the PRD, TAD and Frontend Specification.

- **ID:** epic prefix and number (for example SCH-04).
- **Done when:** the acceptance check a reviewer runs on a 360 px phone and on desktop.
- **Phase:** 0 Discovery and design · 1 Foundation and booking · 2 Clinical core and billing · 3 Outcomes and progression · 4 Patient experience · 5 AI and launch.
- **Priority:** P0 needed for launch · P1 launch, can follow P0 in the same phase · P2 after launch.
- **Size:** S up to 1 day · M 2 to 3 days · L 4 to 5 days.
- Every ticket includes tests, audit events where data changes, and phone layout.
- Tickets marked "decision" depend on an open decision in the PRD.

| Epic | Prefix | Tickets | Main phase |
| --- | --- | --- | --- |
| Foundation and platform | FND | 14 | 1 |
| Identity, roles and security | IAM | 11 | 1 |
| Settings and knowledge base | SET | 12 | 1 |
| Patients, episodes and scheduling | SCH | 14 | 1 |
| WhatsApp and booking Flows | WA | 13 | 1 |
| Check in and health form | INT | 12 | 1 |
| Consultation and clinical record | CLN | 12 | 2 |
| Plan, consent, billing and packages | BIL | 12 | 2 |
| Treatment sessions | SES | 8 | 2 |
| Outcomes, progression and discharge | OUT | 11 | 3 |
| Alerts, tasks and documents | ALT | 8 | 2 to 3 |
| Patient pages, feedback and follow ups | PAT | 10 | 4 |
| Dashboards and reports | DSH | 6 | 3 |
| AI | AI | 9 | 5 |
| Launch and operations | OPS | 8 | 0 and 5 |

## Foundation, identity and settings

### FND: Foundation and platform

| ID | Ticket | Done when | Phase | Pri | Size |
| --- | --- | --- | --- | --- | --- |
| FND-01 | Repository, Next.js app, TypeScript, lint and CI | Pull requests run lint, type check and tests; preview deploy per PR | 1 | P0 | S |
| FND-02 | Vercel project, functions pinned to bom1, three environments | Functions run in Mumbai; secrets set per environment | 1 | P0 | S |
| FND-03 | Supabase staging and production in Mumbai, Small compute, spend cap | Both projects live; spend cap on | 1 | P0 | S |
| FND-04 | Drizzle schema, migrations pipeline, seed data | Migrations apply on merge; seed creates 3 centres and test staff | 1 | P0 | M |
| FND-05 | Cloudflare DNS and firewall on the clinic domain | All traffic on our domain; no browser request to supabase.co in a network log | 1 | P0 | M |
| FND-06 | Design tokens, Tailwind v4 theme, base and motion CSS, token CI check | Gold #FCB714, Checked in in blue; CI fails on raw colours or gold text | 1 | P0 | M |
| FND-07 | PWA manifest, service worker, app shell cache | Installable on Android and iOS; shell loads offline | 1 | P0 | M |
| FND-08 | Autosave and offline drafts framework | Edits survive reload and offline; sync on reconnect with a conflict notice | 1 | P0 | L |
| FND-09 | Realtime relay Worker and client hook with polling fallback | Updates under 2 s; 15 s polling fallback; "Updated n s ago" shown | 1 | P0 | M |
| FND-10 | Job queue with pg_cron tick, retries and idempotency | Jobs claimed with skip locked; 5 retries then a Super Admin task | 1 | P0 | M |
| FND-11 | Audit event framework | Every write stores actor, before and after; clinical record views logged | 1 | P0 | M |
| FND-12 | Sentry with data scrubbing, uptime checks, spend alerts | Alerts reach the on call phone; no patient data in error logs | 1 | P0 | S |
| FND-13 | Nightly encrypted backup copy, weekly export, restore runbook | First restore test passes and is documented | 1 | P0 | M |
| FND-14 | Settings table and cached accessor | Every rule in PRD section 7 is read from settings | 1 | P0 | S |

### IAM: Identity, roles and security

| ID | Ticket | Done when | Phase | Pri | Size |
| --- | --- | --- | --- | --- | --- |
| IAM-01 | Staff email login and password reset through our server | Login works with no browser call to Supabase | 1 | P0 | M |
| IAM-02 | TOTP two step verification by role | Required for all roles except Front Desk | 1 | P0 | M |
| IAM-03 | Roles, ticks and centre assignment with JWT claims | Claims refresh when a user's role, ticks or centres change | 1 | P0 | M |
| IAM-04 | Permission map and server guard | Every service function checks role × action; tests cover each role | 1 | P0 | M |
| IAM-05 | Row level security for all tables and restricted views | Tests prove each role sees only allowed rows; managers see payment pending only | 1 | P0 | L |
| IAM-06 | Staff management screen | Invite, set role, ticks, centres, end date; deactivate never deletes | 1 | P0 | M |
| IAM-07 | Session rules | 15 minute idle logout on desktop; phone sessions persist; deactivation revokes at once | 1 | P0 | S |
| IAM-08 | Support access grants | Time limited grant by Super Admin; every action under it logged | 1 | P1 | S |
| IAM-09 | Patient token service | Signed, single purpose, expiring links; reissue from WhatsApp | 1 | P0 | M |
| IAM-10 | Tablet kiosk mode | Locked to patient pages; resets after submit or 2 minutes idle | 1 | P0 | S |
| IAM-11 | Rate limiting | Login, patient token and webhook endpoints limited | 1 | P0 | S |

### SET: Settings and knowledge base

| ID | Ticket | Done when | Phase | Pri | Size |
| --- | --- | --- | --- | --- | --- |
| SET-01 | Centres master | Address, map link, phone, chart colour per centre | 1 | P0 | S |
| SET-02 | Price master, package types, preset discounts | Finance and Super Admin edit; changes audited | 1 | P0 | M |
| SET-03 | Appointment types with configurable lengths | Length per type and per physio | 1 | P0 | S |
| SET-04 | Availability, rosters and leave | Managers set rosters; physios request own leave | 1 | P0 | M |
| SET-05 | Knowledge base import from the 9 workbooks | Stable condition IDs; normalised age, onset, sex, tags, red flag tier; duplicates merged; import report | 1 | P0 | L |
| SET-06 | Knowledge base versions, viewer and approval | Super Admin approves a version; records store the version used | 5 | P1 | M |
| SET-07 | Exercise library with videos | Exercises with dose defaults and video playable on phones | 2 | P1 | M |
| SET-08 | Questionnaire library | Items, scoring, meaningful change and versions for each instrument | 3 | P0 | L |
| SET-09 | Programme phases and criteria per region | Entry and exit criteria imported from the workbooks | 3 | P0 | L |
| SET-10 | Red flag rules per region | Rules and tiers configurable; tests for each emergency rule | 1 | P0 | M |
| SET-11 | WhatsApp template registry | Keys, variables and versions viewable by Super Admin | 1 | P1 | S |
| SET-12 | Physiotherapy diagnosis category codes | Client's category list mapped to knowledge base conditions | 2 | P1 | M |

## Scheduling and WhatsApp

### SCH: Patients, episodes and scheduling

| ID | Ticket | Done when | Phase | Pri | Size |
| --- | --- | --- | --- | --- | --- |
| SCH-01 | Patient record keyed by person | Several patients per phone number; OP number from a per centre sequence | 1 | P0 | M |
| SCH-02 | Guardian records | Guardian name, relationship, phone linked to patients under 18 | 1 | P0 | S |
| SCH-03 | Episode model and status transitions | All statuses from the PRD with guarded transitions and audit | 1 | P0 | M |
| SCH-04 | Slot engine | Free slot query under 2 s; 5 minute holds; recheck inside a transaction; overbooking impossible under concurrent tests | 1 | P0 | L |
| SCH-05 | Desktop calendar day view | A column per physio, fee in the header, free slots clickable, live updates, drawer details | 1 | P0 | L |
| SCH-06 | Phone agenda view | One physio or list at a time; actions in bottom sheets | 1 | P0 | M |
| SCH-07 | Front desk new booking | Search by mobile or name; new patient needs name and mobile only; channel recorded | 1 | P0 | M |
| SCH-08 | Front desk reschedule and cancel | Reason recorded as by patient or by clinic | 1 | P0 | S |
| SCH-09 | Reschedule and no show counters | Self booking blocked after 2 of either; front desk can still book | 1 | P0 | S |
| SCH-10 | Package reschedule allowance | 1 per 10 booked sessions; Zero Gravity Treadmill sessions never reschedulable | 2 | P0 | S |
| SCH-11 | Book plan sessions | Recurring pattern for the whole plan; clashes offered alternatives; one WhatsApp list | 2 | P0 | M |
| SCH-12 | Physio books the next session | From the session screen, own patients | 2 | P1 | S |
| SCH-13 | Opening entries for patients in treatment | Name, mobile, physio, remaining sessions, package expiry entered before launch | 5 | P0 | S |
| SCH-14 | Returning patients and linked episodes | Previous episodes shown; recurrence opens a linked episode | 4 | P1 | S |

### WA: WhatsApp and booking Flows

| ID | Ticket | Done when | Phase | Pri | Size |
| --- | --- | --- | --- | --- | --- |
| WA-01 | Meta Business setup, test number, Cloud API client | Messages send with retries; message rows stored | 1 | P0 | M |
| WA-02 | Webhook endpoint | Signature verified; acknowledged within seconds; work queued; delivery status stored | 1 | P0 | M |
| WA-03 | Conversation router | Buttons, Flow completions, typed text and emergency phrases each reach the right handler | 1 | P0 | M |
| WA-04 | Booking Flow and encrypted data endpoint | Clinic, dates with free slots, live times, physio with fee, name, confirm; slot taken returns next free times | 1 | P0 | L |
| WA-05 | Reschedule Flow and Flow template from the reminder | Prefilled clinic and physio; reschedules left shown; Zero Gravity Treadmill blocked | 1 | P0 | L |
| WA-06 | English utility templates written and submitted | All templates in the TAD list approved on the test number | 1 | P0 | M |
| WA-07 | Booking confirmations | Same confirmation for WhatsApp and front desk bookings | 1 | P0 | S |
| WA-08 | Reminders | Day before with Confirm and Reschedule; 8 AM to every patient; Confirm sets Confirmed | 1 | P0 | S |
| WA-09 | Talk to our team and Flow fallback | Replies with front desk phone and email | 1 | P0 | S |
| WA-10 | Emergency phrase reply | Emergency advice plus clinic number; urgent front desk task | 1 | P0 | S |
| WA-11 | Assistant for typed messages | Single message replies; FAQs; never diagnoses | 1 | P1 | M |
| WA-12 | Production number and approvals (decision 1) | Templates and Flows approved on the real number before launch | 5 | P0 | M |
| WA-13 | Delivery failure surfacing | "Not delivered" shown on the front desk screen | 1 | P1 | S |

## Check in and consultation

### INT: Check in and health form

| ID | Ticket | Done when | Phase | Pri | Size |
| --- | --- | --- | --- | --- | --- |
| INT-01 | Front desk Today board | Count chips filter; status tags; waiting timers; live; emergency banner slot | 1 | P0 | L |
| INT-02 | Check in drawer | Identity check, form status, Show QR, Open on tablet, Add reports | 1 | P0 | M |
| INT-03 | Appointment linked QR | QR opens the form for that appointment only; no login, no OTP | 1 | P0 | S |
| INT-04 | Health form engine | Versioned schema, conditional screens, resume after leaving | 1 | P0 | L |
| INT-05 | Health form screens | All screens in PRD J2.3 incl. body chart and pain sliders; about 5 minutes on a phone | 1 | P0 | L |
| INT-06 | Part A consent | Two statements with version, time and signature; decline blocks with "Please speak to reception" | 1 | P0 | M |
| INT-07 | Guardian section | Under 18 opens it; guardian signs | 1 | P0 | S |
| INT-08 | Returning patient prefill | Details prefilled with "Has anything changed?" | 4 | P1 | S |
| INT-09 | Assisted mode | Record shows "entered with help by" staff name | 1 | P1 | S |
| INT-10 | On submit pipeline | Episode created, red flag rules run, precautions stored, AI job queued, physio notified | 1 | P0 | M |
| INT-11 | Running late and no show timing | Amber at 15 minutes; no show allowed from 25 minutes; both settings | 1 | P0 | S |
| INT-12 | Walk in | Book and check in in one action | 1 | P1 | S |

### CLN: Consultation and clinical record

| ID | Ticket | Done when | Phase | Pri | Size |
| --- | --- | --- | --- | --- | --- |
| CLN-01 | Physio "My patients today" | Time ordered list with status, form status, alerts, "Preparation sheet ready" | 2 | P0 | M |
| CLN-02 | Consultation stepper | Six sections; autosave; one section per screen on phones with Next pinned | 2 | P0 | L |
| CLN-03 | Subjective with source labels | Patient reported fields switch to Clinician confirmed when edited | 2 | P0 | M |
| CLN-04 | Region specific screening gate | Each item confirmed; signing impossible until complete | 2 | P0 | M |
| CLN-05 | Objective inputs | Side by side measure with live LSI, special test row, 0 to 3 quality rating | 2 | P0 | L |
| CLN-06 | Assessment | Condition search from the knowledge base; movement diagnosis; irritability suggested; stage from duration; category coded | 2 | P0 | M |
| CLN-07 | Plan of care editor | Goals, interventions, modalities with precaution warnings, frequency, home programme, reviews, questionnaires, treating physio | 2 | P0 | L |
| CLN-08 | Explain to patient view | Clinician approved content for the chosen condition, readable by the patient | 4 | P1 | M |
| CLN-09 | Sign and lock | Requires the Treats patients tick; later changes only as addenda | 2 | P0 | M |
| CLN-10 | Unsigned notes flag | Unsigned notes listed to the Centre Manager at 9 PM | 2 | P1 | S |
| CLN-11 | Red flag found in consultation | Tier chosen; episode On hold; referral letter; WhatsApp safety advice | 2 | P0 | M |
| CLN-12 | Patient record view | Summary card, episodes, signed notes, documents, alerts | 2 | P0 | M |

## Billing and sessions

### BIL: Plan, consent, billing and packages

| ID | Ticket | Done when | Phase | Pri | Size |
| --- | --- | --- | --- | --- | --- |
| BIL-01 | Plan and payment sheet | Recommended plan read only; per session and package options calculated from the price master | 2 | P0 | M |
| BIL-02 | Patient choice and "think about it" follow up | Choice stored against the plan; nudge after 2 days plus a call task | 2 | P0 | S |
| BIL-03 | Part B consent pages | General terms always; package terms only with a package; one card per planned modality; signature; decline rules from PRD J4.5 | 2 | P0 | L |
| BIL-04 | Modality consent added later | Session cannot start until the new modality's consent is signed | 2 | P0 | S |
| BIL-05 | Bills at fixed prices | Consultation fee by physio level; fee timing setting; no price edits at the desk | 2 | P0 | M |
| BIL-06 | Counter payment recording | UPI QR, card or cash with optional reference; bill marked paid | 2 | P0 | S |
| BIL-07 | Discounts (decision 15) | Preset types at the desk; other discounts need Finance approval | 2 | P1 | S |
| BIL-08 | Packages | Activated on payment; 3 month expiry; usage on session close; expiry reminder at 14 days | 2 | P0 | M |
| BIL-09 | Invoices and receipts | Numbered PDF; receipt sent on WhatsApp | 2 | P0 | M |
| BIL-10 | YTP balances (decision 10) | Partial payments create a balance; flag above 3 unpaid sessions | 2 | P1 | S |
| BIL-11 | Refunds and credits (decisions 9, 12) | Finance only; reason and approver stored | 2 | P1 | M |
| BIL-12 | Consent and pricing gate | First session cannot start without Part B consent and pricing recorded | 2 | P0 | S |

### SES: Treatment sessions

| ID | Ticket | Done when | Phase | Pri | Size |
| --- | --- | --- | --- | --- | --- |
| SES-01 | Session check in | One tap; shows "Session n of N" and gate status | 2 | P0 | S |
| SES-02 | Treating physio summary card | Diagnosis, goals, plan, phase, precautions, last note; no AI sheet | 2 | P0 | S |
| SES-03 | Session note | Since last visit, mandatory new symptoms check, pain sliders, treatment prefilled, response, home programme, next session; median under 3 minutes on a phone | 2 | P0 | L |
| SES-04 | "Same as last time" | Copies the previous note for editing | 2 | P0 | S |
| SES-05 | Modality parameter fields | Fields per modality; precaution warning when relevant | 2 | P0 | M |
| SES-06 | Adverse events | Requires a description; alerts the consultant | 2 | P0 | S |
| SES-07 | Close session | Completed status; package session used; note signed | 2 | P0 | S |
| SES-08 | Cover between physios | Physios see colleagues' patients in their centres; notes signed by the writer | 2 | P0 | S |

## Outcomes, alerts and documents

### OUT: Outcomes, progression and discharge

| ID | Ticket | Done when | Phase | Pri | Size |
| --- | --- | --- | --- | --- | --- |
| OUT-01 | Baseline | Consultation measures within 7 days reused; missing markers requested at session 1 | 3 | P0 | M |
| OUT-02 | Patient filled questionnaires | Opened by QR on the patient's phone; one question per screen; auto scored; raw answers and version stored | 3 | P0 | L |
| OUT-03 | Progress tab | Pain line, questionnaire lines with meaningful change band, LSI bullet graphs, week strip | 3 | P0 | L |
| OUT-04 | Phase stepper and criteria (decision 4) | Locked phases show unmet criteria in words; treating physio progresses when met; consultant override with reason | 3 | P0 | L |
| OUT-05 | Session 4 reassessment (decision 7) | Treating physio records markers; consultant reviews and signs the decision | 3 | P0 | M |
| OUT-06 | 6 week review appointment | Booked automatically with the plan, with the consultant | 3 | P0 | S |
| OUT-07 | Final testing | Exactly the baseline markers listed with before and after | 3 | P0 | M |
| OUT-08 | Readiness panel and clearances | Met, Not met, Not assessed per criterion; clearance disabled while anything is Not assessed; three statuses; override with reason | 3 | P0 | L |
| OUT-09 | Patient clearance acknowledgement | Patient ticks and signs plan, warning signs and residual risk | 3 | P1 | S |
| OUT-10 | Discharge (decision 19) | Mandatory reason from the list; lost to follow up job never marks recovered | 3 | P0 | M |
| OUT-11 | Discharge report | PDF with baseline vs final, goals, criteria, overrides; sent on WhatsApp | 3 | P0 | M |

### ALT: Alerts, tasks and documents

| ID | Ticket | Done when | Phase | Pri | Size |
| --- | --- | --- | --- | --- | --- |
| ALT-01 | Red flag alerts and emergency banner | Lifecycle raised, reviewed, referred, closed; banner stays until a clinician acknowledges; front desk sees the non clinical banner | 1 | P0 | L |
| ALT-02 | Progress alerts | Worsening, no change, plateau, missed sessions, low adherence, milestone missed, reassessment overdue | 3 | P1 | M |
| ALT-03 | Tasks inbox | Tasks by urgency; closing requires a recorded decision | 2 | P0 | M |
| ALT-04 | No show workflow | Message, call task, counter; two in a row add a clinical review task | 2 | P0 | M |
| ALT-05 | PDF framework | Letterhead template, versions, storage, Indian number formats | 2 | P0 | M |
| ALT-06 | Consultation summary and bundled message | Summary PDF with "Open My plan" and "Rate your visit" in one WhatsApp message | 2 | P0 | M |
| ALT-07 | Referral letter | Generated from the consultation; printable and shareable | 2 | P0 | S |
| ALT-08 | Report photo uploads | Resized on the phone; private storage; visible to clinicians only | 1 | P0 | S |

## Patient experience and dashboards

### PAT: Patient pages, feedback and follow ups

| ID | Ticket | Done when | Phase | Pri | Size |
| --- | --- | --- | --- | --- | --- |
| PAT-01 | "My plan" page | Next session with Reschedule and Map; exercises with videos; gold package meter; pain line with a sentence | 4 | P0 | L |
| PAT-02 | Exercise ticks and adherence | Ticks feed the adherence line on the next session note | 4 | P1 | S |
| PAT-03 | Maintenance mode | After discharge: maintenance exercises, return plan, flare plan, "Book a check up" | 4 | P1 | S |
| PAT-04 | Post consultation feedback | Four questions from the bundled message; answers stored by centre and physio | 4 | P1 | S |
| PAT-05 | Day after first treatment check | Better, Same, Still sore; Still sore alerts the physio | 4 | P1 | S |
| PAT-06 | Session 3 check | Sent after session 3 closes | 4 | P1 | S |
| PAT-07 | Discharge feedback | Four questions plus a 0 to 10 recommendation score | 4 | P1 | S |
| PAT-08 | Service recovery | Score 0 to 6 or a "No" creates a task for the Centre Manager; complaints escalate within 24 hours | 4 | P1 | M |
| PAT-09 | Review requests | Sent to every discharged patient with their centre's link, never filtered by score | 4 | P1 | S |
| PAT-10 | Follow ups and recurrence | 2 weeks, 6 weeks, 3 months, 12 months; "Injured again" logs a recurrence and alerts the consultant | 4 | P1 | M |

### DSH: Dashboards and reports

| ID | Ticket | Done when | Phase | Pri | Size |
| --- | --- | --- | --- | --- | --- |
| DSH-01 | KPI query layer | Daily aggregates for every metric in PRD section 9, by centre | 3 | P0 | L |
| DSH-02 | Chart components | Recharts line, bar, donut; custom bullet graph, dumbbell, heatmap, week strip; each with a table view | 3 | P0 | L |
| DSH-03 | Centre Manager dashboards | Alerts, centres, outcomes, team and feedback screens per the Frontend Specification | 3 | P1 | L |
| DSH-04 | Finance dashboards and exports | Collections, unpaid, packages, revenue by month and centre; CSV export | 3 | P1 | L |
| DSH-05 | Super Admin overview | All centres at a glance; AI top 3 accuracy by month | 3 | P1 | M |
| DSH-06 | Physio own outcomes | My patients' outcomes and adherence | 3 | P2 | S |

## AI and launch

### AI

| ID | Ticket | Done when | Phase | Pri | Size |
| --- | --- | --- | --- | --- | --- |
| AI-01 | AI gateway | OpenRouter with zdr on every request, pinned provider, schema output, retry once, logging to ai_run, daily spend cap | 5 | P0 | M |
| AI-02 | Candidate filter and must rule out | 15 to 25 rows by region, age, sex, onset, duration; matching high risk rows always added | 5 | P0 | M |
| AI-03 | Rank, validate and preparation sheet UI (decision 3) | Unknown IDs dropped; knowledge base text shown word for word; Keep and Dismiss stored; ready within 15 s | 5 | P0 | L |
| AI-04 | Recheck with findings | Reranks with examination results only when tapped | 5 | P1 | S |
| AI-05 | Similar confirmed cases | 3 to 5 past episodes confirmed at review or discharge; no identifiers | 5 | P1 | M |
| AI-06 | Blind test harness | Runs 30 to 50 anonymised cases through candidate models; clinicians score blind; results compared | 5 | P0 | M |
| AI-07 | Patient content generation and approval | Content generated once per condition; clinician approves before patients see it | 5 | P1 | M |
| AI-08 | Monthly knowledge base report | Often dismissed suggestions, missed diagnoses, changes at review; sent to the Super Admin | 5 | P1 | M |
| AI-09 | AI on and off gate (decision 23) | AI sheet switched on only after the blind test passes and the legal check clears | 5 | P0 | S |

### OPS: Launch and operations

| ID | Ticket | Done when | Phase | Pri | Size |
| --- | --- | --- | --- | --- | --- |
| OPS-01 | Discovery visits and prototype tests | All three centres visited; prototypes tested with a receptionist, a consultant and a treating physio | 0 | P0 | M |
| OPS-02 | Knowledge base clean up with the client | Copied text fixed in 4 workbooks; duplicates merged; thoracic content added or marked missing | 0 | P0 | M |
| OPS-03 | Rehearsal week | Full journey run on staging in all three centres with practice patients | 5 | P0 | M |
| OPS-04 | Training and quick guides | Role based sessions; one page guide per role | 5 | P0 | M |
| OPS-05 | Paper fallback | Printed health form and consent at each centre | 5 | P0 | S |
| OPS-06 | Penetration test | Independent test done; high findings fixed before launch | 5 | P0 | M |
| OPS-07 | Privacy and legal readiness (decisions 20, 21, 24) | Privacy notice, data processing agreements, final consent texts in place | 5 | P0 | S |
| OPS-08 | Go live and close support | Runbook followed; all three centres live the same day; two weeks of daily fixes | 5 | P0 | M |

### UI and ADM: Found while building (added 29 October 2026, with the user's approval)

Specified in the PRD or the Frontend Specification but on no ticket above; found while writing the
quick guides (OPS-04).

| ID | Ticket | Done when | Phase | Pri | Size |
| --- | --- | --- | --- | --- | --- |
| UI-01 | Phone bottom tab bar per role (Frontend Specification section 4) | Each role's tabs on phones, current tab marked; More reaches every other screen | 4 | P1 | S |
| ADM-01 | Audit log viewer (PRD M16 and section 2) | The Super Admin reads every change, Centre Managers the clinical changes at their centres, Finance the money changes | 4 | P1 | M |
| ADM-02 | Settings screen (PRD M16, section 7) | The Super Admin reads and changes each business rule setting, validated and audited | 4 | P1 | M |
| UI-02 | Tablet and desktop navigation: icon rail, sidebar, search or jump to (Frontend Specification section 4, design system v2 section 7) | From 768 px each role's screens in a 64 px rail, from 1280 px a 240 px sidebar with the centre switcher, Ctrl K and the person's menu; the current screen marked | 4 | P1 | M |
| ADM-03 | Data requests register and patient data export (PRD M16, TAD DPDP) | The Super Admin records a patient's export or deletion request with its due date and exports their data; deletion waits for the clinic's retention decision | 4 | P2 | M |
| ADM-04 | Audit log download (PRD section 2: "Audit log and data export") | The audit log's readers download the events they see, by part, record type and days, as CSV, the download itself audited | 4 | P2 | S |
| UI-03 | Centre switcher on tablets (Frontend Specification section 4, page frame) | From 768 px the rail offers the centre switcher, as the sidebar does | 4 | P2 | S |
