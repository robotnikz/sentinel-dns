# Sentinel-DNS Server

Fastify-based API service for Sentinel-DNS.

## Dev

- Copy env (PowerShell): `Copy-Item .env.example .env`
- Install: `npm install`
- Run: `npm run dev`

API health check: `GET http://localhost:8080/api/health`

Notes:
- In the full appliance, the server is built and started inside the single-container runtime.
- The frontend dev server proxies `/api` to the backend (see root `vite.config.ts`).
