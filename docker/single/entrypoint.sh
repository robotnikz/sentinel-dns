#!/bin/sh
set -eu

DATA_DIR=/data
PG_DIR="$DATA_DIR/postgres"

# Tailscale state + socket dirs
mkdir -p "$DATA_DIR/tailscale" || true
mkdir -p /var/run/tailscale || true

mkdir -p "$PG_DIR"
chown -R postgres:postgres "$DATA_DIR" || true

# Initialize Postgres cluster if missing
if [ ! -s "$PG_DIR/PG_VERSION" ]; then
  echo "[entrypoint] initdb..."
  su - postgres -c "/usr/lib/postgresql/15/bin/initdb -D '$PG_DIR'"
fi

echo "[entrypoint] starting postgres for bootstrap..."
su - postgres -c "/usr/lib/postgresql/15/bin/pg_ctl -D '$PG_DIR' -o '-c listen_addresses=127.0.0.1' -w start"

echo "[entrypoint] ensuring user/db..."
su - postgres -c "psql --username=postgres -v ON_ERROR_STOP=1" <<'SQL'
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'sentinel') THEN
    CREATE ROLE sentinel LOGIN PASSWORD 'sentinel';
  END IF;
END $$;
SQL

if ! su - postgres -c "psql --username=postgres -tAc \"SELECT 1 FROM pg_database WHERE datname='sentinel'\"" | grep -q 1; then
  su - postgres -c "createdb -O sentinel sentinel"
fi

echo "[entrypoint] stopping postgres after bootstrap..."
su - postgres -c "/usr/lib/postgresql/15/bin/pg_ctl -D '$PG_DIR' -m fast -w stop"

# Note: SECRETS_KEY should be passed via env.
exec /usr/bin/supervisord -c /etc/supervisor/conf.d/supervisord.conf
