#!/bin/sh
set -eu

dns_probe() {
  # Returns 0 if we can resolve at least one well-known public hostname.
  # Use getent if available (Debian base), otherwise fall back to ping.
  if command -v getent >/dev/null 2>&1; then
    getent ahostsv4 cloudflare-dns.com >/dev/null 2>&1 && return 0
    getent ahostsv4 dns.google >/dev/null 2>&1 && return 0
    return 1
  fi

  if command -v ping >/dev/null 2>&1; then
    ping -c 1 -W 2 cloudflare-dns.com >/dev/null 2>&1 && return 0
    ping -c 1 -W 2 dns.google >/dev/null 2>&1 && return 0
    return 1
  fi

  return 1
}

maybe_bootstrap_resolv_conf() {
  # Some homelab setups point the Docker host/VM DNS back to this container.
  # After a restart, Docker's internal DNS (127.0.0.11) can loop and break
  # outbound name resolution needed for DoH/DoT upstream hostnames.
  #
  # If DNS works, do nothing.
  dns_probe && return 0

  if [ ! -r /etc/resolv.conf ]; then
    return 0
  fi

  if ! grep -qE '^nameserver\s+127\.0\.0\.11\b' /etc/resolv.conf; then
    return 0
  fi

  BOOTSTRAP_DNS_SERVERS="${BOOTSTRAP_DNS_SERVERS:-1.1.1.1 8.8.8.8}"
  echo "[entrypoint] outbound DNS probe failed; bootstrapping /etc/resolv.conf with: $BOOTSTRAP_DNS_SERVERS" >&2

  tmp="$(mktemp)"
  for server in $BOOTSTRAP_DNS_SERVERS; do
    echo "nameserver $server" >> "$tmp"
  done
  # Preserve search/options lines (useful in some LANs)
  grep -E '^(search|options)\b' /etc/resolv.conf >> "$tmp" 2>/dev/null || true

  if cat "$tmp" > /etc/resolv.conf 2>/dev/null; then
    rm -f "$tmp"
    # Best-effort re-probe for logging only
    if dns_probe; then
      echo "[entrypoint] outbound DNS bootstrap succeeded." >&2
    else
      echo "[entrypoint] outbound DNS bootstrap attempted, but DNS probe still fails." >&2
    fi
  else
    rm -f "$tmp"
    echo "[entrypoint] failed to update /etc/resolv.conf (read-only or restricted)." >&2
  fi
}

maybe_bootstrap_resolv_conf || true

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
