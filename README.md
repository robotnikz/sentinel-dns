<div align="center">
	<img src="./public/sentinel.svg" width="96" height="96" alt="Sentinel-DNS" />

	<h1>Sentinel-DNS</h1>

	<p>
		DNS blocker appliance (Pi-hole/AdGuard-style) with a Web UI + API and an embedded DNS stack.
	</p>

	<p>
		<a href="#quickstart">Quickstart</a>
		· <a href="#configuration">Configuration</a>
		· <a href="#architecture">Architecture</a>
		· <a href="#development">Development</a>
	</p>
</div>

## Highlights

- Single-container deployment (UI + API + Postgres + Unbound)
- Upstream forwarding via UDP / DoT / DoH (presets + custom resolvers)
- Blocklists + rewrite rules (local DNS records)
- Query logs, metrics, and a client activity map
- Optional remote access via embedded Tailscale (exit node support)

## Quickstart

Prerequisites: Docker Desktop

```bash
docker compose up -d --build
```

Endpoints:

- Web UI + API: http://localhost:8080
- DNS service: `127.0.0.1:53` (UDP/TCP)

To use Sentinel as your network DNS, point your clients/router to the host running the container.

## First run

On first start, create an admin user directly in the Web UI:

1. Open http://localhost:8080
2. Create username + password (min 8 chars)
3. Log in (session cookie)

AI provider keys (Gemini/OpenAI) are stored encrypted server-side and can be entered via the UI.

## Configuration

The default `docker-compose.yml` supports a few optional env vars:

- `TZ` (default `UTC`)
- `GEOIP_DB_PATH` (default `/data/GeoLite2-City.mmdb`)
- `SHADOW_RESOLVE_BLOCKED` (default `true`)

For local development, see `.env.example` and `server/.env.example`.

## Architecture

Inside the single container:

- **Web UI** (Vite build) served on `:8080`
- **API** (Fastify) on `:8080/api/*`
- **Postgres** for query logs and persisted settings
- **Unbound** as the embedded DNS engine (local recursion / forwarding)

Flow (high-level):

1. Client sends DNS query -> Sentinel
2. Rewrite rules apply (local DNS records)
3. Blocklists/rules apply
4. Allowed queries resolve via Unbound (local recursion or upstream forward)
5. Results + stats land in Postgres and show up in the UI

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

## Limitations

- Some upstream endpoints require HTTP/2 for DoH. If an upstream DoH endpoint is not compatible with the current client implementation, use DoT instead.
