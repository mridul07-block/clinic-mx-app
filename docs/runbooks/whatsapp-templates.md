# WhatsApp templates

Every WhatsApp template Clinic Mx sends (SET-11, WA-06; TAD section 6), with its text, its
variables, and what Meta decided about it on this environment's number. The Super Admin views them
at `/app/templates` (`templates.manage`).

## Where it lives

**The text, in code:** `packages/schemas/src/message-templates.ts`, typed (decision of 24 October
2026):

- `MessageTemplateKey` is the union of keys, so messaging code cannot name an unknown template.
- `TemplateParameters<K>` is everything a message row must carry to send it: the text's
  variables, each link button's token, and for a PDF header `document_link` and `document_name`.
- Each template has its `body` (`{{n}}` is the n-th text variable), made-up `example` values for
  Meta's review, its buttons and a `version`.

**Meta's verdict, in the database:** `whatsapp_template` holds one row per version submitted on
this environment's number: Meta's name and id, category, status (Waiting for Meta, Approved,
Rejected, Paused, Disabled) and Meta's reason. The test number and the client's number (WA-12)
each have their own rows, which is why it is not in code. Only the server writes it, audited
(`system:whatsapp-templates` from the script, `system:whatsapp` from the webhook); the Super Admin
reads it.

**Sending:** a clinic template message goes as the newest version Meta approved on this number
(`approvedTemplateVersion`), named `<key>_v<version>` on Meta. With none approved it is kept as Not
sent, "Meta has not approved this template on this number". A quick reply sends back
`<key>.<button id>` (for example `first_treatment_check.still_sore`) for the router; a link button
opens `<origin>/p/<token>`.

## Who sends what (WA-06 senders)

The database queues each message as a job; its sender (`apps/web/modules/messaging/clinic-messages.ts`)
checks it is still due, then queues the template for the patient's number, once per job (the job's
key is the message's `source_key`). The send job then sends the newest approved version, or keeps it
as Not sent.

| Template | Queued by | Sent only when |
| --- | --- | --- |
| `first_treatment_check` | session 1 signed (PAT-05) | not answered yet; stands for the visit's feedback link |
| `session_3_check` | session 3 signed (PAT-06) | the episode is Active or Under review |
| `follow_up_check` | discharge, per interval (PAT-10) | that interval is due and unanswered; no newer episode open; stands for the follow up link |
| `review_request` | discharge (PAT-09) | always; the button opens a `review` link to the centre's Google page; fails visibly without one |
| `no_show` | No show (ALT-04) | still a no show |
| `package_expiry_reminder` | package activated (BIL-08) | still active with sessions left |
| `plan_sessions_list` | Book plan sessions (SCH-11) | sessions still Booked or Confirmed |
| `red_flag_safety_advice` | referral, Monitor with caution (CLN-11) | always, with the centre's phone; fails visibly without one |

A tap on a check's reply button comes back as `<template>.<answer>` with our message's id as its
context: the router (`check_answer`) records it as the answer of the link that message stands for and
thanks the patient. The consultation summary, discharge report and receipt (PDFs) follow in part 2;
"I'll think about it" has no template.

## The text (WA-06)

Drafted by Velyx Labs from the facts each message already carries; plain English, no clinical
advice, transactional so Meta keeps them in the utility category (decision of 30 October 2026).
**The client confirms the wording before WA-12 submits it on the real number (DECISION WA-06).**

