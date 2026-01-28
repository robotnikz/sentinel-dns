# Operations

This document is for **self-hosting operations** (upgrades, backups, and common runtime issues).
It intentionally does not cover local development (see `docs/DEVELOPMENT.md`).

## Upgrade / Rollback

Recommended approach:

- Pin a version tag in your compose file (e.g. `deploy/compose/docker-compose.yml`: `ghcr.io/robotnikz/sentinel-dns:0.1.1`).
- Upgrade by changing the tag and restarting the container.
- Roll back by restoring the previous tag.

Commands:

```bash
docker compose pull
docker compose -f deploy/compose/docker-compose.yml up -d
```

## Backups

All persistent state lives under the Docker volume mounted at `/data`.

Example (backup to a local tarball):

```bash
# Adjust volume name if you changed it.
docker run --rm -v sentinel-data:/data -v "$PWD":/backup alpine \
  sh -c "cd /data; tar -czf /backup/sentinel-data-backup.tgz ."
```

Restore:

```bash
docker run --rm -v sentinel-data:/data -v "$PWD":/backup alpine \
  sh -c "cd /data; tar -xzf /backup/sentinel-data-backup.tgz"
```

## Postgres credentials (single-container)

In the single-container image, Sentinel generates a random Postgres password on first start and stores it in the persistent volume.

- Password file: `/data/sentinel/postgres_password`
- Used internally by the API via `DATABASE_URL` (127.0.0.1 inside the container)

You typically do not need this, but it can help for debugging/migrations.
```

## Port 53 conflicts (Linux)

If the container fails to bind to port 53, a common cause is `systemd-resolved` using the stub resolver.

Options:

- Change the host mapping (e.g. `1053:53/udp` + `1053:53/tcp`) and point clients to that port.
- Disable the stub resolver on the host (advanced; depends on distro).

## Public upstreams break after container restart

If the container can resolve local names, but public upstream resolvers stop working after a restart, check the container's `/etc/resolv.conf`.
In Docker, you will often see `nameserver 127.0.0.11` (Docker's internal resolver), which then forwards to the Docker host/VM DNS.

If your host/VM DNS ultimately points back to Sentinel (common in homelabs/LAN appliance setups), this can create a DNS loop.

Fix (recommended): pin the container's outbound DNS in your compose file:

```yaml
services:
  sentinel:
    dns:
      - 1.1.1.1
      - 8.8.8.8
```

This does not change the DNS upstream mode you configure in the UI and does not require re-selecting anything after redeploy.

Note: the single-container image also attempts a best-effort bootstrap if Docker DNS (127.0.0.11) cannot resolve public hostnames.
If you want to control which resolvers are used for bootstrapping, set `BOOTSTRAP_DNS_SERVERS` (space-separated) on the container.

## LAN access vs WAN exposure

Sentinel-DNS is a DNS blocker, so it must be reachable by all devices in your LAN.
At the same time, you typically do **not** want to expose DNS (53) or the UI/API (8080) to the public internet.

Recommended options (pick one):

### Option A: Bind published ports to your LAN interface IP

Docker Compose lets you bind published ports to a specific host IP.
This keeps the service reachable inside your LAN while avoiding accidental exposure on other interfaces.

Example (`192.168.1.10` = your server's LAN IP):

```yaml
services:
  sentinel:
    ports:
      - "192.168.1.10:53:53/udp"
      - "192.168.1.10:53:53/tcp"
      - "192.168.1.10:8080:8080"
```

### Option B: Keep default binds, enforce with host firewall

If you need/want to keep Docker's default `0.0.0.0` binds, enforce the trust boundary on the host.

Example using `ufw` (adjust subnet + interface):

```bash
sudo ufw allow in on eth0 from 192.168.0.0/16 to any port 53 proto tcp
sudo ufw allow in on eth0 from 192.168.0.0/16 to any port 53 proto udp
sudo ufw allow in on eth0 from 192.168.0.0/16 to any port 8080 proto tcp
sudo ufw deny  in to any port 53
sudo ufw deny  in to any port 8080
```

If you also enable Tailscale, prefer controlling remote access via Tailscale ACLs.

## Reverse proxy (nginx/traefik/caddy)

Sentinel can run either:

- directly on HTTP (e.g. `http://192.168.1.10:8080`), or
- behind a reverse proxy that terminates TLS (e.g. `https://sentinel.example.com`).

If you **do not use a reverse proxy**: you don't need to change anything.

Typical LAN-only setups: leave Sentinel as-is (plain HTTP on port 8080). If you later put a reverse proxy in front (e.g. Nginx Proxy Manager), it will work without any extra Sentinel configuration.

If you **do use a reverse proxy** (e.g. Nginx Proxy Manager): terminate TLS at the proxy (select your certificate for the domain) and forward to Sentinel over plain HTTP (e.g. `http://<lan-ip>:8080`).

You typically do **not** need to configure custom header rules: most reverse proxies forward the standard `X-Forwarded-*` headers by default.

