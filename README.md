<div align="center">
<img src="public/sentinel.svg" width="96" height="96" alt="Sentinel-DNS" />

<h1>Sentinel-DNS</h1>

<p>
	<b>The self-hosted DNS blocker appliance</b> (Pi-hole/AdGuard-style) with an honest Web UI, API, and an embedded DNS stack.
</p>

<p>
	<a href="https://github.com/robotnikz/sentinel-dns/stargazers">
		<img alt="Stars" src="https://img.shields.io/github/stars/robotnikz/sentinel-dns?style=flat-square" />
	</a>
	<a href="https://github.com/robotnikz/sentinel-dns/issues">
		<img alt="Issues" src="https://img.shields.io/github/issues/robotnikz/sentinel-dns?style=flat-square" />
	</a>
	<a href="https://github.com/robotnikz/sentinel-dns/commits/main">
		<img alt="Last Commit" src="https://img.shields.io/github/last-commit/robotnikz/sentinel-dns?style=flat-square" />
	</a>
	<a href="https://github.com/robotnikz/sentinel-dns/actions/workflows/docker-publish.yml">
		<img alt="CI/CD Pipeline" src="https://github.com/robotnikz/sentinel-dns/actions/workflows/docker-publish.yml/badge.svg?branch=main" />
	</a>
	<a href="https://github.com/robotnikz/sentinel-dns/pkgs/container/sentinel-dns">
		<img alt="GitHub Release" src="https://img.shields.io/github/v/release/robotnikz/sentinel-dns?logo=docker&label=ghcr.io&style=flat-square" />
	</a>
	<a href="LICENSE">
		<img alt="License" src="https://img.shields.io/badge/License-MIT-yellow.svg?style=flat-square" />
	</a>
	<a href="https://docs.docker.com/compose/">
		<img alt="Docker Compose" src="https://img.shields.io/badge/docker-compose-2496ED?style=flat-square&logo=docker&logoColor=white" />
	</a>
	<a href="https://nodejs.org/">
		<img alt="Node" src="https://img.shields.io/badge/node-22%2B-339933?style=flat-square&logo=node.js&logoColor=white" />
	</a>
	<a href="https://www.typescriptlang.org/">
		<img alt="TypeScript" src="https://img.shields.io/badge/typescript-3178C6?style=flat-square&logo=typescript&logoColor=white" />
	</a>
</p>

<p>
	<a href="#quickstart">Quickstart</a>
	· <a href="#screenshots">Screenshots</a>
	· <a href="#configuration">Configuration</a>
	· <a href="#security--hardening">Security</a>
	· <a href="#development">Development</a>
</p>
</div>

---

> [!IMPORTANT]
> **Port 53 conflicts are common on Linux** (e.g. `systemd-resolved`). If Sentinel fails to start, change the host port mapping in your compose file or disable the stub resolver.

## ⚡ What is Sentinel-DNS?

Sentinel-DNS is a **single-container DNS blocker appliance** that bundles:

- a fast, modern **Web UI**
- a simple **HTTP API**
- **Postgres** for query logs and persisted settings
- **Unbound** as the embedded resolver / forwarder

It’s designed to be the “one box” DNS filter you can drop into your network and trust—because the UI is intentionally **honest** (status indicators reflect actual backend behavior).

## ✨ Key Features

- **Single-container deployment** (UI + API + Postgres + Unbound)
- **Upstreams:** UDP / DoT / DoH (presets + custom resolvers)
- **Blocking:** blocklists + rules + local rewrites (local DNS records)
- **Observability:** query logs, metrics, client view, DNS Activity Map
- **Honest UI:** backend-driven system status polling (no fake green lights)
- **Optional remote access:** embedded Tailscale (exit node support)

## 📸 Screenshots

| **Dashboard** | **Query Logs** |
|:---:|:---:|
| <img src="docs/screenshots/dashboard.png" alt="Dashboard" width="400"/> | <img src="docs/screenshots/query-logs.png" alt="Query Logs" width="400"/> |
| **DNS Settings** | **Clients** |
| <img src="docs/screenshots/dns-settings.png" alt="DNS Settings" width="400"/> | <img src="docs/screenshots/clients.png" alt="Clients" width="400"/> |

