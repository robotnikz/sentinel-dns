# Sentinel-DNS – Audit (Performance · Code Quality · Security)

Date: 2026-01-27

This document is intentionally kept in-repo so it can be reviewed, versioned, and cross-referenced with code changes over time.

## Legend

- Plain text = still open / recommended
- ~~Strikethrough~~ = implemented in the current codebase (kept for traceability)

## Deployment model (assumptions)

- Sentinel-DNS is an appliance-style LAN/VPN service (Pi-hole / AdGuard Home style).
- Default runtime is plain HTTP on the LAN; TLS is typically terminated by a reverse proxy if needed.
- A single-container mode exists and bundles Node API + UI + Postgres + Unbound (+ optional Tailscale).

## Status snapshot (what’s already implemented)

- ~~Batch insert for query log ingest (single DB query)~~ (`server/src/routes/queryLogs.ts`)
- ~~Defensive ingest limits (body limit + max items)~~ (`server/src/routes/queryLogs.ts`)
- ~~Query log retention cleanup job (default 30 days)~~ (`server/src/maintenance.ts`, `server/src/config.ts`)
- ~~Expression/partial indexes for common metrics patterns~~ (`server/src/db.ts`)
- ~~Metrics endpoints TTL cache (default 2s)~~ (`server/src/routes/metrics.ts`, `server/src/config.ts`)
- ~~`TRUST_PROXY` configurable, default enabled for reverse proxies~~ (`server/src/app.ts`, `server/src/config.ts`)
- ~~Cookie `secure` derived via Fastify `request.protocol` (not by trusting headers directly)~~ (`server/src/routes/auth.ts`)
- ~~Settings key validation (pattern + length)~~ (`server/src/routes/settings.ts`)
- ~~Secrets endpoint rate limiting + name validation~~ (`server/src/routes/secrets.ts`)
- ~~Frontend default cookie handling for `/api/*` (`credentials: 'include'`)~~ (`web/src/services/apiClient.ts`, `web/src/main.tsx`)
- ~~Query Log live mode visual smoothing (row animation + no background flash)~~ (`web/src/pages/QueryLogs.tsx`)

## Goals

- **Performance:** Identify bottlenecks/hot paths and derive measurable optimizations.
- **Code quality:** Improve robustness, maintainability, type-safety, and error handling.
- **Security:** Maintain a threat model and implement concrete hardening measures (app + container/deploy).

## Executive Summary

**Strengths (already in good shape):**

- Clear separation between **Server** (Fastify) and **UI** (Vite/React).
- Zod-based backend config validation (`server/src/config.ts`).
- Session model: random cookie value; server stores only **hashes**.
- Broad use of route schemas + rate limiting.
- Test pyramid exists (unit + Docker integration + Playwright E2E).

**Top risks (prioritized):**

- **P0/P1 Container hardening:** single-container needs strong privileges (NET_ADMIN, `/dev/net/tun`, ip_forward). Acceptable for LAN appliances, but must be clearly documented and optionally reducible.
- **P1 Supply chain (dev tooling):** root `npm audit` still reports moderate transitive findings in release tooling.
- **P2 Privacy & retention:** query logs contain sensitive browsing metadata; retention/backups and access boundaries must remain explicit.

Supply-chain baseline (root):

- `npm audit --audit-level=moderate --omit=dev`: **0 vulnerabilities**
- `npm audit --audit-level=moderate`: **4 moderate vulnerabilities** (transitive via `@semantic-release/npm` → `@actions/http-client` → `undici`)

## Scope / Entry Points

- Server entry: `server/src/index.ts` → `buildApp`.
- Fastify setup: `server/src/app.ts`.
- Auth / sessions: `server/src/auth.ts`, `server/src/routes/auth.ts`, `server/src/authStore.ts`.
- DB init/schema: `server/src/db.ts`.
- Single-container runtime: `docker/single/Dockerfile`, `docker/single/entrypoint.sh`, `docker/single/supervisord.conf`.
- Compose deployment:
  - single-node: `deploy/compose/docker-compose.yml`
  - HA (keepalived/VRRP): `deploy/compose/docker-compose.ha.yml`

## Architecture overview

Components:

- **DNS service** (UDP/TCP) handled by embedded DNS server + Unbound upstream.
- **HTTP API** (Fastify) serves:
  - Admin auth + settings/rules/clients/blocklists
  - Metrics derived from `query_logs`
  - Query log ingest endpoint used by the DNS pipeline
- **UI** (React/Vite) served from `dist/` in single-port mode.
- **Postgres** stores settings/rules/query logs/secrets metadata.

## Data & privacy

Data categories:

- **Query logs**: domains, timestamps, client identifier/IP, status (blocked/permitted), potentially upstream-related details.
- **Clients**: user-provided metadata (device name/type).
- **Secrets**: encrypted at rest (server-side), never exposed back to the browser.

Privacy notes:

- Query logs are sensitive browsing metadata. The product should continue to treat them as admin-only.
- Retention defaults should be visible in docs/UI (already documented; consider surfacing in UI if not already).
- Backups: clarify whether `/data` backups are supported/recommended and what they contain.

## Security (Threat model & findings)

For a fuller threat model, also see `docs/THREAT_MODEL.md`.

### Attack surfaces

