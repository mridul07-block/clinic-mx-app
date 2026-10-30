# Security review before the penetration test (OPS-06)

OPS-06: "Independent test done; high findings fixed before launch". This page is the internal
review that comes first: what was checked, what was found, what is left for the testers. It is
not the independent test.

## How it was done (31 October 2026)

Five static runs of the gstack `cso` audit, each limited to one area (`--paths`), reading the code
through the audit's own redacted reader. Static means no application was run and no scanner image
was available, so each run reports itself as **partial**. Run IDs, for the audit's saved reports:

| Run | Area |
| --- | --- |
| `1793393566805-929e5f701357658d` | Test harness, security headers, webhooks, cookies |
| `1793394811145-f28601993c3a7cdd` | Patient links, the clinic tablet, the proxy, rate limits |
| `1793395550961-2d7cde0828272bde` | `/api` routes, document, report, data request, finance and audit downloads, the access module |
| `1793395650698-ff0b3f97bd5fe689` | CSV exports, report uploads, exercise videos, intake |
| `1793395733942-23c7c2384731bde9` | Report file checks, the AI identifier guard, the audit log |

## What was found

No supported finding. One hardening gap, fixed: no response told browsers never to frame the site
or to keep to HTTPS. Every response now carries `X-Frame-Options: DENY`,
`Content-Security-Policy: frame-ancestors 'none'`, `Strict-Transport-Security: max-age=63072000;
includeSubDomains` and `X-Content-Type-Options: nosniff` (`apps/web/next.config.ts`; checked by
`apps/web/e2e/smoke.spec.ts`). No page of ours frames another, so nothing breaks.

## What each boundary does

| Boundary | What the code does |
| --- | --- |
| Patient links `/p/<token>` | Signature first (a forged token never reaches the database), then expiry, then the stored link: same purpose and expiry, not stopped, not already submitted; a valid open is audited. Bad tokens counted per network and refused over the limit. |
| Rate limit address | `x-real-ip`, which Vercel sets itself; a browser cannot change it. |
| Clinic tablet | Its cookie is looked up by hash; setting up, stopping or sending to a tablet needs `check_in.manage`; a reset works only from that tablet's own browser, on the form it shows. |
| Staff pages | The proxy sends anyone signed out to sign in (`/`, `/app`, `/app/*`). |
| `/api` routes | Outside the proxy, each checks for itself: the WhatsApp webhook and booking Flow by Meta's HMAC over the raw bytes, compared in constant time; the job tick and the monitoring drill by the jobs secret, compared in constant time, failures limited per network; the test harness is 404 unless `CLINIC_MX_TEST_HARNESS=1`; health shows only the commit, region and environment. |
| Downloads | Documents, reports, data request and finance exports, the audit log: signed in, then the service reads under the staff member's own row level security; refused answers are 404; views and downloads are audited. |
| Report uploads | JPEG, PNG or PDF only, checked against the file's first bytes; served with `nosniff`; an SVG or HTML upload is impossible. |
| CSV exports | A cell starting `=`, `+`, `-`, `@` or a tab gets a leading apostrophe, so a spreadsheet never runs it. |
| Session cookies | `httpOnly`, `secure`, `SameSite=lax`. |
| AI requests | Nothing with a UUID, email, OP or appointment number, a run of 7 or more digits, or the patient's own name words is sent; zero data retention on every request. |

## What is left for the testers

- **Not reviewed here:** dependency vulnerabilities (no scanner image was available), and the
  row level security policies line by line (each role is covered by database tests instead).
- **Worth their time:** the server actions behind the staff screens (each is a `staffService`
  with its permission, and Postgres refuses what a role may not do, but a tester should try
  crossing centres and roles); the patient link pages with tokens from other patients; uploads
  of crafted PDFs.
