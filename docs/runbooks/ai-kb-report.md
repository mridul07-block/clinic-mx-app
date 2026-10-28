# Monthly knowledge base report (AI-08)

## Sources

- **Ticket AI-08:** "Often dismissed suggestions, missed diagnoses, changes at review; sent to the
  Super Admin".
- **PRD section 6, learning loop:**
  - "Monthly report to the Super Admin: suggestions often dismissed, diagnoses the AI missed,
    diagnoses changed at review. Knowledge base edits go live only as a new version he approves."
  - "The learning label is the diagnosis confirmed at review or discharge, not the first
    impression."
  - "Feedback never weakens safety: must rule out rows and red flag rules stay fixed."
- **TAD job table:** "Monthly knowledge base report | 1st of each month".

No document says what "often" means, how a miss is counted, when on the 1st it runs, or how it is
sent. Every choice below is a recommended default chosen under the user's standing approval, 29
October 2026 (DECISION AI-08 in `docs/PROGRESS.md`), for the client to confirm.

## Status: done

The reports start with October 2026's, built on 1 November. Until the AI gate is on (AI-09) and
consultants confirm diagnoses (AI-05), most counts are zero; every figure shows its denominator.

## What it counts (`packages/schemas/src/kb-report.ts`, `packages/db/src/kb-report.ts`)

Counts only, never a model call, over one IST calendar month (`istMonthBounds`: from the 1st at
midnight IST to the next 1st). Each thing counts in the month it happened.

- **Suggestions often dismissed:**
  - Each (sheet, condition) once, at its latest Keep or Dismiss, so a condition shown again at a
    recheck counts once; counted in the month of that Keep or Dismiss.
  - Never marked is never dismissed: those are a separate total ("Suggestions never marked", on the
    month's sheets).
  - Often dismissed: kept or dismissed at least `ai.kb_report_dismissed_min_marked` (5) times, and
    dismissed at least `ai.kb_report_dismissed_share_percent` (50%) of those times. Both are
    placeholders for the client. By knowledge base version and condition, most dismissed first.
- **Diagnoses the assistant missed:**
  - The label: each episode's latest confirmed diagnosis (AI-05), counted in the month it was
    confirmed.
  - Compared only against a ranked preparation sheet on the same knowledge base version (condition
    IDs are not promised across versions); the others are counted as not compared (no ranked sheet,
    or another version).
  - Missed: not among the first ranking's top suggestions (`ai.sheet_top_count`), the sheet as
    prepared before the examination. Each miss says how near it came: under Also consider, on the
    shortlist but not suggested, or not on the shortlist; and whether the latest Recheck with
    findings had it in its top.
  - The headline: right diagnosis in the top N, as a percent of the labels compared, with the count.
    N is the compared sheets' own top size, as each was made; when they differ (the setting changed
    in the month) it says "the top suggestions".
- **Diagnoses changed at review:** labels confirmed as another condition than the consultation's
  signed diagnosis, by from, to and stage (At review or At discharge).
- **What it holds:** counts and the knowledge base's own condition names and IDs, never a patient,
  episode, sheet or staff ID (`kbReportBodySchema` is strict). It also keeps the thresholds and the
  knowledge base versions it was built with.

## When and how it is sent

- **Job:** `ai.kb_report`, key `ai.kb_report:<month>`, on the 1st of the next month at 01:00 IST
  (`KB_REPORT_TIME`, DECISION AI-08). It first queues the next month's run in its own transaction,
  so a failed month never breaks the chain; a chain behind after downtime catches up one month at a
  time. A migration queued the first month (the month it ran in). Five failures raise the usual
  `job.failed` task.
- **Kept as built:** `kb_report` (one row per month; the month's report is never rebuilt). A
  trigger refuses any change or delete, even by the server; nobody signed in writes one; audited.
- **Sent:** with the report, in the same transaction, one task for the Super Admin (`ai.kb_report`,
  "Knowledge base report for Oct 2026"), with "Open the report" (Velyx support, who also sees Super
  Admin tasks, is told the Super Admin reads it). There is no email or WhatsApp yet
  (no domain, WA-* blocked); the task is the delivery. Closing it with a decision is the record that
  it was read.

## Who reads it

- The Super Admin, who approves knowledge base versions (`knowledge_base.edit`), never Velyx
  support: `/app/knowledge-base` lists the reports, newest first, with the headline, and
  `/app/knowledge-base/reports/<month>` shows one. Row level security (`kb_report_read`) allows the
  same, so nobody else reads one even through the database.
- Others who read the knowledge base see what the report is for, and no list; a report's address
  is not found for them.
- The page ends with the PRD's own words: edits go live only as a new version the Super Admin
  approves, and must rule out rows and red flag rules stay fixed.

## Tests

- `packages/schemas/src/kb-report.test.ts`: the IST month edges, the next run (December to
  January), the title; often dismissed at each threshold; each grade of miss, the version rule and
  changes; the strict body refuses an ID or name.
- `apps/web/modules/ai/kb-report.test.ts`: next month queued first, nothing built before the month
  ends, a failed build keeps the chain, built once; read by the Super Admin only, never support.
- `packages/db/src/integration/kb-report.integration.test.ts`: on generated March 2031 data, the
  dispositions once each and at both IST edges, never marked not dismissed, each grade of miss and
  found at recheck, a change, a sheetless label, an April label left out; one report and one task,
  never changed even by the server, read by the Super Admin and nobody else, written by nobody
  signed in. Dropping the month's end from the dispositions fails this test.
- `apps/web/e2e/kb-report.spec.ts`, at 360 px and on desktop: the Super Admin opens the report
  from its task and finds it under Knowledge base; a consultant sees no list and the address is not
  found.

## Later

- The Overview's "AI's right diagnosis in its top 3 by month" (DSH-05) can read these reports.
- A CSV of a report, and email delivery once there is a domain.
