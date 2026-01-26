# Tests

This repo uses multiple layers of tests.

## Unit (fast, in-process)

Server unit tests (Vitest):

```bash
npm run server:install
npm run test:unit:server
```

## Integration (Fastify + Postgres via Docker)

These tests run the Fastify app in-process (inject) against an ephemeral Postgres started by Docker.

```bash
npm run test:integration:server
```

## Smoke (docker-compose, fast regression gate)

Runs the single-container appliance in an isolated compose project and verifies:
- API health
- DNS answers work
- manual blocking returns NXDOMAIN

```bash
npm run smoke:compose
```

## E2E (Playwright)

E2E tests assume a running full stack that serves the UI + API.

Run against an isolated compose stack:

```bash
npm run test:e2e:compose
```

Or run against an already running instance:

```bash
set BASE_URL=http://127.0.0.1:18080
npm run test:e2e
```
