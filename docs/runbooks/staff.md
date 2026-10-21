# Staff management

IAM-06, PRD M16. The Super Admin manages staff at `/app/staff` (the "Staff" link on home). It
needs `staff.manage` in the permission map (IAM-04). Everything runs as the Super Admin under row
level security (IAM-05), and every change is audited with them as the actor.

## What the Super Admin can do

- **Invite** (`/app/staff/new`): enter the email, name, role, ticks, centres and an optional
  access end date, then "Send invite".
  - A physiotherapist always treats patients, and the Consultant tick needs Treats patients
    (decision G5). The database checks this too.
  - Every role except Super Admin and Finance needs at least one centre. Those two see all centres.
  - The access end date is the last day they can sign in. Access ends at midnight IST after it
    (stored in UTC).
- **Change** role, ticks, centres and end date on the person's page. The change reaches their token
  on their next page (IAM-03).
  - The email is their login and is not changed here.
  - Super Admins cannot change their own role.
- **Deactivate** stops them signing in and ends their session on their next page.
  - Their rows and signed records stay attributed to them.
  - "Reactivate" undoes it, so it asks for no confirmation (the Frontend Specification keeps
    dialogs for what cannot be undone).
  - Nobody can delete a staff member, not even through the database (no delete policy).
  - Super Admins cannot deactivate themselves.
- **Reset two step verification** when someone loses or replaces their phone. Their next sign in
  asks them to set it up again (IAM-02, audited `two_step_reset`).

## Invites

Decision 22 October 2026: an email, plus a link to send another way.

- **The email:** Supabase Auth sends it from our template, `supabase/templates/invite.html`
  (subject "You're invited to Clinic Mx").
  - It links to `<site URL>/app/reset-password?token_hash=…&type=invite` on our domain (rule 9).
  - The page there says "Set your password". The token is used only when the form is sent.
  - The link works once, for one hour (the email link expiry).
  - Afterwards the person signs in, and roles that need two step verification set it up.
- **Send invite again** sends a new email. A new link replaces the old one.
- **Copy invite link** makes a new link to send another way, for example WhatsApp or in person.
  - It replaces the link in the email, works once, and is shown only once. It is never stored.
- **If the email cannot be sent,** the person is still added. The screen says the email was not
  sent and shows a link to share instead. This is always the case on staging until the Resend
  sender (G9) is set up.
- **"Invite sent" status:** a person shows this until their email is confirmed, which happens when
  they use the link. After that, a forgotten password goes through "Forgot password?".
- **Audit:** invites sent and links made are recorded as `staff_invited` and
  `invite_link_created`, through `internal.record_access_event`. That function writes with the
  transaction's own actor, so an event cannot be recorded as anyone else.

## Per environment

- **Server:** `SUPABASE_SERVICE_ROLE_KEY` is needed for invites, the invite status and two step
  resets. On Vercel it is in Production and Preview, server only, never `NEXT_PUBLIC_`.
- **Local:** `supabase/config.toml` sets `[auth.email.template.invite]`, and Mailpit catches the
  email (http://127.0.0.1:54324). Restart the stack after changing the template.
- **Hosted projects:** Authentication, Emails, Invite user. Set the subject above and the body
  from `invite.html`. On the free plan this needs the custom SMTP sender first (Resend, G9), the
  same as the reset template. Until then use "Copy invite link".

## Tests

- Unit (`apps/web/modules/staff/services.test.ts`):
  - inviting, with the email and without it;
  - a taken email is refused;
  - the self-protection rules;
  - deactivate and reactivate;
  - links and the two step reset;
  - every other role is refused.
- Database (`packages/db/src/integration/staff.integration.test.ts`):
  - as the Super Admin under RLS: add, change, deactivate, list, audited as them;
  - access events only with the transaction's actor;
  - a Centre Manager is refused by RLS.
- End to end (`e2e/staff-management.spec.ts`, 360 px and desktop, one Super Admin per project):
  - an invite by email (Mailpit) and by copied link, set a password and sign in;
  - a second centre and an end date reach their account page;
  - deactivating signs them out, and their row stays;
  - the form rules;
  - Front Desk is refused.
