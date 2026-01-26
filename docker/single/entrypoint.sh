#!/bin/sh
set -eu

DATA_DIR=/data
PG_DIR="$DATA_DIR/postgres"
SENTINEL_DIR="$DATA_DIR/sentinel"
PG_PASS_FILE="$SENTINEL_DIR/postgres_password"

# Tailscale state + socket dirs
mkdir -p "$DATA_DIR/tailscale" || true
mkdir -p /var/run/tailscale || true

# Sentinel persistent state (secrets, generated passwords, etc.)
mkdir -p "$SENTINEL_DIR" || true

mkdir -p "$PG_DIR"
chown -R postgres:postgres "$DATA_DIR" || true

# Generate/persist Postgres password on first run.
# Keep URL-safe by using hex.
if [ ! -s "$PG_PASS_FILE" ]; then
  echo "[entrypoint] generating postgres password..."
  umask 077
  od -An -N24 -tx1 /dev/urandom | tr -d ' \n' > "$PG_PASS_FILE"
fi

PG_PASSWORD="$(cat "$PG_PASS_FILE")"
export DATABASE_URL="postgres://sentinel:${PG_PASSWORD}@127.0.0.1:5432/sentinel"

# Initialize Postgres cluster if missing
if [ ! -s "$PG_DIR/PG_VERSION" ]; then
  echo "[entrypoint] initdb..."
  su - postgres -c "/usr/lib/postgresql/15/bin/initdb -D '$PG_DIR'"
fi

echo "[entrypoint] starting postgres for bootstrap..."
su - postgres -c "/usr/lib/postgresql/15/bin/pg_ctl -D '$PG_DIR' -o '-c listen_addresses=127.0.0.1' -w start"

echo "[entrypoint] ensuring user/db..."
if su - postgres -c "psql --username=postgres -tAc \"SELECT 1 FROM pg_catalog.pg_roles WHERE rolname='sentinel'\"" | grep -q 1; then
  su - postgres -c "psql --username=postgres -v ON_ERROR_STOP=1 -c \"ALTER ROLE sentinel WITH PASSWORD '$PG_PASSWORD'\""
else
  su - postgres -c "psql --username=postgres -v ON_ERROR_STOP=1 -c \"CREATE ROLE sentinel LOGIN PASSWORD '$PG_PASSWORD'\""
fi

if ! su - postgres -c "psql --username=postgres -tAc \"SELECT 1 FROM pg_database WHERE datname='sentinel'\"" | grep -q 1; then
  su - postgres -c "createdb -O sentinel sentinel"
fi

echo "[entrypoint] stopping postgres after bootstrap..."
su - postgres -c "/usr/lib/postgresql/15/bin/pg_ctl -D '$PG_DIR' -m fast -w stop"

# Note: SECRETS_KEY should be passed via env.
exec /usr/bin/supervisord -c /etc/supervisor/conf.d/supervisord.conf
