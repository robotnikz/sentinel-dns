# Sentinel Cluster Sync + VIP HA

Goal: run **two Sentinel nodes** so your router uses **one single DNS IP**, and failover happens automatically.

This document is written for a **home network / homelab** setup where “DNS must not go down” during maintenance or a node outage.

## TL;DR (2 nodes)

You will configure **two separate things**:

1) **VIP failover (DNS HA)**
- VIP (example): `192.168.1.53`
- Router/DHCP DNS: **VIP only** (no second IP)

2) **Cluster sync (config HA)**
- Leader URL: `http://<VIP>:8080` (example: `http://192.168.1.53:8080`)
- Follower joins via **Join Code**

Important: the VIP is an **IP only** (DNS is port 53 automatically). The **Leader URL** is a **web URL** (HTTP port, usually `8080`).

### What it can do (today)

- **DNS failover in the LAN** via VRRP/VIP: your router points to one DNS IP (the VIP) and keepalived moves it to the other node.
- **Config HA** via cluster sync: the follower continuously pulls config from the leader.
- **Split-brain protection**: follower rejects most mutations (read-only guard).

### What it cannot do (yet)

- No query log replication (so history/analytics won’t “move” with the VIP yet).
- No automatic conflict resolution if you bypass the guard (don’t write to both nodes).
- Not a multi-site HA solution (VRRP/VIP expects the same L2/broadcast domain).

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
   - HA (Sentinel + keepalived): `deploy/compose/docker-compose.ha.yml`

   Start it like this:

   ```bash
   docker compose -f deploy/compose/docker-compose.ha.yml up -d
   ```
2. Ensure `/data` is persisted (default `sentinel-data` volume).
3. Open the UI on each node and create/admin-login if this is the first run.

Note: keepalived stays **idle** until you enable VIP failover in the UI.

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

Important:

- Use the **VIP only** as DNS server for clients.
- Avoid configuring a “secondary DNS” with the standby node IP if you want predictable failover behavior. Many clients will keep using the old DNS until caches expire.

That’s it. Your network now points at **one** DNS IP.

### Step 4 — Enable cluster sync (Leader + Follower)

On the node that currently owns the VIP (usually the higher priority node):

1. UI → **Step 2 — Leader Setup**
2. Set **Leader URL** to the address followers can reach:
   - normally: **use the VIP URL**: `http://192.168.1.53:8080`
   - if you published the UI on a different host port, use that port
3. Click **Enable Leader**
4. Load **Join Code**

On the other node:

1. UI → **Step 3 — Configure Follower**
2. Paste Join Code → Configure

Why the Leader URL should be the VIP:

- The follower sync loop always talks to `leaderUrl`.
- If `leaderUrl` is a node-specific IP/hostname, failover will move the VIP but the follower may still try to sync from the downed node.
- If `leaderUrl` is the VIP, the follower always reaches the currently active leader.

## Common pitfalls (read this if setup feels “stuck”)

- **Port 53 already in use** on the host (common with `systemd-resolved`). DNS won’t start correctly.
- **Multicast VRRP blocked**: switch keepalived mode to `unicast` and set peers.
- **Leader URL set to Node A IP** instead of VIP: sync breaks after failover.
- Nodes not on the same L2/VLAN: VRRP/VIP failover becomes unreliable.

## Verify it works

- UI → **Status**:
  - VIP owner should show Role `leader`
  - follower should show Role `follower` and “Follower last sync” updating
- Stop Node A (or the sentinel container): VIP should move to Node B.
- After failover, the new VIP owner should become Leader automatically.

## 5-minute failover test (recommended)

Goal: verify DNS stays available for the whole home network.

1) Router/DHCP DNS points to the **VIP only** (example: `192.168.1.53`).

2) From any LAN client, run a DNS query against the VIP:

- Linux/macOS:

```bash
dig @192.168.1.53 example.com A
```

- Windows PowerShell:

```powershell
Resolve-DnsName -Server 192.168.1.53 -Name example.com -Type A
```

3) Trigger failover:

- Reboot the current VIP owner host, or stop the Sentinel service/container on it.

4) Wait ~5–15 seconds, then run the DNS query again.

Expected:

- DNS query still succeeds via the VIP.
- The other node becomes **Leader (VIP owner)** in the UI.

If it fails:

- Check Step 2: **Leader URL must point to the VIP URL** (so the follower can always reach the active leader).
- Check port `53` is free on both hosts.
- If multicast VRRP is blocked, switch keepalived to `unicast`.

## HA verification checklist (hands-on)

