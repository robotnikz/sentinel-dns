# Sentinel Cluster Sync + VIP HA

Goal: run **two Sentinel nodes** so your router uses **one single DNS IP**, and failover happens automatically.

## TL;DR (2 nodes)

You will configure **two separate things**:

1) **VIP failover (DNS HA)**
- VIP (example): `192.168.1.53`
- Router/DHCP DNS: **VIP only** (no second IP)

2) **Cluster sync (config HA)**
- Leader URL: `http://<VIP>:8080` (example: `http://192.168.1.53:8080`)
- Follower joins via **Join Code**

Important: the VIP is an **IP only** (DNS is port 53 automatically). The **Leader URL** is a **web URL** (HTTP port, usually `8080`).

## Prerequisites

- Two Linux hosts in the same LAN/VLAN (VRRP works best on the same L2/broadcast domain).
- Docker + Docker Compose.
- Ports on the LAN:
  - DNS: `53/udp` + `53/tcp`
  - UI/API: `8080/tcp` (or whatever host port you published)

## What is synced (MVP)

- `settings` (excluding `cluster_*` and `secret:*`)
- `secret:*` values (exported over authenticated channel, then re-encrypted on the follower)
- `clients`
- manual rules (everything where `category NOT ILIKE 'blocklist:%'`)
- `blocklists` configuration (IDs preserved so client assignments stay consistent)

Not synced yet:
- `query_logs` (needs batching/retention-aware replication)
- `notifications`

## How VIP-based HA works

Sentinel supports automatic role switching through a role file:

- Env: `CLUSTER_ROLE_FILE`
- Contents: `leader` or `follower`

The keepalived sidecar writes this file so the node that owns the VIP becomes **Leader**, and the other becomes **Follower**.

Default file path used in compose:
- `/data/sentinel/cluster_role`

## Step-by-step setup (recommended)

### Step 1 — Deploy Sentinel on both nodes

On **Node A** and **Node B**:

1. Deploy with the included compose file:
   - `deploy/compose/docker-compose.yml`
2. Ensure `/data` is persisted (default `sentinel-data` volume).
3. Open the UI on each node and create/admin-login if this is the first run.

Note: the default compose includes keepalived already, but it stays **idle** until you enable VIP failover in the UI.

### Step 2 — Enable VIP failover (do this on both nodes)

On **Node A** and **Node B**:

1. UI → **Cluster / HA** → **Step 1 — VIP / Keepalived (VRRP)**
2. Enable VIP failover
3. Set the same values on both nodes:
   - **VIP**: `192.168.1.53` (IP only)
   - **Shared VRRP password**: (same on both nodes)
   - **Mode**: usually `multicast` (use `unicast` only if multicast is blocked)
4. Pick the LAN **interface** on each node (usually auto-detected).
5. Set different **priority** per node (higher wins the VIP), e.g.:
   - Node A: `120`
   - Node B: `110`
6. Click **Save & Apply**.

Sentinel writes `/data/sentinel/ha/config.json` and the keepalived sidecar applies it.

### Step 3 — Point your router DNS to the VIP

Router/DHCP DNS:
- `192.168.1.53`

That’s it. Your network now points at **one** DNS IP.

### Step 4 — Enable cluster sync (Leader + Follower)

On the node that currently owns the VIP (usually the higher priority node):

1. UI → **Step 2 — Leader Setup**
2. Set **Leader URL** to the address followers can reach:
   - normally: `http://192.168.1.53:8080`
   - if you published the UI on a different host port, use that port
3. Click **Enable Leader**
4. Load **Join Code**

On the other node:

1. UI → **Step 3 — Configure Follower**
2. Paste Join Code → Configure

## Verify it works

- UI → **Status**:
  - VIP owner should show Role `leader`
  - follower should show Role `follower` and “Follower last sync” updating
- Stop Node A (or the sentinel container): VIP should move to Node B.
- After failover, the new VIP owner should become Leader automatically.

## Troubleshooting

### VIP confusion (port)

- VIP is always an **IP only**. DNS is port `53` automatically.
- Leader URL is an **HTTP URL**. Use the UI/API host port (usually `8080`).

### No Join Code / Load button disabled

Join Code is only available when:

- you are logged in as admin,
- Leader is enabled,
- the node’s effective role is `leader`.

### Keepalived doesn’t start / no netinfo autodetect

- Requires Linux + `network_mode: host` + NET_ADMIN/NET_RAW/NET_BROADCAST capabilities.
- Some unprivileged LXC setups block host networking/capabilities.

### VIP doesn’t move

- Nodes should be on the same L2/VLAN.
- If multicast is blocked in your network, use VRRP `unicast` mode.

### Port 53 already in use

- Common on Linux with `systemd-resolved` (stub listener binds port 53 on 127.0.0.53).

1) Check what is using port 53:

```bash
sudo ss -lntup | grep ':53\b' || true
sudo ss -lnup  | grep ':53\b' || true
```

2) If it’s `systemd-resolved`, disable the stub listener:

```bash
sudo sed -i 's/^#\?DNSStubListener=.*/DNSStubListener=no/' /etc/systemd/resolved.conf
sudo systemctl restart systemd-resolved
```

On some distros you must also update `/etc/resolv.conf` to stop pointing at `127.0.0.53`:

```bash
sudo ln -sf /run/systemd/resolve/resolv.conf /etc/resolv.conf
```

3) Restart Sentinel after freeing port 53.

Important note: for “router points to DNS” setups you generally **must** use port **53**. Most routers/clients cannot specify a custom DNS port.

Fallback (testing only): change your compose ports to use a high port (e.g. `1053:53`) — but this is usually **not usable for whole-LAN DNS**.

## Notes / limitations

- Followers are read-only for API mutations to reduce split-brain risk.
- Two-node clusters can still have theoretical split-brain during weird partitions; a third “witness” is the typical hardening step.
