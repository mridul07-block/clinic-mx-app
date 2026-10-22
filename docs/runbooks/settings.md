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
with the value before and after. The Super Admin settings screen calls it from the settings module
service after its permission check (Super Admin only), then `invalidateSettings()`. The table is
unreadable through the Supabase API roles; everything goes through the server.
