# WhatsApp

Sending WhatsApp messages through Meta's Cloud API (WA-01; TAD section 6). Every message is a row
in `message` first, Queued; inserting it queues the `whatsapp.send` job in the same transaction,
and the job sends it and records what came of it. The webhook (delivered, read, incoming messages)
is WA-02; the clinic's templates are written and approved in WA-06.

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

## Statuses

| Status | Meaning |
| --- | --- |
| Queued | Waiting for the job, or for another try after a failure Meta may get over |
| Sent | Meta took it and gave its message id (`wa_message_id`) |
| Failed | Meta refused it, with its code and title (for example 131030, recipient not allowed), or it still failed at the last of 5 tries |
| Not sent | Off the test list, or WhatsApp is not configured on this server (local and CI) |

Delivered and Read arrive with WA-02.

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
| Every change is audited | `audit_change` |
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

Without the test list check in `sendQueuedMessage`, the unit test "keeps a clinic message to a
number off the test list as Not sent" fails.
