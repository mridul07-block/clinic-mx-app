# WhatsApp

Sending WhatsApp messages through Meta's Cloud API (WA-01; TAD section 6). Every message is a row
in `message` first, Queued; inserting it queues the `whatsapp.send` job in the same transaction,
and the job sends it and records what came of it. Meta's webhook (WA-02) tells us when a message
is Delivered or Read, or failed after Meta took it, and brings the messages patients send; the
conversation router that answers them is WA-03. The clinic's templates are written and approved
in WA-06.

Decisions (user, 30 October 2026):

- **The Meta app:** "Clinic Mx Demo VelyxLabs" (App ID 1097854576362033, business portfolio
  VelyxLabs) and its test number, until the client's own number is connected at delivery (WA-12).
- **Recipients:** while `whatsapp.test_recipients_only` is on, clinic messages go only to the
  numbers on `whatsapp.test_recipients` (at most 5, as Meta's test number allows). Every other one
  is kept as Not sent, "Not on the WhatsApp test list."
- **What sends now:** the Super Admin's test message (Meta's `hello_world` sample). A clinic
  template is sent only once its registry entry says `approved` (WA-06). The jobs that already
  queue receipts, reminders and so on are connected to the sender ticket by ticket, as their
  templates are approved.
- **Token:** a permanent System User token, never the 24-hour one from the test page.

Decisions (user, 30 October 2026, WA-02):

- **Speed:** a webhook is handled within seconds of arriving, not at the next job tick.
- **Raw copies:** Meta's bodies are kept `whatsapp.event_retention_days` (7) for looking into a
  problem, then deleted.
- **What staff see:** Recent messages shows an incoming message by kind (Text, Reply, Flow,
  Other), never its text, until WA-03 and WA-13 decide who reads replies.

## The test number

| What | Value |
| --- | --- |
| Test number | +1 555 647 2996 |
| Phone Number ID | 1429559720231717 |
| WhatsApp Business Account ID | 1103346035769121 |
| Graph API version | v25.0 |

None of these is secret, but they live in the environment, not in code, so production switches
number by configuration only.

## Setting it up

1. **Create the System User token** (once, by the account owner):
   1. Open Meta Business settings → Users → System users.
   2. Add an Admin system user, for example "Clinic Mx server".
   3. Choose Assign assets: give it full control of the app "Clinic Mx Demo VelyxLabs" and of its
      WhatsApp account.
   4. Choose Generate token: pick the app, set the expiry to Never, and tick
      `whatsapp_business_messaging` and `whatsapp_business_management`.
   5. Copy the token straight into `apps/web/.env.local` as `WHATSAPP_ACCESS_TOKEN`. Never paste it
      into chat, email or git.
2. **Fill in the rest of `.env.local`:** `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_BUSINESS_ACCOUNT_ID`
   and `WHATSAPP_GRAPH_VERSION`, as in `.env.example`.
3. **Copy all four to Vercel** (Production): through the Vercel API with `VERCEL_TOKEN`, printing
   names only, then redeploy.
4. **Verify each test phone:** on the app's WhatsApp "Try it out" page, open the recipient list,
   add the number and enter the code Meta sends to it.
5. **Add the same numbers in the app:** Settings → WhatsApp → test recipients, with country code,
   for example `["+919845012345"]`. Settings reach every server within a minute.
6. **Send a test message:** WhatsApp templates → Test message. It is sent at the next job tick,
   within a minute, and arrives as Meta's "Hello World".
7. **Connect the webhook** (WA-02), once per Meta app:
   1. Copy the app secret into `apps/web/.env.local` as `WHATSAPP_APP_SECRET`: App settings →
      Basic → App secret → Show (Meta asks for the account password).
   2. Generate a random `WHATSAPP_WEBHOOK_VERIFY_TOKEN` straight into `.env.local` (at least 16
      characters), never printing it.
   3. Copy both to Vercel (Production) the same way as the token, and redeploy.
   4. In the Meta app: WhatsApp → Configuration → Webhook → Edit. Callback URL
      `https://<staging or production host>/api/whatsapp/webhook`; verify token: paste it from
      `.env.local`. Choose Verify and save: Meta calls the GET check and our answer repeats its
      challenge.
   5. Under Webhook fields, subscribe to `messages`.
   6. Check it: send a test message, open it on the phone, reply "hi". Recent messages shows it
      Delivered, then Read, and the reply as Incoming · Text, Received.

