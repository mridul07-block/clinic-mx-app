# Privacy notice: draft for the clinic's lawyer (OPS-07)

**Status:** a draft by Velyx Labs, written from what the software does on 31 October 2026. It is
not legal advice. The clinic's lawyer checks it against the Digital Personal Data Protection Act,
2023 (DPDP) and its Rules, then the clinic publishes the final text. Square brackets mark what the
clinic fills in. Notes for the lawyer follow the notice.

---

## Movementology Clinics: how we use your personal data

Movementology Clinics ([legal entity name, address]) runs physiotherapy centres at HSR Layout,
Koramangala and Whitefield, Bengaluru. This notice explains what personal data we collect, why,
who it is shared with, and your rights.

### What we collect

- **About you:** your name, phone number, date of birth, sex, and the guardian's details for
  patients under 18.
- **About your health:** the health form you fill in before your first visit (your problem, pain,
  history and health screening questions), your physiotherapist's assessment and diagnosis,
  treatment notes, exercise programme, questionnaire scores, reports and images you share with us,
  and the consents you give.
- **About your visits and payments:** appointments, attendance, bills, packages and payments.
- **Messages:** WhatsApp messages between you and the clinic.

### Why we use it

- To assess and treat you, and keep a clinical record of your care.
- To book and remind you of appointments, and send your documents and exercise programme.
- To bill you and keep financial records.
- To keep you safe: health screening flags conditions that need a doctor's attention first.
- To improve our care: anonymous figures (for example, how many patients recover by a review).

We use your health data only with your consent, which you give on the health form and before
treatment. You can withdraw consent at any time (see "Your rights"). Withdrawing does not undo care
already given, and we may need to keep records the law requires.

### Computer assistance with diagnosis

Our clinicians may use a computer tool that suggests possible diagnoses from your health form. It
receives your age, sex, symptoms and answers, but never your name, phone number or any number that
identifies you, and the service is not allowed to keep what it receives. Your physiotherapist makes
every diagnosis and treatment decision.

### Who we share it with

- **Your clinicians and our staff,** each seeing only what their role needs.
- **Service providers who run our software for us,** under contract, only to provide their service:
  - hosting and the database, in Mumbai, India;
  - WhatsApp (Meta), for messages;
  - the diagnosis-suggestion service described above;
  - error monitoring, which receives no health data.

  [The lawyer confirms whether to name them; see `data-processors.md`.]
- **Doctors or hospitals we refer you to,** with your agreement.
- **Authorities,** only when the law requires it.

We do not sell your data or use it for advertising. [If the clinic adds a marketing tick box
(decision 21): "We send offers only if you tick the box to agree; you can stop them at any time."]

### How long we keep it

[Decision 20, for the clinic and lawyer: the retention period for clinical records, bills and
messages, and what happens after it, for example deletion or anonymisation.]

### Your rights

You can ask us to:

- give you a copy of your data;
- correct it;
- delete it, where the law does not require us to keep it;
- withdraw your consent.

You can also nominate someone to act for you.

Ask at any centre's front desk or write to [grievance officer's name, email, phone]. We reply
within [30] days. If you are not satisfied, you can complain to the Data Protection Board of India.

### Children

For patients under 18, a parent or guardian gives consent and signs for them.

### Changes

We will tell you of important changes to this notice on WhatsApp or at your next visit. Last
updated: [date].

---

## Notes for the lawyer (not part of the notice)

- **What the software already does:**
  - **Requests:** records copy, correction and deletion requests, due
    `privacy.request_response_days` after receipt (30, a placeholder).
  - **Copies:** exports a patient's data as one file (ADM-03, `docs/runbooks/data-requests.md`).
  - **Deletion:** nothing is deleted or anonymised automatically until decision 20 sets the
    retention period.
- **Consent:** Part A (the health form) and Part B (before treatment, per modality) are recorded
  with a tick, timestamp, version and signature (`docs/runbooks/consent.md`). The notice must be
  shown before or with the Part A consent; say where it is linked from.
- **Cross border transfer:**
  - The database and application run in India (Mumbai).
  - Diagnosis suggestions go to model hosts in the United States or the European Union, through
    OpenRouter, with no identifiers and zero data retention on every request.
  - Error reports go to Sentry's EU region with personal data scrubbed.
  - Meta processes WhatsApp messages under its own terms.

  Please confirm what DPDP and its Rules require for each.
- **Regulatory check on diagnosis suggestion software (decision 23):** the AI preparation sheet is
  switched off in the software until the Super Admin records the legal clearance and the blind test
  pass.
- **Ownership of the knowledge base (decision 24):** a contract matter between the clinic and Velyx
  Labs, not part of this notice.
- **Paid questionnaire licences** (Oxford scores, WOMAC) are listed in the PRD's client
  dependencies. They are separate from privacy, but are on the same pre-launch list.
