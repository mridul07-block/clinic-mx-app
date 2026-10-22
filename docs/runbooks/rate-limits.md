# Rate limits

IAM-11, TAD section 8: limits on sign in, the patient link pages and webhooks.

Every Supabase Auth call comes from our server (rule 9), so Supabase's own per-IP limits treat all
clinic staff as one client. Without our own limits, one person guessing passwords could use up
that allowance and lock everyone out. Our limits, per email, per login and per network, stop the
guessing first.

Cloudflare's firewall and bot protection go in front later (FND-09). These limits stay as the
layer behind it.

## The limits (user decision, 22 October 2026: the balanced set)

Each is a setting `{ count, minutes }` that the Super Admin can change (rule 6).

| Setting | Limit | What counts |
| --- | --- | --- |
| `limits.sign_in_per_email` | 5 per 15 min | Failed sign ins for that email |
| `limits.sign_in_per_network` | 30 per 15 min | Failed sign ins from that network |
| `limits.reset_email_per_email` | 3 per 60 min | Reset emails asked for that email |
| `limits.reset_email_per_network` | 20 per 60 min | Reset emails asked from that network |
| `limits.two_step_per_person` | 5 per 15 min | Wrong two-step codes for one login: at sign in, at setup, and when resetting a password |
| `limits.bad_links_per_network` | 20 per 10 min | Patient links that are not valid, opened from that network; also a kiosk cookie that names no tablet |
| `limits.link_opens_per_network` | 120 per 1 min | Every patient link opened from that network |
| `limits.webhook_failures_per_network` | 10 per 1 min | Webhook calls with a wrong secret (the job tick now; WhatsApp and Razorpay reuse it) |

- **Sign in counts failed attempts only** (user decision): a correct sign in clears that email's
  count. A wrong two-step code works the same way.
- **A network is one IP address.** A clinic's Wi-Fi is one network, so the network limits are set
  high enough for every staff member and patient there.

## Where they apply

| Where | Before | After |
| --- | --- | --- |
| `signIn` (`modules/auth/actions.ts`) | Refuses while the email or network is at its limit, before Supabase is asked | A wrong password, or a login with no active staff member, counts against both. Success clears the email. |
| `requestPasswordReset` | Every request counts, per email and network; over the limit no email goes | The same answer whether or not the email has an account |
| `verifyTwoStep`, `finishTwoStepSetup`, `resetPassword` with a code | Refuses while the login is at its limit | A wrong code counts; a right one clears |
| `/p/[token]` | Over the network's bad links or opens, the page says "Too many tries. Please wait a few minutes and try again." and checks nothing | A link that is not valid counts as a bad link |
| `/kiosk/state` | Nothing | A cookie that names no tablet counts as a bad link; a real tablet's polling costs nothing |
| `/api/jobs/tick` | Over the limit: 429 with `Retry-After`, before the secret is checked | A wrong secret counts |

**Messages:**

- staff see "Too many attempts. Try again in N minutes.";
- patients see the plain wording above, with nothing alarming.

## The network address

`requestAddress` (`apps/web/lib/network.ts`) reads `x-real-ip`. Vercel sets it, and a browser
cannot change it. Elsewhere it falls back to the first `x-forwarded-for` entry; without either,
the key is `unknown`. The audit trail's `clientIp` uses the same reader, so a forged header hides
no address there either.

## Storage

- **Table:** `rate_limit` holds one row per bucket, key and fixed window, with a hit count.
  - Counting is a single upsert, so it holds when attempts arrive at the same moment.
  - A fixed window can let up to twice the count through across a window boundary. That is
    acceptable at these numbers.
- **Keys:** the table keeps only `sha256(bucket:identifier)`, never the email, address or login.
- **Server only:**
  - RLS is on with no policy;
  - writes go only through `modules/rate-limits` on the owner connection;
  - there is no audit trigger, since a counter per attempt would bury the real events (like
    `job`);
  - both catalog tests list the table as exempt, with that reason.
- **Pruning:** the hourly pg_cron job `rate-limit-prune` (`internal.prune_rate_limits()`) deletes
  windows older than a day.

## Unlocking someone now

A limit ends by itself when its window ends. To clear one sooner, delete that key's rows on the
database (Super Admin with database access):

```sql
-- One email's failed sign ins. The key is sha256 of 'bucket:identifier'.
delete from public.rate_limit
where bucket = 'sign_in_per_email'
  and key_hash = encode(sha256(convert_to('sign_in_per_email:' || lower('name@example.com'), 'UTF8')), 'hex');
```

Emails are lowercased before they are counted (the sign-in schema lowercases them).

**For a network:** use its bucket, for example `sign_in_per_network:203.0.113.7`.

**Two-step codes:** the identifier is the staff member's id.

## Checking it

| Test | What it covers |
| --- | --- |
| `apps/web/modules/rate-limits/limits.test.ts` | Settings, windows, check, count, take, clear, retry time, the network address |
| `apps/web/app/api/jobs/tick/route.test.ts` | 429 over the limit before the secret is checked, wrong secrets counted, the right one runs |
| `packages/db/src/integration/rate-limits.integration.test.ts` | Windows, 20 at once count 20, hash only, clear, prune, the hourly job |
| `apps/web/e2e/rate-limits.spec.ts` | 360 px and desktop, each test from its own network: the 6th sign in refused; a colleague still signs in; clearing unlocks; success clears; 20 bad links then wait, another network fine; the 4th reset email refused; 10 wrong tick secrets then 429 |

End-to-end global setup clears the test database's counters before each run. Otherwise runs close
together would add up to a limit, for example the shared accounts' reset email tests.
