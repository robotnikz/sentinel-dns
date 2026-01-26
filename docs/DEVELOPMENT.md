# Development

This document contains development and contributor notes for Sentinel-DNS.
The root README is intentionally end-user focused.

## Prerequisites

- Node.js (for frontend + server development)
- Docker (recommended for running the full appliance)

## Frontend (Vite)

```bash
npm install
npm run dev
```

## Server (Fastify)

```bash
npm --prefix server install
npm --prefix server run dev
```

## Generate screenshots (for README)

This project includes an automated screenshot script (Playwright) that can capture the main UI pages.

```bash
npm install
npx playwright install chromium
npm run screenshots
```

## Local smoke tests

- DNS rewrite test (PowerShell):

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -Command "& { $c = Get-Credential; & (Join-Path $PWD 'scripts\\test-rewrite.ps1') -Credential $c }"
```

## Testing

## Test pyramid (industry standard)

Sentinel-DNS follows a classic test pyramid:

1. **Unit tests (fast, many)**
  - Pure logic tests, component tests, and module tests.
  - No Docker, no WAN.
  - Commands:
    - Frontend: `npm run test:unit:frontend`
    - Server: `npm run test:unit:server`

2. **Integration tests (medium, fewer)**
  - Exercises API routes via Fastify inject and core services against a real Postgres (Docker).
  - Still deterministic and offline: external calls are mocked/stubbed (GeoIP download, DoH/DoT, Tailscale, AI).
  - Command: `npm run test:integration:server`

3. **Smoke tests (slow, few)**
  - Bring up the full single-container appliance via compose and validate:
    - `/api/health` responds
    - DNS answers
    - (optionally) a rule causes NXDOMAIN
  - Command: `npm run smoke:compose`

4. **End-to-end (E2E) tests (slowest, very few)**
  - Full UI automation via Playwright against a real compose stack.
  - Command: `npm run test:e2e:compose`

Optional aggregations:

- `npm run test:coverage` (frontend + server coverage)
- `npm run test:ci` (runs the pyramid in order; skips Docker layers if Docker is unavailable)

### Server unit tests (Vitest)

```bash
npm --prefix server install
npm run test:unit:server
```

### Server integration tests (Fastify + Postgres via Docker)

```bash
npm run test:integration:server
```

### Full-stack smoke test (docker-compose)

This brings up an isolated single-container stack and verifies health + DNS behavior.

```bash
npm run smoke:compose
```

### Full-stack E2E (Playwright + docker-compose)

```bash
npm run test:e2e:compose
```

## Troubleshooting

- API health: `GET http://localhost:8080/api/health`
- If port 53 is busy on your host, adjust Docker port mappings or disable stub resolvers (Linux).
