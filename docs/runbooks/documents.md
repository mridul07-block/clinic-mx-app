# Documents (PDFs)

ALT-05, the framework every patient document is built on: the consultation summary (ALT-06), the
referral letter (ALT-07, CLN-11), the invoice and receipt (BIL-09) and the discharge report
(OUT-11). TAD section 9, Frontend Specification section 11, rule 9 (the browser never calls
`*.supabase.co`), rule 10 (access is enforced twice).

## The path of a document

| Step | Where | What happens |
| --- | --- | --- |
| **1. Built** | The ticket's own template | A React element: `LetterheadDocument` with the document's sections, from the signed record. |
| **2. Numbered** | `nextDocumentVersion` | The next version of this document, by its kind and the record it is built from (`source_id`): 1 the first time, then one after the latest. |
| **3. Rendered** | `modules/documents/render.ts` | `@react-pdf/renderer` on the server, IBM Plex embedded, the version in the footer. |
| **4. Stored** | `document-store.ts` | Our server writes the PDF to the private `documents` bucket as `<patient id>/<document id>.pdf`, with the service role. No browser ever reaches the bucket. |
| **5. Recorded** | `document` | One row per version, written by the system (audited). If the row is not written, the file is removed. A version is never overwritten: regenerating after an addendum adds the next one. |
| **6. Opened** | `/app/documents/<id>` | For those who read its kind (below), from our domain: `inline`, named like `consultation-summary-v2.pdf`, `private, no-store`, `nosniff`. Each open is logged as a view. |

## Generating one (for ALT-06 and the tickets after it)

Call `generateDocument` from `apps/web/modules/documents/services.ts` inside the system's own
transaction (`withActor(db, systemActor('…'), tx => …)`, usually a job):

```ts
await generateDocument(tx, {
  kind: 'consultation_summary',
  patientId,
  episodeId,
  centreId, // whose letterhead it is printed on
  sourceId: consultationId, // its versions share this
  build: ({ version, generatedAt }) => (
    <LetterheadDocument
      title="Consultation summary"
      centre={centre}
      versionLabel={`Version ${version}`}
      generatedAt={generatedAt}
    >
      <Section heading="Patient details">…</Section>
      <SignOff name={…} credentials={…} signedAt={…} />
    </LetterheadDocument>
  ),
});
```

The building blocks in `letterhead.tsx`: `Section` (with `breakBefore` for a new page),
`Paragraph`, `Fields` (label and value rows), `Mono` (OP and bill numbers), `Table` (hairlines,
rupee amounts and counts with `align: 'end'`; rows never split across pages) and `SignOff`. Money
is `formatRupees` (₹1,20,000); counts `indianNumber`; dates and times `documentDate`,
`documentTime`, `documentDateTime` ("28 Sep 2026, 4:05 PM", IST, with the month names written out).

If the transaction that generated a document is rolled back after the file was stored, the file
stays in the bucket without a row; nobody can open it, and the backups keep it like any other file.

## The letterhead (user decisions, 25 October 2026)

- The centre's own: the logo top left; "Movementology Clinics", the centre's name, address and
  phone top right, read live from Settings › Centres. A centre without an address or phone yet
  simply leaves that line out (Whitefield has no address in the seed).
- A thin gold rule under the header, decorative only. Everything else reads in black and white;
  status is written in words.
- A4, 18 mm margins; IBM Plex Sans 10.5 pt (titles 14 pt, weights 400, 500 and 600) and Plex Mono,
  both embedded from `modules/documents/fonts/` (static WOFF files from IBM's `@ibm/plex-sans` and
  `@ibm/plex-mono` 1.1.0, SIL Open Font License in `OFL.txt`). Plex's figures are tabular, and
  every font has the ₹ glyph. `next.config.ts` ships the fonts with the functions that render
  (`outputFileTracingIncludes`); a new route that renders needs adding there.
- The footer: the version, "Generated" with the date and time, "Movementology Clinics", and
  "Page n of N".
- The sign off: the clinician's name, their credentials (Settings › Staff › Credentials, set by the
  Super Admin) and "Digitally signed" with the date and time. The signature image, legal and
  registration details and the official logo files wait for the clinic (DECISION ALT-05).
- The logo is drawn from `public/brand/movementology-logo.svg` as vector paths
  (`logo-paths.ts`, generated; regenerate it if the logo file changes).

The Super Admin checks it with **Preview letterhead (PDF)** on each centre's page: a two page
sample on that centre's details, "Test Patient 0000", sample amounts. It is rendered on each
request and never stored.

react-pdf traps found while building it: a `lineHeight` on the page drops the fixed footer, and a
unitless `lineHeight` is read against the font size in the same style (not an inherited one), so
each text style carries `fontSize` and `lineHeight` together.

## Who opens what

| Kind | Who | Where |
| --- | --- | --- |
| Consultation summary, referral letter, discharge report | Clinicians (`clinical.read`: the Super Admin, staff with the Treats patients tick; never Velyx support) | At any centre, like the signed records they come from |
| Invoice and receipt | Those who see bill amounts (`bills.view_amounts`): the Super Admin, Finance, and the Front Desk | The Front Desk at the document's centre |

Anyone else gets "not found", and the patient record's Documents tab (clinicians only) does not list
it. Patients get their documents with the WhatsApp tickets.

## Where it is enforced

- **Server:** `documentsOfPatient` and `documentFile` return nothing to anyone who opens no kind of
  document; row level security does the rest.
- **Database** (`20261024211003_documents_rules.sql`): `internal.reads_document(kind, centre)`
  decides who reads a row; nobody signed in inserts, updates or deletes one (no policy; Velyx
  support's restrictive policies too); `file_path` is not granted, and only
  `internal.document_file` gives it, to a reader; `internal.document_view` logs an open as the
  transaction's own staff member, and only by a reader. A support login's transaction is read only,
  so its opens are logged by the proxy (IAM-08) instead.
- **Tests:** `packages/db/src/integration/documents.integration.test.ts` (each role and centre,
  the path, writes refused, versions, views), `apps/web/modules/documents/*.test.ts*` (rendering:
  A4, two pages, Plex Sans and Mono embedded; generating and opening), `apps/web/e2e/documents.spec.ts`
  (the preview, credentials, the Documents tab and opening each version at 360 px and desktop).

## Checking a PDF by eye

The PDF's text is compressed, so tests read only its structure. To look at a page, render the
preview from the centre page, or write `LetterheadSample` to a file from a throwaway test and turn
its pages into images (PyMuPDF: `fitz.open(path)[0].get_pixmap(dpi=110).save('p1.png')`).
