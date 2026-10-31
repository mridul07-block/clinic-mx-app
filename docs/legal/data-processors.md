# Data processors: agreements to have in place before launch (OPS-07)

**Status:** a checklist by Velyx Labs from the software's configuration on 31 October 2026, for
the clinic and its lawyer. Each service below handles personal data on the clinic's behalf, so
each needs a data processing agreement (most offer a standard one to accept online) before real
patients' data reaches it.

| Service | What it does for us | Personal data it handles | Where | Agreement | Notes |
| --- | --- | --- | --- | --- | --- |
| Supabase | Database, sign in, file storage (reports, signatures, documents) | Everything: patients' identity, health records, bills, staff accounts | Mumbai (ap-south-1) | Supabase DPA: [to sign on the paid plan] | Production needs a paid plan with backups (`docs/runbooks/upgrade-to-production.md`) |
| Vercel | Runs the application | Passes through every request; keeps request logs (no bodies) | Mumbai functions (`bom1`); global edge | Vercel DPA: [to accept] | Logs carry addresses and paths, never patient names (rule 12) |
| Meta (WhatsApp Business Platform) | Appointment messages, reminders, booking forms, documents | Patients' phone numbers, names in messages, documents sent (summaries, receipts) | Meta's data centres | WhatsApp Business terms and Meta's data processing terms: [accepted with the business account] | Decision 1: which number. Messages never carry diagnoses beyond what a document sent to the patient holds |
| OpenRouter, and the model hosts it routes to | Diagnosis suggestions; patient content drafts | Age, sex, symptoms and form answers; never names, numbers or IDs (checked in code before sending) | United States and European Union hosts, pinned per task | OpenRouter terms, with zero data retention required on every request: [lawyer to review] | Off until decision 23's legal clearance (`docs/runbooks/ai-gate.md`) |
| Sentry | Error reports | None by design: names, phone numbers, IDs and form answers are removed before sending | EU region | Sentry DPA: [to accept] | `docs/runbooks/monitoring.md` |
| Better Stack | Uptime checks | None (it only calls the health address) | [region per account] | Not needed if no personal data; [lawyer to confirm] | |
| Resend (planned) | Staff sign in and password reset emails | Staff names and email addresses | [region per account] | Resend DPA: [to accept when set up] | Decision G9; staff only, never patients |
| Cloudflare (planned) | DNS and firewall on the clinic's domain (FND-05) | Passes through every request | Global | Cloudflare DPA: [to accept] | Set up with the clinic's domain |
| GitHub | Source code | None (fake data only in tests and fixtures, rule 12) | United States | Not needed | The repository must be private before launch |

## Also before launch

- **Velyx Labs itself** processes data when giving support. Support logins are read only, see no
  clinical records, and are granted by the Super Admin for at most 24 hours
  (`docs/runbooks/support-access.md`). The contract between the clinic and Velyx Labs needs a data
  processing clause, and decision 24 (who owns the knowledge base).
- **Paid questionnaires:** licences for the Oxford scores and WOMAC (PRD client dependencies).
- **A grievance officer** named in the privacy notice (`privacy-notice-draft.md`).
