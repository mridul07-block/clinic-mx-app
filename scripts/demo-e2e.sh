#!/usr/bin/env bash
# The demo data end to end on this machine (docs/runbooks/demo-data.md): fills the local database
# with `pnpm demo:fill`, runs e2e/demo.spec.ts at 360 px and desktop (screenshots in
# apps/web/test-results), and removes the demo data after, whatever happens.
# `bash scripts/demo-e2e.sh` from the repository root, with the local Supabase stack running and
# nothing on port 3000.
set -euo pipefail
cd "$(dirname "$0")/.."
root=$(pwd)

if curl -fs -o /dev/null "http://localhost:3000/"; then
  echo "Something is serving on port 3000; stop it first."
  exit 1
fi

# The local stack's addresses and demo keys (not secrets), as scripts/ci-local.sh sets them.
export DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres
export DIRECT_DATABASE_URL=$DATABASE_URL
export CLINIC_MX_SEED_TARGET=local
export CLINIC_MX_SEED_STAFF_PASSWORD=${CLINIC_MX_SEED_STAFF_PASSWORD:-$(openssl rand -hex 16)}
export PATIENT_LINK_SECRET=${PATIENT_LINK_SECRET:-$(openssl rand -hex 32)}
eval "$(pnpm --silent exec supabase status -o env | tr -d '"' | sed -n \
  -e 's/^API_URL=/export SUPABASE_URL=/p' \
  -e 's/^ANON_KEY=/export SUPABASE_ANON_KEY=/p' \
  -e 's/^SERVICE_ROLE_KEY=/export SUPABASE_SERVICE_ROLE_KEY=/p' \
  -e 's/^MAILPIT_URL=/export MAILPIT_URL=/p')"

remove() { (cd "$root" && pnpm --silent --filter @clinic-mx/db demo:remove >/dev/null) || true; }
trap remove EXIT

pnpm db:seed >/dev/null
pnpm --silent --filter @clinic-mx/db demo:fill | tail -n 1
cd apps/web
E2E_DEMO=1 CI=1 pnpm test:e2e e2e/demo.spec.ts
