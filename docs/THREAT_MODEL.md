# Sentinel DNS – Threat Model (STRIDE/OWASP)

## Scope

**Assets (what we protect)**
- Admin session cookie + account credentials
- Secrets in `secrets` store (AI keys, MaxMind license)
- DNS policy state (rules, rewrites, blocklists, schedules)
- Query logs / client metadata (PII-ish in LAN context)
- Appliance runtime integrity (single-container mode: Unbound, Postgres, Tailscale, Node)

**Trust boundaries**
- Browser UI ↔ API (`/api/*`)
- API ↔ Postgres
- API ↔ local OS tools (tailscale/unbound via container)
- DNS clients ↔ DNS listener

## Entry points
- HTTP API: Admin UI + API routes (`/api/*`)
- DNS: UDP/TCP 53 (plus DoH/DoT upstream connections)
- Container/Compose: privileged networking (TUN/NET_ADMIN) + mounted `/data`

## Threats & mitigations (high level)

### Spoofing (S)
- **Threat**: Session spoofing / stolen cookie.
  - **Mitigations**: HttpOnly cookie, `sameSite=strict`, secure cookies behind TLS, short session TTL, rotate sessions on login, logout invalidates server-side hash.
- **Threat**: Trusting forged `X-Forwarded-*` headers.
  - **Mitigations**: Restrict `trustProxy` to known reverse proxy deployments; document safe defaults.

### Tampering (T)
- **Threat**: Settings/secrets keys used as injection vector.
  - **Mitigations**: Route schema validation for params, allowlist where feasible, `additionalProperties:false`.
- **Threat**: Malicious query-logs ingest payload causing DB stress.
  - **Mitigations**: Body size limit, batching, per-client rate limits on ingest (if exposed), strict JSON schema.

### Repudiation (R)
- **Threat**: Admin actions not attributable.
  - **Mitigations**: Audit logging of sensitive actions (settings/secrets changes) with timestamp + admin identity; avoid logging secrets.

### Information Disclosure (I)
- **Threat**: Query logs / client info leaks.
  - **Mitigations**: Require admin for sensitive endpoints, minimize returned fields, consider retention limits.
- **Threat**: Secrets accidentally logged.
  - **Mitigations**: Never return secret values, redact logs, store encrypted at rest (`SECRETS_KEY`).

### Denial of Service (D)
- **Threat**: Large payloads / hot endpoints (logs, metrics) exhaust CPU/DB.
  - **Mitigations**: Pagination/limits, body limits, batching, rate limiting on sensitive endpoints.
- **Threat**: UI polling overlaps causing resource pressure.
  - **Mitigations**: Abort in-flight requests, backoff, avoid overlapping polling.

### Elevation of Privilege (E)
- **Threat**: Bypass admin gates.
  - **Mitigations**: Centralized `requireAdmin` per route, integration tests for authz.
- **Threat**: Container privileges abused (Tailscale/iptables).
  - **Mitigations**: Provide non-privileged compose variant, restrict exposure to LAN/VPN only, least-privilege container hardening.

## Security regression tests (what to keep)
- Invalid settings key → 400 (schema validation)
- Secrets endpoints are rate-limited
- Unauthenticated access to admin APIs → 401/403
- Query log ingest enforces body limit + rejects non-array

## Notes
- Some supply-chain findings are dev/CI-only; still isolate release jobs and never run release pipelines on untrusted PR contexts.