- The red flag safety advice is holding text with no medical advice ("your physio has advised
  further checks ... follow the advice you were given at the clinic ... call us on {{2}}"). The
  clinical lead's signed-off advice replaces it as a new version.
- The day before reminder is written but held: its Reschedule button opens the reschedule Flow,
  which WA-05 builds and submits it with.
- The plan sessions list joins the sessions with "; ", because Meta refuses line breaks in a
  variable.
- The review request might be moved to the Marketing category by Meta; the page shows it, and a
  marketing template costs more and needs the person's opt in (raise it with the client).
- The "I'll think about it" nudge (BIL-02) has no template in the TAD list; none is written.

The registry test checks Meta's rules before anything is submitted: at most 1,024 characters, no
variable at the start or the end or two side by side, `{{n}}` in order, an example for every
variable, Meta's button limits.

## Submitting and syncing

```bash
# With the environment's WhatsApp token, business account and DATABASE_URL (apps/web/.env.local
# for staging):
pnpm whatsapp:templates submit --origin https://clinic-mx-app.vercel.app
pnpm whatsapp:templates sync
```

- `submit` lists Meta's templates, creates each registry version not there yet (held ones left
  out), and records Meta's verdict on every version of ours. A PDF header needs an example: the
  script generates a one page "sample document" PDF (no patient data) and uploads it once with
  Meta's resumable upload. Link buttons are submitted as `<origin>/p/{{1}}`.
- `sync` records Meta's verdict again, for when the webhook was not subscribed or missed one.
- Both print template names and statuses only, never the token.

Meta reviews utility templates in minutes to a day. **Webhook:** in the Meta app, Webhooks,
WhatsApp Business Account, subscribe `message_template_status_update` and
`template_category_update` (the callback is the existing `/api/whatsapp/webhook`). Their bodies are
signed like every other and move the rows on; a template not ours (Meta's samples, another
environment's) is left alone. Updates apply in the order they arrive: should Meta deliver an old
"approved" after a newer "paused", the page shows Approved until the next update or a `sync`
(sending then fails at Meta and the message is Failed with Meta's reason).

A version deleted on Meta and created again gets a new Meta id; recording it is refused ("has
another id on Meta than the one recorded"). Raise the version in the registry and submit instead.

## Changing a template

1. Change the entry in `message-templates.ts` and raise its `version`. Meta treats changed text as
   a new template (`<key>_v2`); the approved older version keeps sending until the new one is
   approved.
2. Adding a template: a new entry with a new snake case key, a source, examples, and version 1.
   Keep it transactional (TAD section 6); marketing messages are out of scope.
3. Run `pnpm test` (the registry test), update the count in `apps/web/e2e/templates.spec.ts`, then
   `pnpm whatsapp:templates submit` on each environment.
4. A rejected version: read Meta's reason on the page, fix the text, raise the version, submit.

## The client's number (WA-12)

With the client's WhatsApp number and business account in the production environment: confirm the
wording with the client and the red flag advice with the clinical lead, subscribe the two webhook
fields in that Meta app, run `submit` with the production domain as `--origin`, and wait for
Approved on every template before switching off `whatsapp.test_recipients_only`.

## Checking it

| Test | What it checks |
| --- | --- |
| `packages/schemas/src/message-templates.test.ts` | Every TAD template once; snake case keys; Meta's text and button rules; the create request (PDF header handle, link buttons with examples, quick replies); only the reminder held; types per key. |
| `apps/web/modules/messaging/meta-templates.test.ts` | Submit creates only what Meta lacks, uploads one sample PDF, leaves the held one out and records ours only; sync records verdicts and reasons; the token never in a URL; Meta's refusal reported. |
| `apps/web/modules/messaging/send.test.ts` | An unapproved template is Not sent without calling Meta; the newest approved version is sent with its PDF, link tokens and quick reply payloads. |
| `apps/web/modules/messaging/webhook.test.ts` | Template verdicts and category changes applied; templates not ours left alone. |
| `packages/db/src/integration/whatsapp-templates.integration.test.ts` | The newest approved version is sent, paused or rejected ones are not; Meta's webhook moves a row on once; a version keeps its identity; audited as the server; only the Super Admin reads, nobody signed in writes. |
| `apps/web/e2e/templates.spec.ts` | 360 px and desktop: 16 cards with their text; the held reminder says why; a recorded version shows Waiting for Meta, then Rejected with Meta's reason and Approved after signed webhooks; the front desk and a physio are refused. |
