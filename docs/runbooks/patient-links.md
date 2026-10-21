# Patient links

IAM-09, TAD sections 3 and 5. Patients never log in. They reach their health form, consent,
"My plan", questionnaires and feedback through personal links at `/p/<token>`.

Each link is:

- signed;
- for one purpose;
- tied to one appointment or episode;
- valid until it expires.

## Decisions (user, 22 October 2026)

- **Lifetimes are settings**, changed by the Super Admin:

  | Purpose | Lifetime | Setting |
  | --- | --- | --- |
  | Health form | 2 hours | `links.health_form_hours` |
  | Consent | 2 hours | `links.consent_hours` |
  | Questionnaire | 7 days | `links.questionnaire_days` |
  | Feedback | 7 days | `links.feedback_days` |
  | My plan | 30 days | `links.my_plan_days` |

- **Only the newest My plan link works.** Issuing one stops the patient's older My plan links.
- **Form links accept one submission.** Health form, consent, questionnaire and feedback links show
  "You have already sent this. Thank you." afterwards. My plan links work until they end.

## The token

- **Shape.** `base64url(payload ‖ mac)`, 51 characters:
  - the payload is a version byte, the link id (16 bytes), a purpose byte and the expiry in epoch
    seconds (4 bytes);
  - the mac is HMAC-SHA256, cut to 16 bytes, over the domain tag `clinic-mx/patient-link/v1` and
    the payload;
  - the code is `packages/db/src/patient-links.ts`.
- **Key.** `PATIENT_LINK_SECRET` signs links. It is at least 32 random characters, different in
  each environment, and set on Vercel and in `apps/web/.env.local` (rule 13).
- **What the database holds.** Only the link id, never the token. A copy of the database cannot
  open or make a link.
- **One spelling per token.** A token must be the exact text signing produced, spare bits
  included.

### Rotating the key

1. Move the value to `PATIENT_LINK_SECRET_PREVIOUS`.
2. Set a new `PATIENT_LINK_SECRET`.
3. Redeploy.
4. After the longest lifetime (`links.my_plan_days`) has passed, clear the previous key.

## Opening a link (`openPatientLink`, `apps/web/modules/patient-links/services.ts`)

Checks run in this order:

1. **The signature.** A changed or forged token is "not valid" before the database is asked
   anything.
2. **The expiry in the token.** It says "expired" without the database.
3. **The row.** It must exist and match the token's purpose and expiry. Otherwise the link is "not
   valid". Then:
   - stopped by a newer My plan link: "expired";
   - submitted: "already sent";
   - otherwise valid.

A valid open is audited as a `view` by `patient:<id>` on `patient_link`.

What the page `/p/[token]` shows patients:

| State | Message |
| --- | --- |
| Valid | The purpose's title. The page itself comes with that purpose's ticket (INT, MYP, FBK). |
| Expired or stopped, My plan | "This link has expired. To get a new one, send "My plan" to Movementology Clinics on WhatsApp." The WhatsApp router (MSG tickets) must answer that message with `reissueMyPlanLink`. |
| Expired, anything else | "This link has expired. Please ask the clinic for a new one." |
| Submitted | "You have already sent this. Thank you." |
| Not valid | "This link is not valid. Please ask the clinic for a new one." |

Headers on `/p/*` (`next.config.ts`):

- `Referrer-Policy: no-referrer`, so the token never reaches another site;
- `Cache-Control: private, no-store`;
- `X-Robots-Tag: noindex, nofollow`.

## Issuing a link

| Function | When | How |
| --- | --- | --- |
| `issuePatientLink(tx, {patientId, purpose, appointmentId or episodeId})` | Inside the caller's audited transaction: check-in, plan acceptance, messages | The lifetime comes from the purpose's setting. Returns `/p/<token>`; the caller adds our domain, never supabase.co (rule 9). |
| `reissueMyPlanLink(db, {patientId, episodeId})` | The WhatsApp handler, once it knows which patient wrote | A `systemService` audited as `system:whatsapp`. |
| `completePatientLink(tx, link)` | Submitting a form | Single-use links only. |

`patient_link` (no foreign keys yet; the PAT and SCH tickets add them):

- **Columns:** `patient_id`, `purpose`, `appointment_id` or `episode_id`, `expires_at`,
  `revoked_at`, `completed_at`.
- **Subject checks:**
  - exactly one subject;
  - a health form has an appointment;
  - a questionnaire or My plan has an episode.
- **Audited** by the trigger: issued is an insert; stopped or completed is an update.

## Patient access under row level security

- **How patient pages read.** `asPatient(link, work)` (`apps/web/modules/access/patient-db.ts`)
  reads through `withPatientAccess`. That runs one transaction:
  - as the Postgres role `clinic_patient` (NOLOGIN, switched to with `set local role`);
  - with `patient_link` in its claims;
  - with `patient:<id>` as the audit actor.
- **What a patient sees.** Policies `TO clinic_patient` show only what that link reaches.
  - Today that is its own `patient_link` row.
  - Every patient table must add its own policy the same way, and grant `SELECT` to
    `clinic_patient`.
- **Staff.** Staff have no policy on `patient_link` yet.
- **Catalog test.** It allows policies `TO authenticated` or `TO clinic_patient`, never `anon`.
- **Opening a link is the patients' sign in.** So `modules/patient-links` may read with the owner
  connection (ESLint system files), like `modules/auth`.

## Checking it

| Test | What it covers |
| --- | --- |
| `packages/db/src/patient-links.test.ts` | Every changed character, other key, junk, respelling, rotation |
| `apps/web/modules/patient-links/services.test.ts` | Issue, reissue, open states, complete |
| `packages/db/src/integration/patient-links.integration.test.ts` | Checks, audit, a patient sees only its link and changes nothing, staff see none |
| `apps/web/e2e/patient-links.spec.ts` | 360 px and desktop |
