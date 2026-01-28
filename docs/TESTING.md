# Testing Strategy

This document tracks the testing pyramid for Sentinel-DNS (LAN appliance, DNS + HTTP API).

## Test layers

- Unit: fast, deterministic, pure functions (no network/DB).
- Integration: Fastify routes + DB + auth/session semantics.
- Smoke: docker-compose, minimal regression gate for the single-container appliance.
- E2E: browser-level flows against the real UI+API.
- Security: authz/authn regression, dependency scanning, container hardening checks.

## Current commands

- Server unit tests: `npm run test:unit:server`
- Server integration tests (Docker + Postgres): `npm run test:integration:server`
- Smoke (compose): `npm run smoke:compose`
- E2E (compose): `npm run test:e2e:compose`

## Recently added coverage

- E2E: query logs basic controls, clients add-device flow, settings notifications save, header notifications bell feed.
- Server integration: `authStore` semantics, `notifyEvent` persistence + event-disable behavior.
- Frontend unit/regression: Cluster/HA page render (crash regression), sidebar cluster label semantics, and basic page-render smoke tests (Dashboard/Query Logs/Clients/Filtering/DNS Settings).

## TODO (industry-standard)

### Unit

- Add unit tests for:
  - `server/src/persistedConfig.ts` persisted tokens/keys (temp dir)
  - `server/src/secretsStore.ts` encrypt/decrypt edge cases
  - `server/src/dns/dnsServer.ts` rule matching helpers (extract to testable module)
  - `server/src/auth.ts` cookie/session parsing edge cases

### Integration (API)

- Add route tests using Fastify injection with a real Postgres:
  - `POST /api/auth/setup` + `POST /api/auth/login` (cookie set, invalid creds)
  - authz: ensure sensitive `GET` endpoints require admin cookie
  - `POST /api/rules` then DNS behavior via UDP query (mini end-to-end inside tests)
  - notifications feed mark-read + unread-count behavior

### Regression / Smoke

- Keep `npm run smoke:compose` green in CI.
- Add smoke variants:
  - `--no-assert-blocking` quick health-only gate
  - DNS upstream modes (unbound vs forward) validation
  - restart + persistence checks (passwords/tokens survive restart)

### E2E (UI)

- Expand coverage:
  - setup → dashboard → blocking page → add rule → verify rule appears
  - header widgets: notifications bell feed (unread → open → all read), protection pause state
  - query logs actions: add rule from a query (allow/block)
  - clients: rename device + per-client policy toggles
  - settings: GeoIP key flow + refresh action; Tailscale config save (LAN-only safe path)
  - auth: logout/login path

### Security testing

- Add automated checks:
  - dependency audits (`npm audit`, Renovate/Dependabot)
  - static analysis/linting for server (optional)
  - container scanning (Trivy) and base-image updates
  - authz regression tests for every sensitive endpoint

### Performance / resilience

- Add load tests for:
  - DNS UDP QPS baseline (blocked/permitted)
  - `/api/query-logs` pagination performance
- Chaos checks:
  - DB unavailable → API returns 503; DNS fails fast (SERVFAIL)