> [!TIP]
> Want to (re)generate the screenshots? See `npm run screenshots` in the **Development** section.

## Quickstart

Sentinel-DNS is shipped as a Docker image. You can run it on a Raspberry Pi, NAS, or any Linux server.

### Docker Prerequisites

1. Docker Engine + Compose plugin installed
2. Ports open on your LAN: `53/udp`, `53/tcp`, `8080/tcp`

### Method 1: Docker Compose (Recommended)

> [!TIP]
> For production, pin a version tag (e.g. `ghcr.io/robotnikz/sentinel-dns:0.1.1`) so upgrades/rollbacks are explicit.

Use the included `docker-compose.yml` in this repository (or create your own):

```yaml
services:
	sentinel:
		image: ghcr.io/robotnikz/sentinel-dns:latest
		container_name: sentinel-dns
		restart: unless-stopped
		ports:
			- "53:53/udp"
			- "53:53/tcp"
			- "8080:8080"
		volumes:
			- sentinel-data:/data
		environment:
			- TZ=Europe/Berlin

volumes:
	sentinel-data:
```

Run it:

```bash
docker compose up -d
```

> [!IMPORTANT]
> **Upgrade safety (data/history):** keep your `sentinel-data` volume. If you delete or change this mount, Sentinel will start fresh.

### Method 2: Docker CLI

```bash
docker run -d \
	-p 8080:8080 \
	-p 53:53/udp \
	-p 53:53/tcp \
	-v sentinel-data:/data \
	-e TZ=Europe/Berlin \
	--restart unless-stopped \
	--name sentinel-dns \
	ghcr.io/robotnikz/sentinel-dns:latest
```

---

Once running:

- Web UI + API: `http://<server-ip>:8080`
- DNS service: `<server-ip>:53` (UDP/TCP)

## First run

On first start, create an admin user directly in the Web UI:

1. Open `http://<server-ip>:8080`
2. Create username + password (min 8 chars)
3. Log in (session cookie)

AI provider keys (Gemini/OpenAI) are stored encrypted server-side and can be entered via the UI.

## Configuration

The default `docker-compose.yml` supports a few optional env vars:

- `TZ` (default `UTC`)
- `GEOIP_DB_PATH` (default `/data/GeoLite2-City.mmdb`)
- `SHADOW_RESOLVE_BLOCKED` (default `true`)

For local development, see `.env.example` and `server/.env.example`.

## 🔒 Security & Hardening

Sentinel-DNS is intended for self-hosting on a trusted network.

- If you expose the UI beyond your LAN, put it behind a reverse proxy with TLS.
- Do **not** expose port `53` to the internet.
- Prefer LAN/VPN access (Tailscale) instead of public DNS.

## GeoIP database

The dashboard world map uses a local MaxMind GeoLite2 database.

Recommended setup (no manual file copying):

1. In the Web UI: Settings -> GeoIP / World Map
2. Enter your MaxMind license key
3. Click update/download

Sentinel will download and refresh the GeoLite2 City database inside the persistent `/data` volume.

## Troubleshooting

```bash
docker compose ps
docker compose logs -f
curl -fsS http://<server-ip>:8080/api/health
```

## DNS rewrite smoke test

Validates the full path (Web login -> create rewrite via API -> DNS answers -> cleanup).

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -Command "& { $c = Get-Credential; & (Join-Path $PWD 'scripts\\test-rewrite.ps1') -Credential $c }"
```

## Development

### Generate screenshots (for README)

This project includes an automated screenshot script (Playwright) that can capture the main UI pages.

```bash
npm install
npx playwright install chromium
npm run screenshots
```

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

1. In the Web UI: Settings -> Remote Access (Tailscale)
2. Click the sign-in/connect flow (browser auth) and complete the login
3. Optional: instead of browser auth, you can paste a reusable auth key from the Tailscale admin console
4. Approve exit-node advertisement in the Tailscale admin console (if enabled)

To route DNS through Sentinel for your tailnet devices, set your tailnet DNS nameserver(s) to Sentinel's Tailscale IP.

## Limitations

- Some upstream endpoints require HTTP/2 for DoH. If an upstream DoH endpoint is not compatible with the current client implementation, use DoT instead.
