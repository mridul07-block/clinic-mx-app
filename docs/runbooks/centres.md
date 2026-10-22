# Centres

SET-01, PRD M16, TAD section 3. Each centre has:

- a name;
- an address;
- a Google Maps link;
- a front desk phone;
- a chart colour.

Later tickets use these details:

| Detail | Where it is used |
| --- | --- |
| Address | Patients see it in WhatsApp messages; letterheads and receipts print it (Frontend Specification) |
| Map link | My plan's Map button; WhatsApp messages |
| Phone | Letterheads and receipts; the front desk number in WhatsApp when a phone cannot open Flows (PRD J1.10) |
| Colour | Marks the centre when charts compare centres |

## Decisions (user, 22 October 2026)

- **Who.** The Super Admin adds, edits, deactivates and reactivates centres (`centres.manage`). A
  centre is never deleted; it is kept for history.
- **Colours.** A centre's chart colour is one of the design system's reserved centre colours
  (Frontend Specification section 2.4):

  | Name | Token | Value |
  | --- | --- | --- |
  | Blue | `viz-centre-1` | `#2F74BB` |
  | Violet | `viz-centre-2` | `#7F5BB6` |
  | Teal | `viz-centre-3` | `#1C8580` |

  - **One active centre per colour.** The service and the database's partial unique index
    `centre_colour_active_key` both enforce it.
  - **With all three in use,** the screen says a new colour must be added to the design system
    before another centre can be active. To add one:
    1. add a `viz-centre-4` token in `packages/ui/src/styles/tokens.css`, checked for contrast;
    2. add it to `centreColours` in `packages/schemas/src/centres.ts`;
    3. add it to the swatch classes in `centres/centre-swatch.tsx`.

  The design check fails if the list and the tokens differ.

## Screens

| Path | What |
| --- | --- |
| `/app/centres` | Each centre: Active or Inactive, address, phone, whether the map link is set, the colour swatch with its name |
| `/app/centres/new` | Add a centre, with a colour no active centre uses. With none free, the page says so and shows no form. |
| `/app/centres/[centreId]` | Edit the details. Deactivate (after a confirm step) or reactivate. |

- **Colour choices.** A colour another active centre uses is shown "(used by …)" and cannot be
  chosen. An inactive centre may keep a used colour, but cannot be reactivated until it is changed
  to a free one.
- **Support logins** see the screens read only (IAM-08).

## Rules for the details (`packages/schemas/src/centres.ts`)

| Detail | Rule |
| --- | --- |
| Name | 1 to 60 characters; unique, ignoring case |
| Address | 1 to 300 characters |
| Phone | Any Indian number as typed (`98450 12345`, `+91 98450 12345`, `080 4123 4567`). It is stored as E.164 (`+919845012345`) and shown as `+91 98450 12345` or, for Bengaluru landlines, `+91 80 4123 4567`. `indianPhoneSchema` is shared for patients later. |
| Map link | https Google Maps only: `maps.app.goo.gl`, `goo.gl/maps`, `google.com/maps` and `maps.google.com`. Patients open it, so no other site is accepted. |
| Colour | One of the three above |

The seed adds the three centres and two addresses. The Whitefield address, the phones and the map
links are still to be entered by the Super Admin.

## Deactivating a centre

- **What stays:** its staff assignments, kiosk tablets and history.
- **What changes:**
  - it is no longer offered for new staff assignments or kiosk tablets;
  - its colour is freed.
- **Staff form:** a person still assigned to it sees it marked "(inactive)" on the staff form, so
  saving that form never drops the assignment silently.

## Under the hood

| Part | Where |
| --- | --- |
| Services, each a `staffService` on `centres.manage`: `addCentre`, `editCentre`, `setCentreActiveService` | `apps/web/modules/centres/services.ts` |
| Database functions | `packages/db/src/centres.ts` |
| Row level security (from IAM-05): everyone reads the centres they see; only the Super Admin inserts or updates; support is read only | `docs/runbooks/row-level-security.md` |
| Audit: every change by the trigger | `docs/runbooks/audit.md` |

## Checking it

| Test | What it covers |
| --- | --- |
| `packages/schemas/src/centres.test.ts` | Phones as typed and formatted, map links, colours, required details |
| `apps/web/modules/centres/services.test.ts` | Super Admin only, support read only, colour in use, all colours in use, name in use, an inactive centre keeping a used colour, reactivation |
| `packages/db/src/integration/centres.integration.test.ts` | The unique index, freeing a colour, RLS, audit (each test rolled back) |
| `apps/web/e2e/centres.spec.ts` | 360 px and desktop. **Edit:** with field errors. **No free colour.** **Lifecycle:** deactivate Whitefield, add a test centre in teal, refused reactivation, then reactivation. **Access:** Front Desk refused. Tests take turns (`e2e centres` lock) and restore every centre. |
