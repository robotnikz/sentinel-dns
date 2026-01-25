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

## Port 53 conflicts (Linux)

If the container fails to bind to port 53, a common cause is `systemd-resolved` using the stub resolver.

Options:

- Change the host mapping (e.g. `1053:53/udp` + `1053:53/tcp`) and point clients to that port.
- Disable the stub resolver on the host (advanced; depends on distro).

## Health checks

```bash
docker compose ps
docker compose logs -f
curl -fsS http://<server-ip>:8080/api/health
```

## Remote access (Tailscale) and Exit Node

Sentinel-DNS ships with an embedded `tailscaled`.

- DNS-only access over tailnet: configure tailnet DNS nameserver(s) to Sentinel's Tailscale IP.
- Exit Node (“VPN back home”): requires `NET_ADMIN`, `/dev/net/tun`, and IP forwarding sysctls.

If Exit Node is enabled, you may need to approve route/exit-node advertisement in the Tailscale admin console.

## Updating the GeoIP database

The world map uses a local MaxMind GeoLite2 database stored in `/data`.
Use the UI to configure your MaxMind license key and trigger a download/update.
