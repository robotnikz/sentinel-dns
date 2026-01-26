#!/bin/sh
set -eu

STATE="${1:-}"
ROLE_FILE="${HA_ROLE_FILE:-/data/sentinel/cluster_role}"

mkdir -p "$(dirname "$ROLE_FILE")" || true

case "$STATE" in
  MASTER)
    echo "leader" > "$ROLE_FILE"
    ;;
  BACKUP|FAULT)
    echo "follower" > "$ROLE_FILE"
    ;;
  *)
    echo "Unknown state: $STATE" >&2
    exit 1
    ;;
esac

exit 0
