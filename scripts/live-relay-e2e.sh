#!/usr/bin/env bash
# FND-09: the realtime relay end to end on this machine (docs/runbooks/live-relay.md), since CI runs
# with the relay off. Starts the relay locally (wrangler, no Cloudflare account), points the local
# database's signals at it, slows the live screens' own checks (live.refresh_seconds to 60) so only
# the relay can update them within 2 seconds, and runs e2e/live-relay.spec.ts at 360 px and desktop.
# Everything is put back after, whatever happens. `bash scripts/live-relay-e2e.sh` from the
# repository root, with the local Supabase stack running and nothing on ports 3000 and 8787.
set -euo pipefail
cd "$(dirname "$0")/.."
root=$(pwd)

for port in 3000 8787; do
  if curl -fs -o /dev/null "http://localhost:$port/"; then
    echo "Something is serving on port $port; stop it first."
    exit 1
  fi
done

sql() { docker exec -i supabase_db_clinic-mx psql -U postgres -v ON_ERROR_STOP=1 -qtA "$@"; }

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

# Secrets for this run only, never kept.
token_secret=$(openssl rand -hex 32)
signal_secret=$(openssl rand -hex 32)
refresh=$(sql -c "select value from public.setting where key = 'live.refresh_seconds'")
relay_pid=""

put_back() {
  [ -n "$relay_pid" ] && kill "$relay_pid" 2>/dev/null || true
  rm -f "$root/apps/live-relay/.dev.vars"
  sql -c "delete from vault.secrets where name in ('live_relay_signal_url', 'live_relay_signal_secret')" >/dev/null
  sql -c "select set_config('audit.actor', 'system:tests', false); update public.setting set value = '$refresh'::jsonb where key = 'live.refresh_seconds'" >/dev/null
}
trap put_back EXIT

printf 'TOKEN_SECRET=%s\nSIGNAL_SECRET=%s\nALLOWED_ORIGINS=http://localhost:3000\n' \
  "$token_secret" "$signal_secret" >apps/live-relay/.dev.vars
(cd apps/live-relay && exec pnpm exec wrangler dev --port 8787 --local --log-level warn) &
relay_pid=$!
until curl -fs -o /dev/null http://localhost:8787/health; do sleep 1; done

# The database container reaches this machine as host.docker.internal.
sql -c "select vault.create_secret('http://host.docker.internal:8787/signal', 'live_relay_signal_url')" >/dev/null
sql -c "select vault.create_secret('$signal_secret', 'live_relay_signal_secret')" >/dev/null
sql -c "select set_config('audit.actor', 'system:tests', false); update public.setting set value = '60' where key = 'live.refresh_seconds'" >/dev/null

pnpm db:seed >/dev/null
export LIVE_RELAY_URL=ws://localhost:8787
export LIVE_RELAY_TOKEN_SECRET=$token_secret
export E2E_LIVE_RELAY=1
cd apps/web
CI=1 pnpm test:e2e e2e/live-relay.spec.ts
