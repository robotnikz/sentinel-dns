# Operations

This document is for **self-hosting operations** (upgrades, backups, and common runtime issues).
It intentionally does not cover local development (see `docs/DEVELOPMENT.md`).

## Upgrade / Rollback

Recommended approach:

- Pin a version tag in your `docker-compose.yml` (e.g. `ghcr.io/robotnikz/sentinel-dns:0.1.1`).
- Upgrade by changing the tag and restarting the container.
- Roll back by restoring the previous tag.

Commands:

```bash
docker compose pull
docker compose up -d
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

## Health checks

```bash
docker compose ps
docker compose logs -f
curl -fsS http://<server-ip>:8080/api/health
```

## Smoke test (Docker Compose)

For a quick end-to-end sanity check (container starts, API health responds, DNS answers over UDP):

```bash
npm run smoke:compose
```

Notes:

- By default this uses `docker-compose.smoke.yml` (local build) and high ports (`18080` for HTTP, `1053` for DNS) to avoid requiring privileged port bindings.
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
