# Monitoring

What watches Clinic Mx, how alerts reach the Velyx on call phone, and how patient data is kept out
of error reports (FND-12, TAD section 10). Decisions (user, 24 October 2026): Sentry (free Developer
plan, EU region) for errors; Better Stack (free) for uptime; alerts by email to the on call inbox,
which the phone's mail app notifies.

## What is watched

| What | How | Alerts when |
| --- | --- | --- |
| Server, edge and browser errors | Sentry, through `instrumentation.ts` and `instrumentation-client.ts` | A new issue, or a resolved one comes back |
| The app is up | Better Stack monitor on `GET /api/health`, every 3 minutes | It does not answer 200 |
| The job tick runs | Better Stack heartbeat: each tick calls `JOBS_TICK_HEARTBEAT_URL` after a run | No beat for 5 minutes (period 1 minute, grace 5) |
| The WhatsApp Flow endpoint | Added with the WhatsApp tickets, when the endpoint exists | |
| Spend | Nothing to watch on Vercel Hobby and Supabase Free; see `upgrade-to-production.md` | |

The heartbeat covers pg_cron, Vault's tick URL and secret, Vercel, the function and the database:
any of them stopping silences it. A failed beat never fails the tick.

## No patient data in error reports

Rule 12. Two layers:

1. **In the app** (`apps/web/lib/monitoring/scrub.ts`, shared by every runtime through
   `lib/monitoring/options.ts`), before anything leaves:
   - Errors only: no tracing, no session replay, no release health sessions (a session carries the
     user and skips `beforeSend`). `sendDefaultPii` is off.
   - Each event loses the user, extras, the request's cookies, headers, body and query, and frame
     local variables. Addresses keep the place only: no query or fragment, ids become `[id]`,
     tokens `[token]`, so a patient link is `/p/[token]`.
   - Error and message text loses quoted values, email addresses, phone numbers (10 or more
     digits), patient numbers, ids, tokens, Postgres `Key (...)=(...)` values and everything after
     a failed query's `params:`. The error's type and stack remain. A token is a run of 20 or more
     letters, digits, `-` and `_` holding a digit, or of 24 or more mixing upper and lower case (a
     random token may hold no digit: a test met one on 25 October 2026); long snake_case words
     stay.
   - Console breadcrumbs are dropped; request breadcrumbs keep only the scrubbed address, method and
     status.
   - A name in free text cannot be told from other words, so code never writes a patient's name
     into an error message; values reach errors quoted (Postgres, Drizzle) and are scrubbed there.
2. **In Sentry's project settings**: Data Scrubber and default scrubbers on, IP addresses not
   stored.

The browser sends reports to `/monitoring` on our own domain (`tunnelRoute` in `next.config.ts`),
which forwards them to Sentry; no page calls `sentry.io`.

## Setting up an environment

Once per environment (staging now, production at the upgrade):

1. **Sentry**: project `clinic-mx` (Next.js) in the EU region. In the project settings, Security
   and Privacy: Data Scrubber on, Use Default Scrubbers on, Prevent Storing of IP Addresses on.
   Alerts: "When a new issue is created, or an issue changes state from resolved to unresolved,
   send an email to the on call inbox."
2. **Vercel variables** (Production and Preview): `SENTRY_DSN` and `NEXT_PUBLIC_SENTRY_DSN` (the
   project's DSN; public by design), and for readable stacks `SENTRY_ORG`, `SENTRY_PROJECT` and
   `SENTRY_AUTH_TOKEN` (build only: source maps are uploaded, then removed from the deployment).
3. **Better Stack**: a monitor on `https://<app host>/api/health` (status 200, every 3 minutes), a
   heartbeat "Job tick" (period 1 minute, grace 5 minutes), and the on call email on both. Put the
   heartbeat's URL in Vercel as `JOBS_TICK_HEARTBEAT_URL` (Production only: previews share the
   staging database but run no tick).
4. Redeploy, then run the drill below.

## The drill

Proves an alert reaches the phone and the stored report holds no patient data:

```sh
curl -sX POST https://<app host>/api/monitoring/check -H "Authorization: Bearer $JOBS_SECRET"
```

It reports a `MonitoringCheckError` whose text carries freshly generated fake details (a quoted
name, a phone number, a patient number, an email address and a link token) and answers with the
event id and those details. Then:

- The on call phone gets Sentry's email for the new issue (the first time; resolve the issue
  afterwards so the next drill alerts again).
- In Sentry, the event (Issues, search `MonitoringCheckError`) shows none of the details; its text
  reads `Monitoring check for "[scrubbed]", phone [scrubbed], ...`.
- Better Stack: "Send test notification" on the monitor reaches the phone.

Run it after changing the scrubber, the Sentry SDK or the alert rule, and at each production
upgrade step.

## When an alert comes

- **Sentry issue**: open it; the stack and release (the commit) say where. Fix forward; resolve it
  once deployed.
- **App down**: `GET /api/health`; check Vercel's deployment status and the Vercel status page. A
  bad deploy is rolled back with Vercel's Instant Rollback.
- **Heartbeat missing**: follow "Setting up an environment" check 3 in `jobs.md` (cron runs, tick
  responses). A 401 means the Vault secret and `JOBS_SECRET` differ; a 503 means `DATABASE_URL` is
  missing; no runs means pg_cron or Vault.

## Checking it

| Test | What it checks |
| --- | --- |
| `apps/web/lib/monitoring/scrub.test.ts` | Each scrubbing rule with generated fake data, and a real Sentry client with the shared options sending to a recording transport: the report keeps the error and stack, never the planted details. |
| `apps/web/app/api/monitoring/check/route.test.ts` | The drill: refused without the secret, limited per network, reports fresh planted details. |
| `apps/web/app/api/jobs/tick/route.test.ts` | The tick beats after a run, never for a wrong secret, and still answers 200 when Better Stack is down. |
| `apps/web/e2e/monitoring.spec.ts` | 360 px and desktop. A browser error with planted details reaches `/monitoring` with none of them, and no page calls `sentry.io` or `supabase.co`; a page failing to render shows the error page. The end to end build has a stand-in browser DSN (organisation 0, refused by Sentry). |

Negative check: with `beforeSend` and `beforeBreadcrumb` removed, the recording transport test and
the end to end test both failed on the planted details (FND-12).
