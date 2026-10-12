#!/usr/bin/env bash
# A live Yetu API for the till's journey and live end-to-end suites.
#
# The local certification stack (deploy/compose.local-auth.yaml) runs with
# ZITADEL sign-in, so it never mounts POST /auth/dev-login, which the journey's
# manager leg needs. This script leaves that stack exactly as it is and runs a
# SECOND, separate API process from fbc-peak's own code -- the pattern
# fbc-peak's scripts/e2e/real-stack-journey.sh uses -- with sign-in through
# ZITADEL switched off (development only; configuration refuses it in
# production), against its own database, so nothing a run creates lands in the
# certification database.
#
#   tests/e2e-live/live-api.sh db     # create peak_e2e_pos and migrate it to fbc-peak's head
#   tests/e2e-live/live-api.sh seed   # cmd/e2e-seed -> Mama Rose + Savannah Crest fixture files
#   tests/e2e-live/live-api.sh api    # build and run cmd/api on 127.0.0.1:18080 (foreground)
#   tests/e2e-live/live-api.sh env    # print the variables the suites read (no secrets)
#   tests/e2e-live/live-api.sh reset-limits  # start this API's per-address rate limits again
#   tests/e2e-live/live-api.sh payments <orderId>  # how many pos_payments rows an order has (read-only)
#
# E2E_SKIP_BUILD=1 makes `api` start the binary already built (the S6 suite
# stops and restarts the API mid-payment and must not wait for a build).
#
# Why a copy of an empty test database rather than a fresh CREATE DATABASE:
# a fresh database needs fbc-peak's principals bootstrap replayed against it
# (scripts/test-db-env.sh does that), and that replay also resets the runtime
# login passwords the running API containers use. Copying a database that was
# already prepared that way, and is empty, gives the same schema ownership and
# grants without touching any role. E2E_TEMPLATE_DB must have no connections.
#
# The API opens its whole connection pool when it starts and keeps it for a
# day: a connection already signed in survives the login's password being
# switched underneath it by somebody else's integration run.
#
# No secret is printed. Passwords are read from fbc-peak's ignored env file and
# from the running containers' own configuration, and passed only through the
# environment of the child process.
#
# Optional: FBC_PEAK_DIR (a checkout of fbc-peak master; default the
# backend-e2e-seed worktree), PEAK_ENV_FILE, E2E_DB (peak_e2e_pos),
# E2E_TEMPLATE_DB (peak_test_platform_p0), E2E_API_PORT (18080),
# E2E_WORK_DIR (tests/e2e-live/.work), E2E_REDIS_DB (3),
# E2E_CORS_ORIGINS (the till's dev server, and the Origin the dev realtime
# bridge sends: scripts/realtime-bridge.mjs, http://localhost:5173).
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
workspace="$(cd "$here/../../../.." && pwd)" # .worktrees/pos-foundation -> PEAK
backend="${FBC_PEAK_DIR:-$workspace/.worktrees/backend-e2e-seed}"
env_file="${PEAK_ENV_FILE:-$workspace/fbc-peak/deploy/.env.local-auth}"
db="${E2E_DB:-peak_e2e_pos}"
template="${E2E_TEMPLATE_DB:-peak_test_platform_p0}"
port="${E2E_API_PORT:-18080}"
work="${E2E_WORK_DIR:-$here/.work}"
redis_db="${E2E_REDIS_DB:-3}"
cors="${E2E_CORS_ORIGINS:-http://127.0.0.1:5199,http://localhost:5199,http://localhost:5173}"

[ -f "$env_file" ] || { echo "missing $env_file" >&2; exit 1; }
[ -d "$backend/cmd/api" ] || { echo "FBC_PEAK_DIR=$backend is not an fbc-peak checkout" >&2; exit 1; }
case "$db" in peak) echo "refusing to use the certification database" >&2; exit 1 ;; esac
mkdir -p "$work"

