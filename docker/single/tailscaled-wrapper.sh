#!/bin/sh
set -eu

TUN_DEV="/dev/net/tun"
TAILSCALE_STATE_FILE="/data/tailscale/tailscaled.state"
TAILSCALE_SOCKET_FILE="/var/run/tailscale/tailscaled.sock"

if [ ! -c "$TUN_DEV" ]; then
  echo "[tailscaled] disabled: $TUN_DEV is missing (enable in compose by adding NET_ADMIN + /dev/net/tun)." >&2
  exec sleep infinity
fi

# If the container doesn't have NET_ADMIN, tailscaled will spam logs while trying
# to manipulate iptables. Detect that upfront and stay disabled.
if ! iptables -t filter -S >/dev/null 2>&1; then
  echo "[tailscaled] disabled: iptables not permitted (missing NET_ADMIN capability)." >&2
  exec sleep infinity
fi

exec /usr/sbin/tailscaled \
  --tun=tailscale0 \
  --state="$TAILSCALE_STATE_FILE" \
  --socket="$TAILSCALE_SOCKET_FILE"
