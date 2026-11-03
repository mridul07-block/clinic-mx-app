#!/usr/bin/env bash
# The quick check (user decision 3 November 2026): enough to merge to staging. Runs every check that
# is cheap, and only the browser tests a change can reach (scripts/affected-specs.mjs). It becomes the
# full gate when the change touches something shared, or when no full run has passed for a day.
# Staging only: the live system always takes `pnpm ci:local`. See docs/runbooks/local-gate.md.
set -euo pipefail
cd "$(dirname "$0")/.."

started=$(date +%s)
step() { printf '\n== %s (%ss)\n' "$1" "$(($(date +%s) - started))"; }

full() {
  echo "Running the full gate: $1"
  exec bash scripts/ci-local.sh
}

stamp="$(git rev-parse --git-common-dir)/ci-local-last-pass"
if [ ! -f "$stamp" ] || [ -n "$(find "$stamp" -mmin +1440)" ]; then
  full "no full run has passed in the last 24 hours"
fi

git fetch -q origin main
plan=$(node scripts/affected-specs.mjs origin/main)
case "$plan" in
  full:*) full "${plan#full: }" ;;
esac

if curl -fs -o /dev/null http://localhost:3000/api/health; then
  echo "Something is serving on port 3000; stop it so the tests build and start this commit."
  exit 1
fi

export DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres
export DIRECT_DATABASE_URL=$DATABASE_URL
export CLINIC_MX_SEED_TARGET=local
export CLINIC_MX_SEED_STAFF_PASSWORD=${CLINIC_MX_SEED_STAFF_PASSWORD:-$(openssl rand -hex 16)}
export PATIENT_LINK_SECRET=${PATIENT_LINK_SECRET:-$(openssl rand -hex 32)}

step "Format, lint, design check, typecheck, unit tests"
if [ -z "$plan" ]; then
  pnpm verify
  bash scripts/secret-scan.sh
  step "Quick check passed at $(git rev-parse --short HEAD): no browser test can be affected"
  exit 0
fi

verify_log=$(mktemp)
pnpm verify >"$verify_log" 2>&1 &
verify_pid=$!
trap 'kill "$verify_pid" 2>/dev/null || true; rm -f "$verify_log"' EXIT

step "A fresh database"
pnpm db:start >/dev/null
pnpm exec supabase db reset --local --no-seed --yes >/dev/null
eval "$(pnpm --silent exec supabase status -o env | tr -d '"' | sed -n \
  -e 's/^API_URL=/export SUPABASE_URL=/p' \
  -e 's/^ANON_KEY=/export SUPABASE_ANON_KEY=/p' \
  -e 's/^SERVICE_ROLE_KEY=/export SUPABASE_SERVICE_ROLE_KEY=/p' \
  -e 's/^MAILPIT_URL=/export MAILPIT_URL=/p')"
pnpm db:seed >/dev/null
pnpm kb:import --apply >/dev/null

step "Waiting for the checks"
if ! wait "$verify_pid"; then
  cat "$verify_log"
  echo "The checks failed."
  exit 1
fi

# shellcheck disable=SC2086 # One spec file per word.
count=$(echo "$plan" | wc -l)
step "End to end: $count specs this change can reach"
echo "$plan"
CI=1 pnpm test:e2e $plan --project=phone --project=desktop \
  --workers="${E2E_WORKERS:-4}" --max-failures=10

step "Secret scan"
bash scripts/secret-scan.sh

step "Quick check passed at $(git rev-parse --short HEAD): $count specs"
