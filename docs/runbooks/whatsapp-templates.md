# WhatsApp templates

The registry of every WhatsApp template Clinic Mx sends (SET-11, TAD section 6): key, category,
variables, buttons and version. The Super Admin views it at `/app/templates` (`templates.manage`).

## Where it lives

`packages/schemas/src/message-templates.ts`, in code and typed (decision of 24 October 2026):

- `MessageTemplateKey` is the union of keys, so messaging code cannot name an unknown template.
- `TemplateVariables<K>` is the set of variables a template needs, so the messaging client (WA-01)
  cannot send one with a variable missing or extra.
- Messages record the key and the version they were sent with (TAD `message.template_key`).

## What is in it today

All 16 templates in the TAD list, in Meta's utility category, version 1, status Draft. Their
variables and buttons are drafted from what the PRD says each message carries, and each cites its
source (`source`). No wording is written in the registry: WA-06 writes the English text, gets it
reviewed (the safety advice after a red flag is clinically signed off) and submits it to Meta.

- Booking confirmation and the front desk booking confirmation carry the same content (WA-07); the
  TAD lists them as two templates.
- The follow up check is one template with a `period` variable, because the follow up intervals
  are a setting (PRD rules table), not four fixed messages.
- Buttons stay within Meta's limits: up to 3 quick replies, up to 2 links, at most one Flow button
  (checked by `message-templates.test.ts`).

## Changing a template

1. Change the entry in `message-templates.ts` and raise its `version`. Meta treats changed text as
   a new submission; an approved template keeps sending its approved text until the new version is
   approved (WA-06, WA-12).
2. Adding a template: a new entry with a new snake case key, a source, and version 1. Keep it
   transactional so Meta keeps it in the utility category (TAD section 6); marketing messages are
   out of scope.
3. Run `pnpm test` (the registry test) and update the e2e count in `apps/web/e2e/templates.spec.ts`.

## Checking it

| Test | What it checks |
| --- | --- |
| `packages/schemas/src/message-templates.test.ts` | Every TAD template once; snake case keys and variables, no duplicates; a source and version each; buttons within Meta's limits; `TemplateVariables` typed per key. |
| `apps/web/e2e/templates.spec.ts` | 360 px and desktop. The Super Admin opens WhatsApp templates from Home and sees 16 cards, with the booking confirmation's key, variables, version and Draft tag; the front desk and a physio are refused. |

Negative check: with a template removed from the registry, the registry test failed (SET-11).