value() { grep -m1 "^$1=" "$env_file" | cut -d= -f2- | tr -d '\r'; }
container_db_url() { docker inspect "$1" --format '{{range .Config.Env}}{{println .}}{{end}}' | sed -n 's/^PEAK_DATABASE_URL=//p'; }
# Same credentials, the host's published port, this run's database.
to_local() { printf '%s' "$1" | sed -E "s#@[^/]+/[^?]+#@127.0.0.1:5432/${db}#"; }
admin_psql() { docker exec -i -e PGPASSWORD="$(value PEAK_LOCAL_ADMIN_PASSWORD)" peak-postgres psql -v ON_ERROR_STOP=1 -qtA -U peak_cluster_admin "$@"; }
# The URL a runtime login can sign in with right now. fbc-peak's
# scripts/test-db-env.sh sets these logins to fixed local passwords for the
# integration suite and somebody restores the containers' own afterwards, so
# either may be current; try the containers' value first, then the suite's.
runtime_url() { # <container> <suite password>
  local url fixed
  url="$(to_local "$(container_db_url "$1")")"
  fixed="$(printf '%s' "$url" | sed -E "s#^(postgres(ql)?://[^:]+:)[^@]*@#\1$2@#")"
  for candidate in "$url" "$fixed"; do
    if psql "$candidate" -qtAc 'SELECT 1' >/dev/null 2>&1; then printf '%s' "$candidate"; return; fi
  done
  echo "neither password signs $1's login in; is peak-postgres up?" >&2
  return 1
}

cmd_db() {
  if [ "$(admin_psql -d postgres -c "SELECT 1 FROM pg_database WHERE datname='${db}'")" != 1 ]; then
    [ "$(admin_psql -d "$template" -c "SELECT count(*) FROM organizations")" = 0 ] ||
      { echo "$template is not empty; choose another E2E_TEMPLATE_DB" >&2; exit 1; }
    admin_psql -d postgres -c "CREATE DATABASE ${db} TEMPLATE ${template} OWNER peak_cluster_admin" >/dev/null
    echo "created ${db} from ${template}"
  fi
  owner="$(admin_psql -d "$db" -c "SELECT nspowner::regrole FROM pg_namespace WHERE nspname='public'")"
  [ "$owner" = peak_schema_owner ] || { echo "${db}: public is owned by ${owner}, not peak_schema_owner" >&2; exit 1; }
  (cd "$backend" && YETU_ENV=development \
    YETU_DATABASE_URL="$(to_local "$(value PEAK_LOCAL_MIGRATOR_DATABASE_URL)")" \
    YETU_DATABASE_MIGRATION_ROLE=peak_schema_owner go run ./cmd/migrate -command up 2>&1 | tail -2)
  echo "${db} at schema $(admin_psql -d "$db" -c "SELECT max(version_id) FROM peak_schema_migrations WHERE is_applied")"
}

cmd_seed() {
  (cd "$backend" &&
    YETU_TEST_ADMIN_URL="postgres://peak_cluster_admin:$(value PEAK_LOCAL_ADMIN_PASSWORD)@127.0.0.1:5432/${db}?sslmode=disable" \
    PEAK_TEST_APP_URL="$(runtime_url peak-property-api app_dev_password)" \
    PEAK_TEST_PLATFORM_URL="$(runtime_url peak-platform-api platform_dev_password)" \
    go run ./cmd/e2e-seed) >"$work/seed.json"
  python3 - "$work" <<'PY'
import json, sys, pathlib
work = pathlib.Path(sys.argv[1])
seed = json.loads((work / "seed.json").read_text())
(work / "mama-rose.json").write_text(json.dumps(seed["mamaRose"], indent=2))
(work / "savannah-crest.json").write_text(json.dumps(seed["savannahCrest"], indent=2))
print("seeded", seed["mamaRose"]["organizationId"], "(Mama Rose),", seed["savannahCrest"]["organizationId"], "(Savannah Crest)")
PY
}