If you run into odd behavior behind a proxy (e.g. cookies/login issues), verify that the proxy forwards `X-Forwarded-Proto` / `X-Forwarded-For` and keep `TRUST_PROXY=true` so Sentinel can correctly detect HTTPS.

Env var:

- `TRUST_PROXY=true` (default)
- `TRUST_PROXY=false` (recommended when Sentinel is accessed directly, not via a proxy)

Security note: if `TRUST_PROXY=true` and Sentinel is reachable directly (not only through your proxy), clients can spoof `X-Forwarded-*` headers. Prefer restricting direct access at the network layer or set `TRUST_PROXY=false`.

## Query log retention (disk usage)

Sentinel keeps query logs bounded by default to prevent the database volume from growing forever.

- `QUERY_LOGS_RETENTION_DAYS` (default `30`): delete query log entries older than N days
- set `QUERY_LOGS_RETENTION_DAYS=0` to disable retention (logs grow without limit)

### Example (nginx)

Minimal nginx snippet (forward standard headers):

```nginx
location / {
  proxy_pass http://127.0.0.1:8080;
  proxy_set_header Host $host;
  proxy_set_header X-Forwarded-Host $host;
  proxy_set_header X-Forwarded-Proto $scheme;
  proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
}
```

## Health checks

```bash
docker compose ps
docker compose logs -f
curl -fsS http://<server-ip>:8080/api/health
```

## Optional HA (VIP failover)

Sentinel supports optional **VIP/VRRP failover** via a keepalived sidecar and automatic **cluster role switching**.

- Setup guide: [docs/CLUSTER_HA.md](docs/CLUSTER_HA.md)
- Linux only: keepalived requires `network_mode: host` and NET_* capabilities.
- If you never enable VIP failover in the UI, keepalived stays idle and Sentinel behaves like a normal single node.

## Debugging DNS upstream (resolver switching)

Sentinel stores your upstream selection in Postgres (`settings.key = dns_settings`) and the DNS runtime reloads it periodically.

### Option A: API (recommended)

After logging into the UI as admin, you can open the DNS status endpoint in the same browser session:

- `http://<server-ip>:8080/api/dns/status`

It includes an `upstream` object with:

- `configured`: what is stored/selected (`unbound` vs `forward` + transport)
- `effective`: what the DNS runtime is currently using (host/port or DoH URL)
- `refreshedAt`: when it last reloaded from the DB

If you prefer CLI, you can also login and reuse the cookie:

```bash
# 1) Login (writes cookie file)
curl -sS -c cookies.txt \
  -H 'content-type: application/json' \
  -d '{"username":"<admin>","password":"<password>"}' \
  http://<server-ip>:8080/api/auth/login

# 2) Fetch status using the cookie
curl -sS -b cookies.txt http://<server-ip>:8080/api/dns/status
```

### Option B: Container-level checks (no API auth required)

Read the persisted value from inside the container:

```bash
docker exec sentinel-dns \
  psql -h localhost -U sentinel -d sentinel -X -q -t -A -P pager=off \
  -c "select value::text from settings where key='dns_settings';"
```

Generate a few DNS queries and check outbound connections (transport proof):

```bash
# DoH (443)
docker exec sentinel-dns ss -tn state time-wait | grep ':443' | head

# DoT (853)
docker exec sentinel-dns ss -tn state time-wait | grep ':853' | head

# TCP upstream (53)
docker exec sentinel-dns ss -tn state time-wait | grep ':53' | head
```

## Smoke test (Docker Compose)

For a quick end-to-end sanity check (container starts, API health responds, DNS answers over UDP):

```bash
npm run smoke:compose
```

Notes:

- By default this uses `deploy/compose/docker-compose.smoke.yml` (local build) and high ports (`18080` for HTTP, `1053` for DNS) to avoid requiring privileged port bindings.
- It runs `docker compose up -d --build`, waits for `/api/health`, runs a DNS UDP query against `127.0.0.1:1053`.
- By default it also asserts blocking works by setting a temporary manual BLOCKED rule via the API and verifying DNS returns `NXDOMAIN` for that domain.
- It runs in an isolated Compose project name and removes its volumes on teardown (does not touch your regular `sentinel-data` volume).
- If you want to keep the container running after the test, use:

```bash
npm run smoke:compose -- --skip-down
```

## Remote access (Tailscale) and Exit Node

Sentinel-DNS ships with an embedded `tailscaled`.

- DNS-only access over tailnet: configure tailnet DNS nameserver(s) to Sentinel's Tailscale IP.
- Exit Node (“VPN back home”): requires `NET_ADMIN`, `/dev/net/tun`, and IP forwarding sysctls.

If Exit Node is enabled, you may need to approve route/exit-node advertisement in the Tailscale admin console.

## Updating the GeoIP database

The world map uses a local MaxMind GeoLite2 database stored in `/data`.
Use the UI to configure your MaxMind license key and trigger a download/update.