This is a practical checklist you can run during a maintenance window to validate:

- VIP failover (keepalived / VRRP)
- automatic role switching (via role file)
- follower settings sync loop
- follower read-only guard

Assumptions:

- Two Linux hosts: **Node A** + **Node B**
- Both are running the HA compose from `deploy/compose/docker-compose.ha.yml`
- Router/DHCP points DNS to the VIP
- UI/API port is reachable on both nodes (default `8080`)

### 0) Pre-flight (both nodes)

On each node:

1) Confirm containers are up:

```bash
docker compose -f deploy/compose/docker-compose.ha.yml ps
```

2) Confirm keepalived is enabled (after you saved HA config in UI):

```bash
docker logs --tail=200 sentinel-keepalived
```

Expected:

- You should see a line like `keepalived: enabled interface=... vip=... vrid=... priority=...`.

3) Confirm the role override file exists and is being updated:

```bash
docker exec sentinel-dns sh -lc 'ls -la /data/sentinel/cluster_role || true; cat /data/sentinel/cluster_role || true'
```

Expected:

- File exists after keepalived becomes active.
- Content is exactly `leader` on the VIP owner, `follower` on the standby.

### 1) Confirm role + readiness endpoints

On each node:

1) `ready` endpoint (no auth):

```bash
curl -fsS http://127.0.0.1:8080/api/cluster/ready
```

Expected:

- Standalone: `{"ok":true,"role":"standalone"}`
- Leader: `{"ok":true,"role":"leader"}`
- Follower: `{"ok":true,"role":"follower",...}` **only if** it synced recently (see next step)

2) Cluster status endpoint (requires admin cookie/token via UI):

- UI → **Cluster / HA** → Status should show:
   - `effectiveRole` matches the role file
   - follower shows a fresh “Follower last sync” timestamp

### 2) Validate follower sync actually applies changes

1) Pick a safe, visible change on the Leader (VIP owner):

- Example A: create a dummy client label
- Example B: toggle a non-destructive setting (e.g. a UI setting)
- Example C: add a harmless local DNS rewrite for a test-only domain

2) Wait ~10–15 seconds.

3) On the follower:

- UI should reflect the change.
- The follower Status should show “Follower last sync” updating every few seconds.

If you want a quick sanity check from shell without UI:

```bash
curl -fsS http://127.0.0.1:8080/api/cluster/ready
```

Expected:

- `ok:true` on the follower (meaning `lastSync` stayed within the freshness window).

### 3) Validate follower read-only guard

Goal: follower must reject mutations to avoid split-brain.

On the follower node, while logged in, try a safe mutation (e.g. toggling a setting).

Expected:

- UI should show an error.
- The API returns HTTP `409` with:
   - `error: "FOLLOWER_READONLY"`
   - message tells you to make changes on leader/VIP.

Note: `/api/cluster/*` endpoints are intentionally still allowed so you can reconfigure/recover.

### 4) Failover exercise (VIP move)

1) Identify which node currently owns the VIP:

- UI Status should show Leader on the VIP owner.
- The role file should contain `leader` there.

2) Trigger failover by stopping Sentinel on the leader node:

```bash
docker compose -f deploy/compose/docker-compose.ha.yml stop sentinel
```

3) Observe on the other node (new VIP owner):

- The VIP should appear on the LAN interface.
- keepalived logs should show MASTER transition.
- The role file should switch to `leader`.
- The UI should report effective role `leader`.

4) Bring the old leader back:

```bash
docker compose -f deploy/compose/docker-compose.ha.yml start sentinel
```

Expected:

- With `nopreempt`, the VIP usually stays where it is until the current master fails.

### 5) “Readiness gating” sanity (follower should not own VIP if sync is broken)

The keepalived config tracks a script that checks `/api/cluster/ready`.
For followers, `ready` only becomes ok when a successful sync happened recently.

Practical check:

- Temporarily break follower sync (e.g. set an unreachable Leader URL on the follower),
- then observe `/api/cluster/ready` on follower flips to `ok:false` after ~20s,
- and keepalived should avoid/promote VIP ownership based on the script.

### What to capture if something fails

On both nodes:

```bash
docker logs --tail=300 sentinel-dns
docker logs --tail=300 sentinel-keepalived
docker exec sentinel-dns sh -lc 'cat /data/sentinel/cluster_role || true; cat /data/sentinel/ha/config.json || true'
```

And note:

- which node had the VIP at the time
- the `effectiveRole` shown in UI
- the follower “last sync” + “last error” fields

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