cmd_api() {
  if [ "${E2E_SKIP_BUILD:-}" != 1 ] || [ ! -x "$work/peak-api" ]; then
    (cd "$backend" && go build -o "$work/peak-api" ./cmd/api)
  fi
  local database_url
  database_url="$(runtime_url peak-property-api app_dev_password)"
  echo "API on http://127.0.0.1:${port} (database ${db}, Redis db ${redis_db}, sign-in through ZITADEL off)"
  exec env -i PATH="$PATH" HOME="$HOME" \
    YETU_ENV=development YETU_RUNTIME_MODE=hospitality YETU_OIDC_ENABLED=false \
    YETU_HTTP_ADDR="127.0.0.1:${port}" YETU_METRICS_ADDR="127.0.0.1:$((port + 1000))" \
    YETU_PUBLIC_URL="http://127.0.0.1:${port}" YETU_CORS_ALLOWED_ORIGINS="$cors" \
    YETU_DATABASE_URL="$database_url" \
    YETU_DB_MIN_CONNS=10 YETU_DB_MAX_CONNS=10 YETU_DB_MAX_CONN_LIFETIME=24h YETU_DB_MAX_CONN_IDLE_TIME=24h \
    YETU_REDIS_ADDR=127.0.0.1:6379 YETU_REDIS_PASSWORD="$(value PEAK_LOCAL_REDIS_PASSWORD)" YETU_REDIS_DB="$redis_db" \
    YETU_SEARCH_ENABLED=false YETU_GEOCODE_PROVIDER=none YETU_LOG_FORMAT=text \
    "$work/peak-api"
}

# The API's per-address limits (dev-login 30 an hour, pairing requests 30 an
# hour, ...) count every run from this machine. They live in this API's own
# Redis database, which nothing else uses, so a new run may start them again.
cmd_reset_limits() {
  case "$redis_db" in 0|1) echo "refusing: Redis db ${redis_db} is shared (0: the local stack, 1: the integration suite)" >&2; exit 1 ;; esac
  local keys
  keys="$(docker exec -e REDISCLI_AUTH="$(value PEAK_LOCAL_REDIS_PASSWORD)" peak-redis \
    redis-cli -n "$redis_db" --scan --pattern 'peak:ratelimit:*')"
  if [ -n "$keys" ]; then
    printf '%s\n' "$keys" | docker exec -i -e REDISCLI_AUTH="$(value PEAK_LOCAL_REDIS_PASSWORD)" peak-redis \
      sh -c "xargs redis-cli -n $redis_db DEL" >/dev/null
  fi
  echo "cleared $(printf '%s' "$keys" | grep -c . || true) rate-limit counters in Redis db ${redis_db}"
}

# The till's own payments for one order, counted in the database (read-only):
# the S6 suite proves a payment whose answer was lost is recorded once.
cmd_payments() {
  local order="${1:-}"
  [[ "$order" =~ ^[0-9a-f-]{36}$ ]] || { echo "usage: $0 payments <order uuid>" >&2; exit 2; }
  admin_psql -d "$db" -c "BEGIN READ ONLY; SELECT count(*) FROM pos_payments WHERE order_id='${order}'; COMMIT;" | grep -E '^[0-9]+$'
}

cmd_env() {
  cat <<EOF
PEAK_JOURNEY_BASE_URL=http://127.0.0.1:${port}
PEAK_JOURNEY_MAMA_ROSE=$work/mama-rose.json
PEAK_JOURNEY_SAVANNAH_CREST=$work/savannah-crest.json
EOF
}

case "${1:-}" in
  db) cmd_db ;;
  seed) cmd_seed ;;
  api) cmd_api ;;
  env) cmd_env ;;
  reset-limits) cmd_reset_limits ;;
  payments) cmd_payments "${2:-}" ;;
  *) echo "usage: $0 db|seed|api|env|reset-limits|payments" >&2; exit 2 ;;
esac
