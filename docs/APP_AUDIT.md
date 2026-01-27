# Sentinel-DNS – Audit (Performance · Code Quality · Security)

Date: 2026-01-27

## Goals

- **Performance:** Identify bottlenecks/hot paths and derive measurable optimizations.
- **Code quality:** Improve robustness, maintainability, type-safety, and error handling.
- **Security:** Establish a threat model and concrete hardening measures (app + container/deploy).

## Executive Summary

**Strengths (already in good shape):**

- Clear separation between **Server** (Fastify) and **UI** (Vite/React).
- **Zod-based config validation** on the backend.
- **Session design**: random session token in a cookie, stored server-side as a **SHA-256 hash**.
- **Rate limits** are present on many endpoints.
- A **test pyramid** already exists: unit + Docker integration + Playwright E2E.

**Top risks (prioritized):**

- **P0/P1 Security/Hardening:** The single-container deployment needs strong capabilities (NET_ADMIN, /dev/net/tun). That is acceptable for LAN appliances, but it should be explicitly hardened and documented.
- **P1 Performance (fixed):** `POST /api/query-logs/ingest` was switched to a batch insert (single query), including defensive limits.
- **P1 Supply chain (reduced):** Root `npm audit` findings in **dev/CI tooling** (semantic-release toolchain) were reduced; remaining findings are transitive/upstream.

Supply-chain baseline (root):

- `npm audit --audit-level=moderate` currently reports **4 moderate findings** – transitive via `@semantic-release/npm` → `@actions/http-client` → `undici`.
- Server `npm audit` is currently **0 vulnerabilities**.

## Scope / Entry Points

- Server entry: `server/src/index.ts` → `buildApp`.
- Fastify setup: `server/src/app.ts`.
- Auth / sessions: `server/src/auth.ts`, `server/src/routes/auth.ts`, `server/src/authStore.ts`.
- Single-container runtime: `docker/single/Dockerfile`, `docker/single/entrypoint.sh`, `docker/single/supervisord.conf`.

## Security (Threat Model & Findings)

### Attack surfaces

- **HTTP API** (Admin UI, Settings, Secrets, AI, Tailscale)
- **DNS service** (UDP/TCP 53)
- **Embedded Tailscale** (VPN, Exit Node, iptables)
- **Persistence** in `/data` (Postgres, secrets, tokens, GeoIP)

### Findings & recommendations

#### P0 – Critical

1) **Container capabilities / privileges**

- The default compose needs `cap_add: NET_ADMIN` + `/dev/net/tun`.
- Recommendation:
  - Document clearly: **LAN/VPN only**; never expose port 53 to the internet.
  - Optional: provide a compose variant without Tailscale that works **without NET_ADMIN**.
  - Add defense-in-depth: `read_only: true` (where possible), `tmpfs` for `/tmp`, restrictive `security_opt`, minimal `cap_drop`.

#### P1 – High

2) **`/api/query-logs/ingest` DB write path (perf/DoS risk)**

- Up to 2000 items → 2000 `INSERT` statements in one transaction.
- Recommendation:
  - Batch insert in **one query** (e.g. JSONB array → `jsonb_array_elements`).
  - Additionally: enforce server-side size limits (body size), optionally a separate queue/buffer.

3) **Supply chain / CI tooling**

- Root `npm audit` reported high-severity issues in devDependencies (semantic-release → npm libs like `tar`, `glob`).
- Recommendation:
  - Upgrade `semantic-release` / `@semantic-release/npm` to versions that do not pull the vulnerable npm-lib stacks.
  - Remaining moderate findings are currently upstream (`@actions/http-client`/`undici`); until fixed: isolate CI, least privilege, avoid untrusted inputs in release jobs.
  - Isolate CI (least privilege) and minimize secret exposure.

4) **Trust proxy / header trust (potential correctness + hardening)**

- `trustProxy: true` is set globally. In pure LAN-HTTP deployments this is fine, but with direct access X-Forwarded-* headers can have unexpected effects.
- Recommendation:
  - Add a `TRUST_PROXY` config flag. The default should be chosen so reverse proxies work without extra configuration (and can optionally be disabled for direct LAN access).
  - Determine cookie `secure` via Fastify `request.protocol` + properly configured `trustProxy` (instead of trusting `x-forwarded-proto` directly).

#### P2 – Medium

5) **Settings API is very permissive**

- `PUT /api/settings/:key` accepts arbitrary JSON bodies and `:key` is not validated.
- Recommendation:
  - `params` schema: allowed key pattern (e.g. `^[a-z0-9_\-]{1,64}$`).
  - Optional: allow-list known keys.

6) **Secrets API without explicit rate limiting / schema hardening**

- `PUT /api/secrets/:name` has a schema but no rateLimit.
- Recommendation:
  - Add rate limiting.
  - Avoid audit/logging of secret values: never log secret contents.

## Code Quality (Server)

- Positive: Many endpoints already use rateLimit + `requireAdmin`.
- Improvements:
  - Consistent schema validation (params/query/body) across all routes.
  - More modular helper functions for DB hot paths (batching, paging).
  - Unified error handling (Fastify error handler) + stable error codes.

## Performance

### Server

- Typical hotspots:
  - Query logs: ingest + aggregations (`metrics/*`).
  - DNS pipeline: matching/rules + logging.

Recommendations:

- Review/add **DB indexes**: `query_logs(ts)` and potentially JSONB indexes depending on query patterns.
- `query_logs/ingest`: batch insert.
- Aggregations: consider materialized views / pre-aggregation (optional, if scaling).

### Frontend

- Action items (typical for React/Context):
  - Re-render hotspots in contexts (Clients/Rules).
  - Virtualization for long lists (Query Logs).
  - Memoization for expensive map/chart components.

Additional finding (correctness/dev UX):

- Some API calls in the frontend use `fetch('/api/...')` directly.
- For cookie-based sessions across **cross-origin** setups (e.g. dev UI `localhost:3000` → API `localhost:8080`), calls must consistently use `credentials: 'include'`.
- Recommendation: a central `apiFetch()` helper in `web/src/services/apiClient.ts` that defaults to `credentials: 'include'`, and unify usage across the frontend.

## Observability / Measurement

- Server:
  - Request logging (already present), optionally add a correlation id.
  - Optional: Prometheus metrics (if desired) or at least structured logs.

- Frontend:
  - Web Vitals / performance marks for Query Logs rendering.

## Next steps

- From this audit: prioritized fix list (P0/P1 first) + tests.
- See the test case catalog in `docs/TEST_CASES.md`.
