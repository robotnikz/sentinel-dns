<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Sentinel-DNS

DNS blocker appliance (Pi-hole/AdGuard-style) with a Web UI + API and an embedded DNS stack.

## Highlights

- Single-container deployment (UI + API + Postgres + Unbound)
- Upstream forwarding via UDP / DoT / DoH (presets + custom resolvers)
- Blocklists + rewrite rules (local DNS records)
- Query logs, metrics, and a client activity map
- Optional remote access via embedded Tailscale (exit node support)

## Quickstart (Docker)

Prerequisites: Docker Desktop

```bash
docker compose up -d --build
```

After startup:

- Web UI + API: http://localhost:8080
- DNS: 127.0.0.1:53 (UDP/TCP)

## First run

On first start, create an admin user directly in the Web UI.

- Open http://localhost:8080
- Create username + password (min 8 chars)
- Log in (session cookie)

AI provider keys (Gemini/OpenAI) are stored encrypted server-side and can be entered via the UI.

## Configuration

The default `docker-compose.yml` supports a few optional env vars:

- `TZ` (default `UTC`)
- `GEOIP_DB_PATH` (default `/data/GeoLite2-City.mmdb`)
- `SHADOW_RESOLVE_BLOCKED` (default `true`)

For local development, see `.env.example` and `server/.env.example`.

## GeoIP database

The dashboard world map uses a local MaxMind `.mmdb` database.

- Country aggregation: GeoLite2 Country
- Point markers require a City database (GeoLite2 City)

Copy a database into the running container:

```powershell
docker cp .\GeoLite2-Country.mmdb sentinel-dns-sentinel-1:/data/GeoLite2-Country.mmdb
```

Then restart:

```bash
docker compose restart
```

## DNS rewrite smoke test

Validates the full path (Web login -> create rewrite via API -> DNS answers -> cleanup).

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -Command "& { $c = Get-Credential; & (Join-Path $PWD 'scripts\\test-rewrite.ps1') -Credential $c }"
```

## Development

Frontend (Vite):

```bash
npm install
npm run dev
```

Server (Fastify):

```bash
npm --prefix server install
npm --prefix server run dev
```

## Notes on DNSSEC

With public upstream resolvers (Google/Cloudflare/Quad9), DNSSEC is typically validated by the upstream resolver.
If you want DNSSEC validation locally inside the appliance, use `Unbound (Local)`.

## Remote access (Tailscale)

Sentinel can run an embedded `tailscaled` and advertise itself as an exit node.

1. Create a reusable auth key in the Tailscale admin console.
2. In the Web UI: Settings -> Remote Access (Tailscale)
3. Approve exit-node advertisement in the Tailscale admin console (if enabled)

To route DNS through Sentinel for your tailnet devices, set your tailnet DNS nameserver(s) to Sentinel's Tailscale IP.
