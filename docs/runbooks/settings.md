# Settings

FND-14, rule 6, TAD section 3. Every business rule the Super Admin can change (PRD section 7,
rows marked Setting) is a row in the `setting` table. Code never holds the number.

## Reading a setting

Server code calls the one cached accessor:

```ts
import { getSetting } from '../modules/settings/settings';

const lateAfter = await getSetting('day.running_late_minutes'); // number, typed by the registry
```

Each server instance loads the whole table at once and keeps it for `SETTINGS_CACHE_SECONDS`
(60 s). A change made on the same instance shows at once (`invalidateSettings()`); other
instances see it within 60 s. If any setting is missing or malformed, every read fails with a
`SettingsError` naming it, rather than running a rule on a wrong value.

The cache loads on its own connection (`settingsDb()` in `apps/web/lib/db.ts`), not the app's.
The app has one connection per server instance, so a load on it during an open service
transaction would wait for that transaction while the transaction waits for the setting: the save
never finishes (seen on staging in SET-03). With its own connection, `getSetting` is safe anywhere,
including inside a transaction (patient links read their lifetime there).

Outside the web app (jobs, scripts, tests) build a reader over a database client:
`createSettingsReader(() => readSettingRows(db))` from `@clinic-mx/db`.

## Adding a setting

1. Add the key to `settingDefinitions` in `packages/schemas/src/settings.ts`: its value schema,
   its source (`PRD section 7: <Rule>` for a PRD row, otherwise the TAD line or decision) and a
   description saying the unit.
2. Insert its value in a new custom migration (`pnpm --filter @clinic-mx/db exec drizzle-kit
   generate --custom --name <name>`), as in `20261021150022_settings_values.sql`: set
   `audit.actor` to `system:migration`, insert with `ON CONFLICT (key) DO NOTHING`, clear the actor.
3. An open PRD decision gets a `-- DECISION #n` comment beside its value and a line in the DECISION
   register in `docs/PROGRESS.md`.
4. The settings screen offers it to the Super Admin at once. If other records or a guarantee rely
   on it, or it has its own page, add it to `settingChangedElsewhere`; if it must stay at or under
   another setting, add the pair to `settingOrderPairs` (a `*_min` and `*_max` pair is found on its
   own).

CI checks both halves: a unit test fails if a PRD section 7 Setting row has no key (or a key cites
a fixed rule), and a database test fails if a key has no valid row after migrations.

Keys are global. Values per centre, per physio or per appointment type belong on those records
(SET-01, SET-03), with the global setting as the default where the PRD gives one.

Two PRD section 7 Setting rows live on records instead of keys (SET-03): "Consultation length" and
"Session length" are the lengths of the Consultation and Session appointment types, and a physio's
own lengths (`docs/runbooks/appointment-types.md`). The Super Admin still changes them without a
release. `recordRules` in `packages/schemas/src/settings.ts` lists them, so the PRD test counts
them as covered. The global `scheduling.consultation_minutes` and `scheduling.session_minutes`
were retired by migration `20261022082157_appointment_type_rules.sql`.

## Changing a setting

`updateSetting(db, actor, key, value)` validates the value, stores who changed it and is audited
with the value before and after. The table is unreadable through the Supabase API roles but for
the Super Admin's; everything goes through the server.

## The settings screen

ADM-02, `/app/settings` (PRD M16, section 7), from Home's **Settings** and the Super Admin's phone
tab. Every choice below is a recommended default chosen under the user's standing approval, 29
October 2026 (DECISION ADM-02), for the client to confirm.

- **Who:** the Super Admin (`settings.manage`); Velyx support reads it, read only; nobody else.
- **What it shows:** every key in the registry, by area (its prefix, `settingsByArea`), each with
  its description, its source, its value now, and when and by whom it last changed.
- **Changing one:** **Change**, the new value, **Save**. The field follows the schema
  (`settingInputKind` in `packages/schemas/src/settings-screen.ts`): numbers (digits, a sign and
  decimals only; the full keyboard where the value may be negative), yes or no, a choice, short
  text, or JSON for lists and objects. Money in paise also shows in rupees. The registry's schema
  checks it (`parseSettingField`), and pairs stay in order (`settingOrderPairs`: every `*_min` with
  its `*_max`, irritability low and high, acute and chronic weeks, running late before no show).
  Every setting row is held while a change is checked and saved (`lockSettings`), so two changes
  never pass each other. It is saved only while the setting still has the change time read
  (`changeSettingValue`), so a change made in between is never overwritten unread; the value
  already there writes nothing. The row's trigger audits it (`/app/audit?entity=setting`); the
  server's cache is cleared, and other server instances follow within 60 s.
- **Read only here** (`settingChangedElsewhere`, refused by the service too):
  - `ai.preparation_sheet`: switched on its page with the blind test and legal clearance (AI-09,
    `docs/runbooks/ai-gate.md`);
  - `launch.opening_entries_open`: the Opening entries page (SCH-13);
  - `ai.task_*`: a new model or prompt needs a new blind test, then a migration (AI-06,
    `docs/runbooks/ai-blind-test.md`);
  - `scheduling.slot_minutes`: every appointment length and roster is made of these slots;
  - `billing.consultation_price_items`, `billing.session_price_items`,
    `packages.never_reschedulable_items`, `packages.session_appointment_types`: they name price
    items and appointment types that bills, packages and the database's session counts use by
    key and in order;
  - `ai.blocked_providers`: the providers never sent patient data (PRD section 6);
  - `patients.adult_age_years`: the age from which patients consent for themselves (PRD J2.7).

  Each changes with a release (a migration), with whatever relies on it.
- **Not built:** a reset to the original value, and per centre values (they live on the records,
  as above).
- **Tests:** `packages/schemas/src/settings-screen.test.ts`;
  `packages/db/src/integration/settings-screen.integration.test.ts` (every stored value shows in a
  field that saves it back unchanged; nobody but the Super Admin reads or changes one);
  `apps/web/e2e/settings.spec.ts` (changes only `reminders.day_before_time`, which nothing reads
  until reminders are sent, and puts it back).