- **HTTP API** (Admin UI, Settings, Secrets, AI, Tailscale)
- **DNS service** (UDP/TCP 53)
- **Embedded Tailscale** (VPN, Exit Node, iptables)
- **Persistence** in `/data` (Postgres, secrets, tokens, GeoIP)

### Findings & recommendations

#### P0 – Critical

1) **Container capabilities / privileges**

- The default compose needs `cap_add: NET_ADMIN` + `/dev/net/tun` and enables forwarding for exit-node support.
- Recommendation:
  - Document clearly: **LAN/VPN only**; never expose port 53 to the internet.
  - Provide a compose variant without Tailscale that works **without NET_ADMIN**.
  - Add defense-in-depth hardening options:
    - run as non-root where feasible
    - `read_only: true` where feasible, `tmpfs` for `/tmp`
    - `security_opt` (seccomp/apparmor where available)
    - `cap_drop: [ALL]` plus only the minimum adds for the chosen features

2) **Expose-by-default risk (DNS/UI ports)**

- The Compose templates publish `53` and `8080` on all interfaces by default.
- Recommendation:
  - Prefer binding to a LAN interface IP in docs/examples.
  - Optionally ship a “LAN-bind by default” compose variant/template.

#### P1 – High

3) **`/api/query-logs/ingest` DB write path (perf/DoS risk)**

- ~~Batch insert in one query (`jsonb_array_elements`)~~
- ~~Server-side limits (body size + max items)~~
- Follow-ups (optional):
  - Consider backpressure/queueing if ingest ever becomes internet-reachable (should not be).
  - Consider auth separation between “DNS ingest” and “admin UI” if future multi-user or external ingest is desired.

4) **Supply chain / CI tooling**

- Root `npm audit` still reports moderate transitive findings in release tooling (`undici` via GitHub Actions libraries).
- Recommendation:
  - Keep dev tooling updated; accept upstream residual risk where no non-breaking fix exists.
  - Isolate CI (least privilege) and minimize secret exposure.
  - Avoid running release workflows on untrusted PRs.

5) **Trust proxy / header trust**

- ~~`TRUST_PROXY` config flag (default enabled for reverse proxies)~~
- ~~Cookie `secure` derived via Fastify protocol (instead of trusting `x-forwarded-proto`)~~
- Follow-ups:
  - Document the security implications of enabling `TRUST_PROXY` when the service is directly reachable by untrusted clients.

#### P2 – Medium

6) **Settings API hardening**

- ~~Validate `:key` pattern + length~~
- Consider (optional):
  - Allow-list known keys to prevent unbounded settings growth.
  - Add a schema per settings object for critical settings (DNS upstream config, etc.).

7) **Secrets API hardening**

- ~~Rate limiting on secrets endpoints~~
- ~~Validate secret name~~
- Consider (optional):
  - Secrets key rotation strategy and operational documentation.
  - Add audit logging (without values) for “secret set/updated” events.

8) **HTTP security headers / CSP trade-offs**

- `helmet` is installed, but CSP and HSTS are disabled by default for the LAN-HTTP appliance model.
- Recommendation:
  - Provide an opt-in CSP profile when TLS is terminated in front.
  - Provide an opt-in HSTS toggle for strict HTTPS deployments.

9) **Brute force / account protections**

- Rate limits exist for auth endpoints.
- Consider (optional):
  - Account lockout or exponential backoff after repeated failed logins.
  - Optional 2FA for admin (TOTP).

## Performance

### Server

Implemented:

- ~~Batch ingest for query logs~~
- ~~DB indexes for query log access patterns (domain/client/status)~~
- ~~Retention job for query logs and ignored anomalies~~
- ~~TTL cache for metrics endpoints~~

Still worth considering (only if scale grows):

- Partition `query_logs` by time (monthly/weekly) to keep deletes fast.
- Materialized views for expensive dashboard aggregations.
- Explicit VACUUM/analyze guidance for big installations.

### Frontend

Implemented:

- ~~Central `apiFetch()` with cookie credentials by default~~
- ~~Live-mode Query Log row updates are smoothed~~

Still worth considering:

- Virtualization for very large query log tables (if increasing page sizes beyond 200).
- Memoization/selector patterns to reduce context-driven re-renders.

## Code quality & maintainability

Current strengths:

- Consistent use of Fastify route schemas in many routes.
- Clear layering (routes/auth/db/config/services).

Improvements to consider:

- Centralize shared schema fragments (settings key schema, common pagination schemas).
- Add a unified error mapping strategy (stable error codes, consistent HTTP codes).
- Add explicit DB migration/versioning strategy (currently schema is created/altered in code).

## Observability / operations

- Server logging exists (Fastify logger).
- Consider:
  - Add a simple correlation/request id (header or generated) to tie logs together.
  - Add operational docs for:
    - backup/restore of `/data`
    - rotating secrets keys
    - query log retention tuning and its trade-offs

## Testing

Already present:

- Unit tests (server + web)
- Integration tests with Docker Postgres
- Playwright E2E tests

Gaps to consider:

- Negative security regression tests for more endpoints (invalid params, oversized payloads, auth failures).
- Load testing for ingest/metrics (optional, depends on target scale).

## Next steps

- Keep this audit updated as features change; prefer strikethrough over deletion for completed items.
- Track concrete work items in issues/PRs; link back here when something is resolved.
