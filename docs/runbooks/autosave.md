# Autosave and offline drafts

FND-08. Every clinical field autosaves, and an edit survives a reload, a dropped connection or a
locked phone (PRD section 8, Frontend Specification principle 8).

## What staff see

- "Saving", then "Saved", quiet beside the section title. "Saved on this device" while offline,
  "Not saved yet" while the server cannot be reached.
- Offline, a slim bar at the top of the staff app: "Offline, changes will sync".
- If the record changed on another device meanwhile, nothing is overwritten. A notice asks them to
  choose: "Keep my version" or "Use the saved version" (decision of 21 October 2026).

## How it works

1. Every change is written to IndexedDB (`clinic-mx-drafts`) at once.
2. After 800 ms without typing, the draft is sent with the version it started from.
3. The server saves only if the record is still at that version (`updateVersioned` in
   `packages/db`), and answers `saved` with the new version, or `conflict` with what is saved.
4. Offline, or if the server cannot be reached, the draft waits on the device. It is sent when the
   connection returns (the `online` event) and whenever the staff app opens, including drafts
   whose screen was closed (`DraftSync` in the staff layout).
5. On a conflict the draft keeps both versions until the person chooses, even across a reload.

Drafts are kept per staff member (`scope`). Until IAM-01 every draft belongs to `local`; IAM-01
must pass the signed in staff member's id from `useDraftScope()` and call `clearDrafts(scope)` on
sign out, so a shared front desk tablet never shows another person's draft.

## Making a screen autosave

1. **Table:** give it `version integer not null default 1` (new tables), or add it in a new
   migration (existing tables: nullable first, or with the default, per rule 18).
2. **Schema:** describe the edited value in `packages/schemas`, then use
   `draftSaveRequestSchema(value)` and `draftSaveResponseSchema(value)`.
3. **Endpoint:** `PUT` with `{ value, baseVersion }`. In the module service (rule 17: permission,
   validate, transaction, audit) call `updateVersioned(tx, table, id, baseVersion, values)`. Answer
   200 with `{ status: 'saved', version }`, or 409 with `{ status: 'conflict', version, value }`.
   Signed records refuse every save: changes are addenda (rule 5).
4. **Saver:** `jsonSaver((id) => url, valueSchema)` in `apps/web/lib/drafts/savers.ts`, and add the
   kind to `draftSavers` so drafts of closed screens are saved too.
5. **Screen:** `useAutosave({ kind, id, serverValue, serverVersion, save })` gives `value`,
   `setValue`, `status`, `keepMine` and `takeSaved`. Show `<SaveStatus status={status} />` beside
   the section title and `<ConflictNotice />` when `status === 'conflict'`. Before signing, await
   the controller's `settled()` so the last edit is saved first.

## Tests

- Unit (`apps/web/lib/drafts/controller.test.ts`): debounce, reload, offline, retry, both conflict
  choices, edits during a save, closed screens, per person scope.
- Database (`packages/db/src/integration/versioned.integration.test.ts`, CI Supabase job): version
  bump, stale version, two simultaneous saves.
- End to end (`apps/web/e2e/autosave.spec.ts`, 360 px and desktop) against the test harness at
  `/app/test-harness/autosave`. The harness page and `/api/test-harness/*` answer 404 unless
  `CLINIC_MX_TEST_HARNESS=1`, which only the Playwright web server sets. Never set it on Vercel.

## Screens that autosave

- The consultation (CLN-02): kind `consultation`, one draft for all its sections, saved by
  `PUT /app/consultations/<id>/save`. See `docs/runbooks/consultation.md`.
