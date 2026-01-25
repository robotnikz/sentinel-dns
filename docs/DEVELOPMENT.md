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

## Troubleshooting

- API health: `GET http://localhost:8080/api/health`
- If port 53 is busy on your host, adjust Docker port mappings or disable stub resolvers (Linux).
