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
| Typed text with an emergency phrase (checked first) | Emergency | WA-10 (live) | None: the handler sends the emergency advice and raises the call back task (see "Emergency messages") |
| Other typed text | Typed message | WA-11 (assistant) | The three button menu |
| The menu's Book appointment | Book appointment | WA-04 (live) | The booking form (the team's contact details where it is not set up) |
| The menu's Reschedule or cancel, or the reminder's Reschedule | Reschedule or cancel | WA-05 (live) | The reschedule form (the team's contact details where it is not set up) |
| The menu's Talk to our team | Talk to our team | WA-09 (live) | The team's contact details |
| The day before reminder's Confirm | Confirm | WA-08 (live) | None: the handler confirms the appointment and thanks them (see "Reminders") |
| A booking form completed | Booking form | WA-04 (live) | None: the form sent the confirmation when it booked |
| A reschedule form completed | Reschedule form | WA-05 (live) | None: the form sent the confirmation when it moved the appointment |
| Anything else (a photo, a voice note, an old button) | Menu | WA-03 (live) | The three button menu |

When a ticket makes its handler live it changes one line of `routeHandlers`
(`packages/schemas/src/whatsapp-router.ts`).

A completed form is known by the Flow token in its answers: Meta names every completion `flow`,
so the router finds our session by the token and routes by its kind (booking or reschedule). Before
WA-05 it matched the name, and a real completed booking form would have been answered with the
menu.

- **The menu** (PRD J1.2): "How can we help you today?" with Book appointment, Reschedule or
  cancel, Talk to our team.
- **The team's contact details** (WA-09): the phone of the patient's centre when the number is
  theirs alone, otherwise every active centre's phone by name, and `whatsapp.front_desk_email`.
  Phones come from each centre's setup. What is not set is left out; with nothing set the reply
  asks them to call the clinic they visit.
- **Emergency phrases** (`whatsapp.emergency_phrases`, DECISION WA-03): matched as whole words in
  any case, apostrophes ignored ("can't breathe" = "cant breathe"). The list is a draft for the
  clinical director; change it on Settings. Only typed text is checked, never a tapped button.
- **Emergency messages** (WA-10; PRD J1.9): typed text with an emergency phrase gets, never a
  booking or the menu:
  - **The advice** `whatsapp.emergency_advice`, then the clinic's phone, chosen as for the contact
    details: the patient's centre when the number is theirs alone, otherwise every active centre's
    phone by name. A centre without a phone is left out. The advice is the standard safety text
    ("call 112 or go to the nearest hospital emergency department now") until the clinical director
    confirms it (DECISION WA-10); change it on Settings, keeping it to emergency services.
  - **An urgent task** `call.emergency` for the Front Desk: at the patient's centre when the number
    is theirs alone, otherwise at every centre. It names the message, never the number; its card
    shows "Call +91 …" (a `tel:` link), read through `internal.task_call_back_phone` for those who
    may read the task (never a Velyx support login). One open task per number: further messages get the advice again but add no
    task until it is closed (user decisions, 31 October 2026). The message's text is never shown.
- **The 24 hour window:** a reply that is not a template goes only within 24 hours of the person's
  last message to us (Meta's rule); later it is kept as Not sent. The test list applies too.
- **One reply, one message** (TAD section 6, Rules).

## The booking Flow

"Book appointment" opens a WhatsApp Flow (WA-04; PRD J1.1 to J1.3, J1.8; TAD section 6). The
router sends it with a new session (`whatsapp_flow_session`) as the Flow token; every screen Meta
posts to `/api/flows/booking` carries the token, so the server knows whose number it serves
without trusting the form, and keeps what was picked on the session.

Decisions (user, 30 October 2026):

- **Screens:** a clinic, then a date with a free consultation in the next
  `booking.whatsapp_days_ahead` (14) days, then a free time, then a physio free then, each with
  their consultation fee, then who is coming (someone already on this number, or someone new with
  a name), then a summary to confirm.
- **After confirming:** the last screen shows the appointment ID and the details, and the booking
  confirmation follows (WA-07, `docs/runbooks/whatsapp-templates.md`, "The booking confirmation"):
  the same message every booking gets.

How it holds and books:

- Picking a time and physio holds the slot for `booking.slot_hold_minutes` (holder
  `flow:<session>`), the same hold the front desk gets.
- Confirm books it as the system (`system:whatsapp`, channel WhatsApp, no booked by), with the
  same checks as every booking (`bookAppointment`, `docs/runbooks/slots.md`). A new person is
  added as a patient registered at the chosen clinic.
- A slot taken meanwhile (the hold ran out and someone booked it) sends them back to the time
  screen, with "This slot was just booked. Pick another time." and the times still free.
- A patient whose self booking is blocked (2 reschedules or 2 no shows, SCH-09), or a number that
  is not Indian, gets a screen with the team's contact details instead.
- A second confirm (Meta retries) returns the same booking. A session lasts 24 hours and is
  deleted with the webhook copies, after `whatsapp.event_retention_days`.

The endpoint:

| Request | Answer |
| --- | --- |
| Signed with the app secret, sealed with our public key | The next screen, sealed with the request's key and the IV flipped, as Base64 text |
| Meta's health check (`ping`) | `{"data":{"status":"active"}}`, sealed |
| Meta's notice of an error it showed | Acknowledged, sealed |
| A wrong or missing signature | 432, counted against `limits.webhook_failures_per_network` |
| Cannot be opened (another key, changed on the way) | 421: Meta fetches our public key again and retries |
| A Flow token we do not know, or older than 24 hours | 427 |
| No private key or app secret on the server | 503 |

### Setting the Flows up (booking done for the test number, 30 October 2026)

1. **Key pair:** a 2048 bit RSA pair. The private key goes straight into `apps/web/.env.local` as
   `WHATSAPP_FLOW_PRIVATE_KEY` (Base64 of the PEM), never printed; the public key is uploaded with
   `POST /{phone-number-id}/whatsapp_business_encryption` (`business_public_key`). Meta signs it;
   `GET` on the same path shows `VALID`.
2. **The Flows:** `pnpm whatsapp:flows <booking|reschedule> --origin https://<host>` (WA-05)
   creates the Flow on the WhatsApp Business Account (`POST /{waba-id}/flows`, "Clinic Mx booking"
   or "Clinic Mx reschedule", category Appointment booking, endpoint
   `https://<host>/api/flows/<kind>`), uploads its JSON from `apps/web/modules/messaging/flows/`
   (`POST /{flow-id}/assets`) and prints its id and Meta's validation errors. With `--id <flow id>`
   it updates that Flow's JSON and endpoint instead. The booking Flow was made by hand the same way
   before the command existed. On the test number they stay drafts, sent with `mode: draft`.
3. **Vercel:** `WHATSAPP_FLOW_PRIVATE_KEY`, `WHATSAPP_BOOKING_FLOW_ID`,
   `WHATSAPP_RESCHEDULE_FLOW_ID` and `WHATSAPP_FLOW_MODE` (`draft` on staging), printing names only,
   then redeploy. Both Flows use the one key pair.

**Changing a Flow:** edit the JSON, upload it again (`pnpm whatsapp:flows <kind> --origin ...
--id <flow id>`), and change the screens' code in `apps/web/modules/messaging/booking-flow.ts` or
`reschedule-flow.ts` with it. Meta's routing model lists forward routes only: a route straight
back to the screen before (the reschedule form's confirm back to its date screen) is refused, and
going back needs none. The reschedule Flow was created on the test number on 31 October 2026 (id
1440709014915479, a draft, no validation errors). A published Flow cannot be edited: publish a
new one and change `WHATSAPP_BOOKING_FLOW_ID`.

**Rotating the key:** make a new pair, upload the public key, then replace the private key on
Vercel and redeploy; requests sealed for the old key get 421 and Meta retries with the new one.

## The reschedule Flow

"Reschedule or cancel" on the menu opens the reschedule form (WA-05; PRD J1.7, J1.8; Frontend
Specification, Reschedule), and so will the day before reminder's Reschedule button (sent by WA-08).
Its endpoint is `/api/flows/reschedule`, signed, sealed and answered exactly as the booking
endpoint (`flowEndpoint`, `apps/web/modules/messaging/flow-endpoint.ts`); a token of the booking
Flow there is 427, and the other way round.

Decisions (user, 31 October 2026):

- **Reschedule only.** Cancelling stays with the clinic until decision 11 (late cancellation) is
  settled: the date screen says "To cancel, call the clinic on <centre phone>" (DECISION WA-05).
- **Reschedules left, both as they apply:** a package session shows "This package has N
  reschedules left; moving uses one."; every appointment shows "You can move appointments online N
  more times." (`booking.self_booking_block_reschedules` less those counted).
- **Dates:** the next `booking.whatsapp_days_ahead` (14) days from today, as booking.

The screens:

1. **Which appointment** (from the menu only): the Booked or Confirmed appointments from now on of
   everyone on this number, soonest first (a family shares one). The reminder's session names its
   appointment and opens straight on the date (`rescheduleFlowToken`, lasting until the
   appointment starts).
2. **New date and time:** the appointment's type and number, who, the clinic and physio
   (prefilled, never changed), its current time, the reschedules left and the cancel line. The
   dates with a free start for that physio and type; picking one loads its times. The old time
   counts as free, but is not offered as a move.
3. **Check and confirm:** from and to.
4. **Moved:** the new appointment number and what was moved, and the booking confirmation for the
   new appointment follows (WA-07). Older rows keep the key `reschedule_confirmation`.

Refused, with the team's contact details instead of dates:

| When | Says |
| --- | --- |
| A Zero Gravity Treadmill appointment (`packages.never_reschedulable_items`), with or without a package | Zero Gravity Treadmill sessions cannot be moved online. |
| Self booking blocked (2 reschedules or 2 no shows, SCH-09) | Online changes are paused for this patient after several reschedules or missed visits. |
| A package session with no reschedules left (SCH-10) | This package has no reschedules left, so this session cannot be moved online. |
| No longer Booked or Confirmed, started, or not this number's | This appointment can no longer be moved online. |
| No upcoming appointment on this number | There is no upcoming appointment on this number to move. |

How it moves:

- Picking a time holds it for `booking.slot_hold_minutes` (holder `flow:<session>`).
- Confirm, in one transaction as the system (`system:whatsapp`): the old appointment becomes
  Rescheduled, by the patient, `change_channel` WhatsApp and no staff member; then the new one is
  booked for the same patient, episode, clinic, physio and type, channel WhatsApp,
  `rescheduled_from_id` the old one. If the new booking is refused nothing changes (PRD J1.7). The
  database counts the reschedule (SCH-09) and takes one of the package's (SCH-10), whose refusal
  the form shows.
- A time taken meanwhile sends them back to the date screen with "This slot was just booked. Pick
  another time." and the times still free. A second confirm (Meta retries) returns the same move.

## Reminders

The appointment reminders (WA-08; PRD J1.6; TAD section 8). Decisions (user, 31 October 2026):

- **When:** every evening at `reminders.day_before_time` (6:00 PM IST) for the next day's
  appointments, and every morning at `reminders.morning_time` (8:00 AM IST) for the day's. A
  booking made after the evening's run gets no day before reminder; the morning one still reaches
  it.
- **Who:** every Booked or Confirmed appointment of the date not started yet, of every type, one
  message per appointment (a family on one number gets one each). The morning reminder goes to
  every patient, confirmed or not.
- **Confirm** answers "Thank you, your appointment on <day> at <time> is confirmed." (the same once
  confirmed already). One moved, cancelled or started since gets "This appointment has changed, so
  it cannot be confirmed here." with the team's contact details.

How it works:

- Two daily jobs, `whatsapp.day_before_reminders` and `whatsapp.morning_reminders`, keyed by the
  appointments' IST date (`docs/runbooks/jobs.md`). Each run first queues the next, at the setting's
  time as it is then (a changed time applies from the next run), then queues the day's reminders.
  A run late after downtime catches up to the next one, never every missed day; a day before run
  held up past midnight sends nothing, leaving the day to the morning reminder.
- Each reminder is queued once per appointment (`source_key`
  `whatsapp.day_before_reminder:<appointment id>` or `whatsapp.morning_reminder:<appointment id>`) and
  records its appointment (`message.appointment_id`). The day before reminder carries a reschedule
  session naming the appointment, lasting until it starts (`rescheduleFlowToken`, "The reschedule
  Flow"), which its Reschedule button opens.
- **Confirm** comes back as the quick reply `day_before_reminder.confirm` with Meta's id of the
  reminder it answers: the router finds that reminder (`repliedMessage`) and its appointment, and
  `confirmAppointment` makes a Booked one Confirmed with when (`confirmed_at`), as `system:whatsapp`,
  audited. The desk's sheet shows "Confirmed: On WhatsApp, <date> <time>". A Confirm on any other
  message gets the menu.
- Until Meta approves the two templates they are kept as Not sent, "not approved".

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
| One open emergency task per number, even for two messages at once | `raiseEmergencyTask` (`packages/db/src/emergency.ts`, a lock on the number) |
| An emergency task's number only for those who may read the task | `internal.task_call_back_phone` (migration `emergency_reply`) |
| Off the test list while it is on: Not sent; a test send is checked against the list when queued | `sendQueuedMessage` (`apps/web/modules/messaging/send.ts`), `sendTestMessageService` |
| Only an approved template is sent | `templateSendable` (`packages/schemas/src/messaging.ts`) |

## Switching to the client's number (WA-12)

1. In the client's Meta business, add and verify the number and set up billing in rupees (TAD:
   before 31 December 2026).
2. Submit the templates and Flows on that number, and mark each registry entry `approved` once
   Meta approves it.
3. Replace the four `WHATSAPP_*` values on Vercel with the client's, and redeploy.
4. Set up both Flows on that number as in "Setting the Flows up": a new key pair uploaded to the
   number, each Flow created on the client's account and published once Meta approves it,
   `WHATSAPP_FLOW_MODE=published`. Then submit the day before reminder with the published
   reschedule Flow's id.
5. Switch `whatsapp.test_recipients_only` off on Settings.

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
| `apps/web/modules/messaging/flow-crypto.test.ts` | Meta's sealing both ways with a key pair made for the test; another key or changed data refused |
| `apps/web/app/api/flows/booking/route.test.ts` | The health check and a screen sealed as Meta expects; Meta's error notice acknowledged; 432, 421, 427, 503, 429 |
| `apps/web/modules/messaging/router.test.ts` (booking) | Book appointment sends the form with a new session, or the contact details where it is not set up; a completed form gets no reply |
| `packages/db/src/integration/whatsapp-flows.integration.test.ts` | Sessions keep what was picked, are the server's alone, need a number with its country code, and go after the retention days; consultation fees |
| `packages/schemas/src/reschedule-flow.test.ts` | The reschedules left, both limits as they apply; the Zero Gravity Treadmill with or without a package, a blocked patient and a used up package refused |
| `apps/web/modules/messaging/router.test.ts` (reschedule) | Reschedule or cancel sends the reschedule form with a new session, or the contact details where its Flow is not set up; a completed form known by its token's session, an unknown token gets the menu |
| `apps/web/modules/messaging/send.test.ts` (forms) | Each form with its own Flow id, text and button, as a draft; Not sent where its Flow is not set up |
| `apps/web/modules/messaging/meta-flows.test.ts` | `pnpm whatsapp:flows`: created with its endpoint, JSON uploaded, validation errors returned, updated by id; the token never in a URL; https only |
| `packages/db/src/integration/whatsapp-flows.integration.test.ts` (reschedule) | Reschedule sessions; the number's upcoming appointments, everyone on it, soonest first; the patient's own move with no staff member, counted; any other change needs a staff member, a reason never without one; no signed in person claims WhatsApp; a package session uses its reschedule, then is refused |
| `apps/web/e2e/reschedule-flow.spec.ts` | At 360 px and desktop, as Meta: Reschedule or cancel opens the form; the appointment, prefilled clinic and physio, reschedules left, dates, times, confirm; moved as by the patient on WhatsApp, counted, confirmed by text; a second confirm moves nothing more; the completed form routed by its token with no reply; the desk's sheet says "By the patient, on WhatsApp". From the reminder's session: the Zero Gravity Treadmill, a used up package and a blocked patient refused; a time taken meanwhile sends them back |
| `packages/schemas/src/reminders.test.ts` | The next evening's and morning's run at the setting's time, catching up after downtime; the day before run only before its day; the Confirm answers |
| `apps/web/modules/messaging/reminders.test.ts` | One reminder per appointment with its appointment and a reschedule session; nothing twice, no session for one queued already; nothing once the day has begun; the morning one to every patient; the next run queued first at the setting's time |
| `apps/web/modules/messaging/router.test.ts` (Confirm) | Confirm confirms the reminder's appointment and thanks them with its day and time, the same once confirmed; changed since: the centre's contact details; Confirm on another message: the menu |
| `packages/db/src/integration/reminders.integration.test.ts` | The date's Booked and Confirmed appointments not started, soonest first; Confirm only for a Booked one not started; a reminder names its appointment, is queued once, and outlives a removed appointment; the next run queued once per date |
| `apps/web/e2e/reminders.spec.ts` | At 360 px and desktop: the evening's run reaches every appointment of the day (a family on one number one each, a cancelled one left out), once; its Reschedule opens the form on that appointment; Confirm through the signed webhook confirms only that one and thanks them; the morning's run reaches every patient; the desk sees "On WhatsApp" |
| `apps/web/e2e/booking-flow.spec.ts` | At 360 px and desktop, as Meta: Book appointment opens the form; clinic, dates, times, a physio with fee, someone new, confirm; a second confirm books nothing more; the booking on the staff calendar; a slot held by someone else refused, and one taken before confirming sends them back to the free times |

Without the test list check in `sendQueuedMessage`, the unit test "keeps a clinic message to a
number off the test list as Not sent" fails. Without the signature check in the webhook route, the
route test "refuses a wrong, missing or other body's signature" fails. Without the status check in
`confirmAppointment`, the database test "confirms a Booked appointment once ... a changed or
started one is not" fails. Without the Zero Gravity
Treadmill check in `selfRescheduleCheck`, the end to end test "the reminder's form refuses a Zero
Gravity Treadmill session" fails. Without the taken slot
handling in the booking Flow's confirm, the end to end test "a slot taken meanwhile sends the
person back to the next free times" fails. With the emergency check after the
typed-text route, the router test "come before anything else a typed message would get" fails.
