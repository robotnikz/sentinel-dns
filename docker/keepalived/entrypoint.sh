#!/bin/sh
set -eu

DATA_DIR="${DATA_DIR:-/data}"
CONFIG_FILE="${HA_CONFIG_FILE:-${DATA_DIR}/sentinel/ha/config.json}"
NETINFO_FILE="${HA_NETINFO_FILE:-${DATA_DIR}/sentinel/ha/netinfo.json}"
READY_URL="${HA_READY_URL:-http://127.0.0.1:8080/api/cluster/ready}"
ROLE_FILE="${HA_ROLE_FILE:-${DATA_DIR}/sentinel/cluster_role}"

CONF_DIR="/etc/keepalived"
mkdir -p "$CONF_DIR"

detect_default_interface() {
  ip -4 route show default 2>/dev/null | awk '{for (i=1;i<=NF;i++) if ($i=="dev") {print $(i+1); exit}}' || true
}

write_netinfo() {
  DEFAULT_IF="$(detect_default_interface)"
  DEFAULT_GW="$(ip -4 route show default 2>/dev/null | awk '{print $3; exit}' || true)"
  mkdir -p "$(dirname "$NETINFO_FILE")" || true

  INTERFACES_JSON=""
  for IFACE in $(ip -o link show | awk -F': ' '{print $2}'); do
    ADDR_CIDR="$(ip -4 -o addr show dev "$IFACE" 2>/dev/null | awk '{print $4}' | head -n 1 || true)"
    [ -n "$ADDR_CIDR" ] || continue
    IP_ONLY="${ADDR_CIDR%/*}"
    PREFIX="${ADDR_CIDR#*/}"
    if [ -n "$INTERFACES_JSON" ]; then
      INTERFACES_JSON="$INTERFACES_JSON,"
    fi
    INTERFACES_JSON="$INTERFACES_JSON{\"name\":\"$IFACE\",\"ipv4\":\"$IP_ONLY\",\"cidr\":\"$ADDR_CIDR\",\"prefix\":$PREFIX}"
  done

  cat > "$NETINFO_FILE" <<EOF
{\
  \"detectedAt\": \"$(date -Iseconds)\",\
  \"defaultInterface\": \"$DEFAULT_IF\",\
  \"defaultGateway\": \"$DEFAULT_GW\",\
  \"interfaces\": [${INTERFACES_JSON}]\
}
EOF
}

render_from_config() {
  enabled="$(jq -r '.enabled // false' "$CONFIG_FILE" 2>/dev/null || echo false)"
  if [ "$enabled" != "true" ]; then
    return 1
  fi

  HA_INTERFACE="$(jq -r '.interface // ""' "$CONFIG_FILE")"
  if [ -z "$HA_INTERFACE" ] || [ "$HA_INTERFACE" = "null" ]; then
    HA_INTERFACE="$(detect_default_interface)"
  fi
  if [ -z "$HA_INTERFACE" ]; then
    echo "keepalived: cannot determine interface (set it in GUI)" >&2
    return 1
  fi

  FIRST_ADDR="$(ip -4 -o addr show dev "$HA_INTERFACE" 2>/dev/null | awk '{print $4}' | head -n 1 || true)"
  IF_PREFIX="${FIRST_ADDR#*/}"

  HA_VIP_RAW="$(jq -r '.vip // ""' "$CONFIG_FILE")"
  if [ -z "$HA_VIP_RAW" ] || [ "$HA_VIP_RAW" = "null" ]; then
    echo "keepalived: missing vip" >&2
    return 1
  fi

  if echo "$HA_VIP_RAW" | grep -q '/'; then
    HA_VIP_CIDR="$HA_VIP_RAW"
  else
    if [ -z "$IF_PREFIX" ] || [ "$IF_PREFIX" = "$FIRST_ADDR" ]; then
      echo "keepalived: cannot infer /CIDR; set VIP with /CIDR in GUI" >&2
      return 1
    fi
    HA_VIP_CIDR="$HA_VIP_RAW/$IF_PREFIX"
  fi

  HA_VRID="$(jq -r '.vrid // 53' "$CONFIG_FILE")"
  HA_PRIORITY="$(jq -r '.priority // 110' "$CONFIG_FILE")"
  HA_ADVERT_INT="$(jq -r '.advertInt // 1' "$CONFIG_FILE")"
  HA_MODE="$(jq -r '.mode // "multicast"' "$CONFIG_FILE")"
  HA_AUTH_PASS="$(jq -r '.authPass // ""' "$CONFIG_FILE")"

  if [ -z "$HA_AUTH_PASS" ] || [ "$HA_AUTH_PASS" = "null" ]; then
    echo "keepalived: missing authPass" >&2
    return 1
  fi

  HA_UNICAST_BLOCK=""
  if [ "$HA_MODE" = "unicast" ]; then
    HA_SRC_IP="$(jq -r '.srcIp // ""' "$CONFIG_FILE")"
    if [ -z "$HA_SRC_IP" ] || [ "$HA_SRC_IP" = "null" ]; then
      HA_SRC_IP="${FIRST_ADDR%/*}"
    fi
    PEERS="$(jq -r '.unicastPeers // [] | join(" ")' "$CONFIG_FILE")"
    if [ -z "$PEERS" ]; then
      echo "keepalived: missing unicastPeers" >&2
      return 1
    fi
    PEERS_LINES=""
    for P in $PEERS; do
      [ -n "$P" ] || continue
      PEERS_LINES="$PEERS_LINES    $P\n"
    done
    HA_UNICAST_BLOCK="unicast_src_ip $HA_SRC_IP\n  unicast_peer {\n$PEERS_LINES  }"
  fi

  sed \
    -e "s|\${HA_INTERFACE}|$HA_INTERFACE|g" \
    -e "s|\${HA_VIP_CIDR}|$HA_VIP_CIDR|g" \
    -e "s|\${HA_VRID}|$HA_VRID|g" \
    -e "s|\${HA_PRIORITY}|$HA_PRIORITY|g" \
    -e "s|\${HA_AUTH_PASS}|$HA_AUTH_PASS|g" \
    -e "s|\${HA_ADVERT_INT}|$HA_ADVERT_INT|g" \
    -e "s|\${HA_READY_URL}|$READY_URL|g" \
    -e "s|\${HA_ROLE_FILE}|$ROLE_FILE|g" \
    -e "s|\${HA_UNICAST_BLOCK}|$HA_UNICAST_BLOCK|g" \
    /keepalived.conf.template > "$CONF_DIR/keepalived.conf"

  echo "keepalived: enabled interface=$HA_INTERFACE vip=$HA_VIP_CIDR vrid=$HA_VRID priority=$HA_PRIORITY mode=$HA_MODE" >&2
  return 0
}

# Always write netinfo so the GUI can guide the user.
write_netinfo || true

# Idle until HA is enabled via GUI (config file exists and has enabled=true).
while true; do
  if [ -f "$CONFIG_FILE" ] && render_from_config; then
    break
  fi
  write_netinfo || true
  sleep 5
done

# Safe default: until VIP ownership is established, behave as follower.
HA_ROLE_FILE="$ROLE_FILE" /notify.sh BACKUP || true

exec keepalived --dont-fork --log-console -f "$CONF_DIR/keepalived.conf"