## The webhook

`/api/whatsapp/webhook` (WA-02; TAD sections 5 and 6):

| Request | Answer |
| --- | --- |
| GET with `hub.mode=subscribe` and our verify token | Meta's `hub.challenge`, as text |
| GET with anything else | 403, counted against the limit |
| POST signed with the app secret (`X-Hub-Signature-256`) | Stored, 200 at once, handled straight after |
| POST unsigned or signed wrongly | 401, counted against the limit; nothing stored |
| POST signed, but not a WhatsApp Business Account body | 200, nothing kept (Meta must not retry it) |
| More than 10 refused calls a minute from one network (`limits.webhook_failures_per_network`) | 429 with Retry-After |
| No `WHATSAPP_APP_SECRET` on the server | 503 |
| A body over 1 MB | 413 |

A stored body (`whatsapp_event`) queues its `whatsapp.event` job. The route handles it straight
after answering; the job is the fallback when that fails or the server stops, and a body already
handled is skipped. Meta retries a body we did not answer 200 for, for up to 7 days; a body it sends
twice changes nothing (statuses only move forward, a message is stored once by Meta's id).

A status can arrive before the send job has recorded Meta's id for the message. Such a body stays
unhandled and its job tries again (1, 2, 4 minutes); after 10 minutes a status for an id we never
sent (one sent from Meta's dashboard, say) is let go.

Handled bodies are deleted hourly (pg_cron `whatsapp-event-prune`) once older than
`whatsapp.event_retention_days`; a body never handled goes the same number of days after it came
(its job gave up long before and left the Super Admin a task).

## The conversation router

Every message sent to the clinic's number gets one route and one reply (WA-03; TAD section 6). The
webhook routes it straight after storing it; the `whatsapp.route` job queued with the message is
the fallback. The patient is linked to the message when the number is theirs alone (a family
shares a mobile, so nobody is guessed).

| They send | Route | Handler | Reply now |
| --- | --- | --- | --- |
| Typed text with an emergency phrase (checked first) | Emergency | WA-10 | The team's contact details |
| Other typed text | Typed message | WA-11 (assistant) | The three button menu |
| The menu's Book appointment | Book appointment | WA-04 | The team's contact details |
| The menu's Reschedule or cancel, or the reminder's Reschedule | Reschedule or cancel | WA-05 | The team's contact details |
| The menu's Talk to our team | Talk to our team | WA-09 (live) | The team's contact details |
| The day before reminder's Confirm | Confirm | WA-08 | The team's contact details |
| A booking or reschedule form completed | Booking form, Reschedule form | WA-04, WA-05 | The team's contact details |
| Anything else (a photo, a voice note, an old button) | Menu | WA-03 (live) | The three button menu |

When a ticket makes its handler live it changes one line of `routeHandlers`
(`packages/schemas/src/whatsapp-router.ts`).

- **The menu** (PRD J1.2): "How can we help you today?" with Book appointment, Reschedule or
  cancel, Talk to our team.
- **The team's contact details** (WA-09): the phone of the patient's centre when the number is
  theirs alone, otherwise every active centre's phone by name, and `whatsapp.front_desk_email`.
  Phones come from each centre's setup. What is not set is left out; with nothing set the reply
  asks them to call the clinic they visit.
- **Emergency phrases** (`whatsapp.emergency_phrases`, DECISION WA-03): matched as whole words in
  any case, apostrophes ignored ("can't breathe" = "cant breathe"). The list is a draft for the
  clinical director; change it on Settings. Only typed text is checked, never a tapped button.
- **The 24 hour window:** a reply that is not a template goes only within 24 hours of the person's
  last message to us (Meta's rule); later it is kept as Not sent. The test list applies too.
- **One reply, one message** (TAD section 6, Rules).

## Statuses

| Status | Meaning |
| --- | --- |
| Queued | Waiting for the job, or for another try after a failure Meta may get over |
| Sent | Meta took it and gave its message id (`wa_message_id`) |
| Delivered | On the patient's phone (Meta's webhook) |
| Read | Opened by the patient; a Read before its Delivered counts as both |
| Failed | Meta refused it, with its code and title (for example 131030, recipient not allowed), or it still failed at the last of 5 tries, or Meta took it and then could not deliver it (for example 131026) |
| Not sent | Off the test list, or WhatsApp is not configured on this server (local and CI) |
| Received | A message sent to the clinic's number: a text, a button or list reply, a Flow's answers, or anything else (kept by type only) |

Statuses only move forward: a late or repeated one changes nothing.

## Retries

The job queue retries a send that got no answer, a rate limit (429) or a fault on Meta's side (5xx).
It tries 5 times with growing pauses (1, 2, 4 and 8 minutes), then marks the message Failed and
gives the Super Admin a task. Any other refusal fails at once: it would never succeed. A message
already Sent, Failed or Not sent is never sent again, so a job that runs twice changes nothing.

## Rules

| Rule | Where |
| --- | --- |
| A queued outbound message queues its `whatsapp.send` job in the same transaction, once | Trigger `message_queue_send` |
| The Super Admin (not support) reads messages | Policy `message_read` |
| The Super Admin queues only a test send, as themselves, Queued, to no patient | Policy `message_test_send` |
| Nobody signed in changes or deletes a message; the server records outcomes as `system:whatsapp` | No update or delete policy; grants revoked |
| A message is Sent exactly when it has Meta's id and a sent time | Check `message_sent` |
| Every change is audited, in the clinical part of the audit log (ADM-01) | `audit_change`, `internal.audit_category` |
| Messages are in a patient's data copy, nothing hidden (ADM-03) | `internal.patient_export_tables` |
| Sent, Delivered and Read have Meta's id and the time Meta took it; Queued and Not sent have no id | Checks `message_accepted`, `message_not_sent` |
| An outbound message has its recipient and template; an inbound one its sender, Meta's id and time, an inbound kind, and is Received | Checks `message_outbound`, `message_inbound` |
| A webhook body is taken only with the app secret's signature over its exact bytes | `validWebhookSignature` (`apps/web/modules/messaging/webhook-signature.ts`) |
| Raw webhook bodies are the server's alone: no policy, no rights for any signed in role, not audited (the messages are) | `whatsapp_event`, `20261030112245_whatsapp_webhook_rules.sql` |
| A stored body queues its job, once | Trigger `whatsapp_event_queue` |
| Statuses only move forward | `deliveryChange` (`packages/schemas/src/whatsapp-webhook.ts`), `applyDeliveryUpdate` |
| Every message sent to us queues its route job, once, and is routed once | Trigger `message_queue_route`; `inboundToRoute` (row lock), `recordRoute` |
| Only an inbound message has a route, always with its time | Check `message_route` |
| A router reply is an outbound message of kind `session`, sent only within 24 hours of their last message | Check `message_outbound`; `sendQueuedMessage` |
| Emergency phrases come before any other route | `routeInbound` |
| Off the test list while it is on: Not sent; a test send is checked against the list when queued | `sendQueuedMessage` (`apps/web/modules/messaging/send.ts`), `sendTestMessageService` |
| Only an approved template is sent | `templateSendable` (`packages/schemas/src/messaging.ts`) |

## Switching to the client's number (WA-12)

1. In the client's Meta business, add and verify the number and set up billing in rupees (TAD:
   before 31 December 2026).
2. Submit the templates and Flows on that number, and mark each registry entry `approved` once
   Meta approves it.
3. Replace the four `WHATSAPP_*` values on Vercel with the client's, and redeploy.
4. Switch `whatsapp.test_recipients_only` off on Settings.

## Checking it

| Test | Covers |
| --- | --- |
| `packages/schemas/src/messaging.test.ts` | Numbers with country code; at most 5 on the list; masking; who may receive; unapproved templates; which failures are retried |
| `apps/web/modules/messaging/transport.test.ts` | The Cloud API call and body; Meta's code and short title, never its message; network failure or timeout |
| `apps/web/modules/messaging/send.test.ts` | Sent with Meta's id; Not sent off the list, or not configured; anyone once the list is off, variables in registry order; a test send checked when queued; retried, then Failed at the last try; a refusal Failed at once; nothing sent twice |
| `apps/web/modules/messaging/services.test.ts` | The test send by the Super Admin only, to a listed number; recent messages for the Super Admin only |
| `packages/db/src/integration/messaging.integration.test.ts` | Under row level security: the send job queued with the message; the Super Admin's test send, audited as them; clinic messages by the system only; nobody else reads or queues; nobody signed in updates or deletes; outcomes recorded once; Sent needs Meta's id |
| `apps/web/e2e/whatsapp-test-message.spec.ts` | At 360 px and desktop: the Super Admin adds a number on Settings and sends a test message, kept as Not sent "not configured" in tests; the desk has no page |
| `packages/schemas/src/whatsapp-webhook.test.ts` | Meta's body: statuses with failure reasons; text, button, list, Flow and other messages; odd items counted, not dropped; delivery only moving forward |
| `apps/web/modules/messaging/webhook-signature.test.ts` | Meta's HMAC over the exact bytes; another body, secret, scheme or none refused; the verify token |
| `apps/web/app/api/whatsapp/webhook/route.test.ts` | Stored and answered 200, handled straight after; 401, 429, 503, 413; a body not about WhatsApp kept nowhere; the subscribe check |
| `apps/web/modules/messaging/webhook.test.ts` | Delivered and Read applied under a lock, then marked handled; a message stored once; a handled body skipped; a status ahead of its send waited on, then let go |
| `packages/db/src/integration/whatsapp-webhook.integration.test.ts` | Under row level security: a body queues its job and nobody signed in reads or writes it; pruning; Delivered then Read, never back; Failed after Sent keeps the id; inbound stored once and read by the Super Admin only; the new checks |
| `apps/web/e2e/whatsapp-webhook.spec.ts` | At 360 px and desktop, with bodies signed by the test secret: a sent message moves to Delivered, then Read; a reply shows as Incoming · Text, Received, never its text; unsigned refused; the subscribe check |
| `packages/schemas/src/whatsapp-router.test.ts` | Emergency phrases (case, punctuation, apostrophes, whole words) first; every button, reminder reply and Flow to its route; every route's handler and fallback; the menu within Meta's limits; the contact details with nothing invented |
| `apps/web/modules/messaging/router.test.ts` | Typed text gets the menu as a reply to it; Talk to our team from an unknown number lists every centre; a known patient is linked and gets their centre; an emergency is routed first; routed once |
| `apps/web/modules/messaging/send.test.ts` (router replies) | The menu with its buttons and the contact details as text; Not sent after 24 hours or with no message from them; the test list |
| `packages/db/src/integration/whatsapp-router.integration.test.ts` | The route job queued once; routed once, inbound only; replies are outbound and queue their send; a number linked only when one patient's; the last message time; centre contacts |
| `apps/web/e2e/whatsapp-router.spec.ts` | At 360 px and desktop, with bodies signed by the test secret: typed text, Talk to our team and an emergency phrase each routed and answered once; Recent messages shows the routes and replies, never the text |

Without the test list check in `sendQueuedMessage`, the unit test "keeps a clinic message to a
number off the test list as Not sent" fails. Without the signature check in the webhook route, the
route test "refuses a wrong, missing or other body's signature" fails. With the emergency check after the
typed-text route, the router test "come before anything else a typed message would get" fails.
