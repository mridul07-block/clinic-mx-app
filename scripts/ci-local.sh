#!/usr/bin/env bash
# The local gate (user decision 25 October 2026): every job of .github/workflows/ci.yml, run on
# this machine while GitHub-hosted runners are unavailable. A merge waits for it to pass, as it
# waits for CI. `pnpm ci:local` from the repository root, with Docker running; it resets the local
# database. See docs/runbooks/local-gate.md.
set -euo pipefail
cd "$(dirname "$0")/.."

started=$(date +%s)
step() { printf '\n== %s (%ss)\n' "$1" "$(($(date +%s) - started))"; }

if curl -fs -o /dev/null http://localhost:3000/api/health; then
  echo "Something is serving on port 3000; stop it so the tests build and start this commit."
  exit 1
fi

# The local stack's addresses and demo keys (not secrets), as CI sets them; a staff password and
# patient link key for this run unless already set.
export DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres
export DIRECT_DATABASE_URL=$DATABASE_URL
export CLINIC_MX_SEED_TARGET=local
export CLINIC_MX_SEED_STAFF_PASSWORD=${CLINIC_MX_SEED_STAFF_PASSWORD:-$(openssl rand -hex 16)}
export PATIENT_LINK_SECRET=${PATIENT_LINK_SECRET:-$(openssl rand -hex 32)}

step "Format, lint, design check, typecheck, unit tests"
pnpm verify

step "Migrations match the schema"
pnpm db:generate >/dev/null
if [ -n "$(git status --porcelain -- supabase/migrations)" ]; then
  git status --short -- supabase/migrations
  echo "The schema changed without a migration. Run pnpm db:generate and commit the result."
  exit 1
fi

step "Migrations are forward only"
git fetch -q origin main
changed=$(git diff --name-status --diff-filter=MDR "origin/main...HEAD" -- 'supabase/migrations/*.sql')
if [ -n "$changed" ]; then
  echo "$changed"
  echo "Existing migrations changed. Add a new migration instead."
  exit 1
fi

step "Every migration applied to an empty database"
pnpm db:start >/dev/null
pnpm exec supabase db reset --local --no-seed --yes
eval "$(pnpm --silent exec supabase status -o env | tr -d '"' | sed -n \
  -e 's/^API_URL=/export SUPABASE_URL=/p' \
  -e 's/^ANON_KEY=/export SUPABASE_ANON_KEY=/p' \
  -e 's/^SERVICE_ROLE_KEY=/export SUPABASE_SERVICE_ROLE_KEY=/p' \
  -e 's/^MAILPIT_URL=/export MAILPIT_URL=/p')"

step "Seed and the knowledge base"
pnpm db:seed
pnpm kb:import --apply

step "Database tests"
pnpm --filter @clinic-mx/db test:integration

for project in phone desktop; do
  step "End to end ($project)"
  CI=1 pnpm test:e2e --project="$project"
done

step "Secret scan"
docker run --rm -v "$(pwd -W 2>/dev/null || pwd):/repo" ghcr.io/gitleaks/gitleaks:v8.30.1 \
  git /repo --redact --no-banner --exit-code 1

step "Local gate passed at $(git rev-parse --short HEAD)"
