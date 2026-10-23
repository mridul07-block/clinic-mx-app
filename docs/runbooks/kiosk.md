# Kiosk tablets

IAM-10, PRD J2.2 and J4.4, Frontend Specification section 7. Each centre has a shared tablet.
Patients fill their health form or consent on it when they cannot use their own phone.

The tablet has no staff login (PRD: no shared accounts). It:

- shows only the patient form the front desk sent to it;
- goes back to its welcome screen after a submit, or after 2 minutes with nobody touching it.

## Decisions (user, 22 October 2026)

- **Hand-off.** A tablet is set up once as its centre's kiosk. "Open on tablet" (the check in
  drawer, INT-02) sends a patient's form to it, and the tablet opens it within a few seconds.
- **Who.** Anyone with check in rights (`check_in.manage`: Super Admin, Centre Manager, Front Desk)
  sets tablets up and stops them, in their own centres.
- **Timers are settings:**

  | Setting | Value | What |
  | --- | --- | --- |
  | `kiosk.idle_seconds` | 120 | A form nobody touches goes back to the welcome screen (Frontend Specification) |
  | `kiosk.thank_you_seconds` | 10 | How long the thank you screen stays after a submit |

## Setting a tablet up

1. On the tablet, a staff member with check in rights signs in and opens **Kiosk tablets** from
   home (`/app/kiosk-tablets`).
2. They name the tablet ("Front desk tablet" by default) and, if they work in more than one
   centre, choose its centre.
3. **Set up as kiosk and sign out**. Three things happen:
   - the staff member is signed out (logged as a sign out);
   - the browser gets the cookie `clinic_kiosk`;
   - the welcome screen opens.
4. Lock the device to the browser:
   - **iPad:** Guided Access.
   - **Android:** screen pinning, with the browser full screen.

   A web page cannot stop someone leaving the browser; the app locks what the browser shows.

### The credential

- The cookie holds 32 random bytes:
  - httpOnly and secure;
  - `sameSite=lax`;
  - 400 days.
- **What the database keeps.** `kiosk_device.token_hash` holds only its sha256, so a copy of the
  database cannot act as a tablet.
- **How the tablet is found.** By that hash, on the owner connection (`modules/kiosk/device.ts`),
  the way a patient link is opened.

## What the tablet shows

| Where | What |
| --- | --- |
| `/kiosk`, a working tablet | The gold mark, "Welcome to Movementology Clinics", the centre, "The front desk will open your form here." It asks `GET /kiosk/state` every 3 seconds (a constant: how the app works, not a business rule). |
| A form was sent | The tablet replaces the welcome screen with `/p/<token>`. The token is signed again from the link row; signing is deterministic, so it is the patient's own link. |
| The form, open | The idle timer restarts on every touch, key, scroll or input. After `kiosk.idle_seconds` the tablet resets. |
| Sent, expired or not valid | "Thank you. Your form has been sent. Please hand the tablet back to the front desk." (or "We could not open this form"). After `kiosk.thank_you_seconds` the tablet resets. A submitted form lands on its link page, now used, so the form tickets need nothing extra. |
| Stopped tablet, or a cookie naming none | "This tablet is no longer a kiosk", with a staff sign in link. Asking `/kiosk/state` removes the cookie. |

**A reset** (`resetKioskAction`, then the welcome screen replaces the page, so Back cannot bring
the form back):

- It takes the form off the tablet only while that form is still on it, so a form sent a moment
  later stays.
- It is audited as `system:kiosk.<tablet id>`.

`/kiosk` and `/kiosk/state` send the same headers as `/p`: `same-origin`, `no-store`, `noindex`.

## The lock

With the cookie present:

- **`proxy.ts`** sends `/` and every `/app` page to `/kiosk`.
- **`/p/[token]`** opens only the form currently on this tablet. Any other link, even a working
  one, goes to `/kiosk`. So a form that was reset cannot be reopened on the tablet; it still opens
  on the patient's own phone.

To use the tablet as a normal browser again:

1. Stop it from another device: **Kiosk tablets**, then **Stop kiosk**, then confirm.
2. Within a few seconds the tablet says it is no longer a kiosk.
3. Its cookie is removed, and staff can sign in on it.

## Sending a form (`sendToKiosk`, `apps/web/modules/kiosk/services.ts`)

A `staffService` on `check_in.manage`, for the tablet's centre. INT-02 calls it with
`{kioskId, linkId}`.

The check in drawer (INT-02) sends the health form with `openFormOnTablet`
(`apps/web/modules/front-desk/services.ts`), which also checks the tablet is at the
appointment's centre and calls `sendLinkToKiosk` in the same transaction.

It refuses, in plain words:

- a stopped tablet;
- a link that has expired, was stopped, or was already sent;
- My plan. Only the single use forms (health form, consent, questionnaire, feedback) open on a
  shared tablet; My plan is personal and lasts weeks.

Sending replaces whatever the tablet showed.

**Reading the link's state.** Staff have no policy on `patient_link`, so
`internal.patient_link_state(link_id)`, a SECURITY DEFINER function, tells someone with check in
rights only the link's purpose and state.

## The table

`kiosk_device`:

- **Columns:** `centre_id`, `name`, `token_hash`, `created_by`, `stopped_at`, `stopped_by`,
  `current_link_id`, `current_since`.
- **Checks:**
  - a stopped tablet holds no form;
  - the hash is 64 hex characters;
  - the name is 1 to 60 characters.
- **Audited:**
  - set up is an insert;
  - send, reset and stop are updates.
- **Row level security:**
  - check in rights, in centres the person sees;
  - inserted only as oneself;
  - support read only (`docs/runbooks/row-level-security.md`).

## Checking it

| Test | What it covers |
| --- | --- |
| `packages/schemas/src/kiosk.test.ts` | Kiosk purposes, settings, inputs, the state the tablet reads |
| `apps/web/modules/kiosk/services.test.ts` | Set up, send and stop permissions and refusals; reset as the tablet |
| `apps/web/modules/kiosk/device.test.ts` | The cookie: missing, unknown, stopped, working; waiting or open |
| `packages/db/src/integration/kiosk.integration.test.ts` | Hash only, audit actors, the reset race, RLS per role, support read only, link state |
| `apps/web/e2e/kiosk.spec.ts` | 360 px and desktop, on Playwright's clock: set up and lock; a link not sent stays out; the idle reset at 120 s (untouched, and 2 minutes after a touch); thank you then reset at 10 s; stop from another browser; no supabase requests |

The tablet page marks its state in `data-kiosk`: `starting`, then `armed` once its timer runs,
then `resetting`. The end to end tests count time from `armed`; on a slow phone run the page shows
before its script starts.
