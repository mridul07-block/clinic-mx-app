# Backups

The independent, encrypted backup of Clinic Mx and how to restore it (FND-13; TAD sections 8 and
10; PRD rules table: "Daily provider backups plus an independent nightly encrypted copy; monthly
restore test"). Targets: recovery point 24 hours, recovery time 4 hours, another Postgres host
within 2 days.

Decisions (user, 24 October 2026): copies are private GitHub Actions artifacts; they are encrypted
to a key only the owner holds, offline; stored files are included, not just the database.

## What runs

`.github/workflows/backup.yml`, against staging today (production at the upgrade):

| Copy | When | Kept | Holds |
| --- | --- | --- | --- |
| Nightly | 2:00 AM IST daily | 30 days | Database (roles, schema, data, cron schedules) and every stored file |
| Weekly | Sunday 3:00 AM IST | 90 days | The same, plus a standard Postgres archive (`database.dump`, `pg_dump` custom format) for another host |

Each run (`pnpm backup …`, `packages/db/src/backup/`):

1. **Take**: `supabase db dump` writes `roles.sql`, `schema.sql` and `data.sql` (COPY form), as
   Supabase documents for CLI backups. The data dump leaves out cron, Vault and pg_net, so the cron
   schedules are written to `cron.sql`. Every object in every storage bucket is downloaded to
   `files/<bucket>/<path>` with the service role key. `manifest.json` records each table's row count
   (from the dump) and each file's size and SHA-256: names, counts and hashes, no patient data.
2. **Prove it restores**: a throwaway Supabase project with no migrations
   (`packages/db/src/backup/stack`, ports 553xx) is reset; roles, schema, data (triggers off) and
   cron schedules are restored in one transaction that stops at the first error; the files are
   uploaded into its storage; every table's row count and every file's hash must equal the
   manifest. The weekly archive must be readable by `pg_restore --list`. Any difference fails the
   run, and GitHub emails the repository owner about a failed scheduled run.
3. **Encrypt**: the folder is tarred and encrypted with age (`age-encryption`, by age's author) to
   the public key in the repository variable `BACKUP_AGE_RECIPIENT`. The plain copy is deleted.
4. **Keep**: the `.tar.gz.age` file and its manifest are uploaded as the artifact
   `nightly-YYYY-MM-DD` or `weekly-YYYY-MM-DD` (IST date).

Two things a fresh Supabase project refuses the `postgres` user are left out of a restore, because
the project already has them: grants to Supabase's own roles (`supabase_*`), and empty tables
(some, such as `storage.buckets_vectors`, only Supabase's roles may write).

Run it by hand: Actions, Backup, Run workflow (choose nightly or weekly), or
`gh workflow run backup.yml -f kind=weekly`.

## The key

- An X25519 age key pair, made with `pnpm backup keygen <file>`. The public key is the repository
  variable `BACKUP_AGE_RECIPIENT` (`gh variable set BACKUP_AGE_RECIPIENT`). The private key
  (`AGE-SECRET-KEY-1…`) is kept offline by the owner, in the password manager, never on GitHub, in
  the repository or in chat. Nothing on GitHub can read a copy.
- The `age` command line tool reads the copies too (`age -d -i key.txt copy.tar.gz.age`), so a
  restore never depends on this repository's code.
- Lost key: older copies can no longer be read. Make a new pair at once, set the new public key,
  run the workflow, and run a restore test. Leaked key: the same, and delete the old artifacts
  (Actions, the run, Artifacts).

## Restore test (monthly)

On a developer machine with Docker, the local Supabase images, and the private key in a file:

1. `pnpm backup:stack` (once; starts the throwaway project on ports 553xx).
2. Download the latest nightly copy:
   `gh run download <run id> -n nightly-YYYY-MM-DD -D <folder>` (the run id from
   `gh run list -w backup.yml`).
3. `BACKUP_AGE_IDENTITY_FILE=<key file> pnpm backup restore-test <folder>/nightly-YYYY-MM-DD.tar.gz.age`.
   It decrypts, checks the copy against its manifest, restores into the throwaway project, uploads
   the files, verifies every count and hash, and prints the time taken. The decrypted copy is
   deleted afterwards, pass or fail.
4. `pnpm exec supabase stop --workdir packages/db/src/backup/stack --no-backup`.
5. Add a row to the log below.

## Restoring for real

Into a new Supabase project (Mumbai), within the 4 hour target:

1. Download and decrypt the copy (step 2 above, then `age -d -i key.txt` or the restore test
   script), and extract it.
2. Run, with the new project's session pooler address:
   `psql --single-transaction -v ON_ERROR_STOP=1 -d "<address>"` fed with the restore script:
   `roles.sql` without lines granting to `"supabase_…"` roles, `schema.sql`,
   `SET session_replication_role = replica;`, `data.sql` without empty COPY blocks,
   `SET session_replication_role = origin;`, then `cron.sql` (the restore test builds exactly this:
   `restoreScript` in `packages/db/src/backup/restore.ts`).
3. Upload the files with the new project's service role key (`uploadFiles` in
   `packages/db/src/backup/files.ts`, with each object's type from `storage.objects`).
4. Set the Vault secrets for the job tick (`jobs.md`), point Vercel at the new project
   (`environments.md`), and run a smoke test.

Into plain Postgres 17 on another host (TAD: DigitalOcean Bangalore, within 2 days): restore the
weekly `database.dump` with `pg_restore --no-owner --no-privileges -d "<address>"`. It holds
Supabase's own schemas too; auth (`auth.users`) and storage need replacing on such a host, which is
the portability work the 2 days allow for.

## Production

At the upgrade (`upgrade-to-production.md` step 5): add `PRODUCTION_DATABASE_URL`,
`PRODUCTION_SUPABASE_URL` and `PRODUCTION_SUPABASE_SERVICE_ROLE_KEY` secrets and a production job
in `backup.yml` (same steps, `BACKUP_ENVIRONMENT: production`), keep Supabase's own daily backups
on Pro, and run a restore test from production's first copy. GitHub Free's private storage for
artifacts is limited (shared with packages); when copies grow past it (about 100 MB a copy with 30
nightly copies kept), move the copies to an object store in Mumbai and keep the same encryption.

## Restore tests

| Date | Copy | Result | Time | By |
| --- | --- | --- | --- | --- |

## Checking it

| Test | What it checks |
| --- | --- |
| `packages/db/src/backup/backup.test.ts` | Row counts read from a COPY dump (empty tables, escaped `\.` inside values, a cut off dump refused); the restore filters keep every row and drop only empty tables and Supabase role grants; cron schedules quoted safely; file sizes and hashes; verification reports missing rows, tables and files; only the matching private key decrypts. |
| `.github/workflows/backup.yml` | Every run restores its own copy into a fresh Supabase project and checks every row and file before keeping it. |

Negative check: with one row removed from `data.sql` after the manifest was written, the restore
proof failed (`"public"."centre": 29 rows, expected 30`) (FND-13).
