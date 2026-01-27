# Sentinel-DNS – Test Case Katalog (Unit · Integration · E2E)

Datum: 2026-01-27

Ziel: **vollständige, strukturierte** Absicherung der Features und Logiken.

- **P0** = blockiert Release / Security / Datenverlust
- **P1** = wichtige Regressionen
- **P2** = Nice-to-have / UI polish

Hinweis: Viele dieser Fälle sind bereits automatisiert umgesetzt (insbesondere im Server-Integration-Test-Set). Dieser Katalog ergänzt eine klare Abdeckungssystematik und macht Lücken sichtbar.

## 1) Auth / Sessions

### P0

- (Integration) First-Run Setup: `POST /api/auth/setup` erstellt Admin + setzt Session Cookie (httpOnly, sameSite, path, maxAge).
- (Integration) AuthZ Gates: Alle geschützten Endpoints liefern ohne Session **401**.
- (Integration) `GET /api/auth/me` liefert `loggedIn=true` nur mit gültigem Cookie.
- (Integration) Login: falscher user/pass → 401; korrekt → Cookie + Zugriff.
- (Integration) Password Change rotiert Sessions (andere Sessions invalid).

### P1

- (Integration) Logout löscht Session und invalidiert serverseitige Session.
- (Integration) Max Sessions (default 10): bei >10 logins wird älteste Session entfernt.

### P2

- (Unit) Cookie `secure` Verhalten abhängig von `request.protocol`/`x-forwarded-proto` (nur wenn `trustProxy` korrekt gesetzt ist).

## 2) Settings

### P0

- (Integration) Admin-only: `GET/PUT /api/settings*` ohne Cookie → 401.
- (Integration) CRUD: Put/Upsert JSON, Get returns row.

### P1

- (Integration) Input-Validation: ungültiger key (leer, zu lang, Sonderzeichen) → 400 (falls Schema ergänzt wird).
- (Integration) Large JSON Body: Server lehnt über Limit ab (falls bodyLimit gesetzt wird).

## 3) Secrets (Gemini/OpenAI Keys)

### P0

- (Integration) Ohne `SECRETS_KEY`: `PUT /api/secrets/:name` → 500 + klare Fehlermeldung.
- (Integration) Admin-only: status/set ohne Cookie → 401.

### P1

- (Integration) Param validation: `name` nur `[a-z0-9_]`.
- (Integration) Keine Secret-Values in Logs / Responses.

## 4) Query Logs

### P0

- (Integration) Admin-only: `GET /api/query-logs` ohne Cookie → 401.
- (Integration) `GET /api/query-logs?limit=...` clamp auf 1..1000.
- (Integration) `POST /api/query-logs/ingest` akzeptiert `item` oder `items[]`; 0 items → 400.

### P1

- (Integration) Ingest maxItems=2000 enforced.
- (Perf/Integration) Ingest Batch: große Payload wird performant persistiert (Regressions-Perf-Guard; optional).

## 5) Suspicious Activity / Ignored Anomalies

### P0

- (Integration) Admin-only: list/add/delete ohne Cookie → 401.
- (Integration) `signature` validation: leer → 400/Fehler.

### P1

- (Integration) Retention cleanup: Einträge >30d werden bereinigt (best-effort).

## 6) Metrics

### P0

- (Integration) Admin-only: `/api/metrics/*` ohne Cookie → 401.
- (Integration) Query param clamp: `hours` 1..168, `limit` je endpoint.

### P1

- (Integration) `excludeUpstreams` filtert bekannte resolver domains und forwarder host.

## 7) Rules / Rewrites / Blocklists

### P0

- (Integration) CRUD: Create/Read/Update/Delete flows; invalid inputs → 400.
- (Integration) Admin-only gates.

### P1

- (Integration) DNS behavior: Regeln beeinflussen DNS responses (UDP mini-e2e).
- (Integration) Blocklist refresh failure is recorded, does not crash job.

## 8) DNS Settings / Upstreams

### P0

- (Integration) Switching upstream modes: unbound vs forward (udp/tcp/dot/doh) with validation.

### P1

- (Integration) `SHADOW_RESOLVE_BLOCKED` toggles behavior for blocked domains analytics.

## 9) GeoIP

### P0

- (Integration) Status endpoint admin-only.
- (Integration) Update flow validates licenseKey and writes DB file to /data.

### P1

- (Integration) Migration: legacy mmdb is moved to expected city filename when present.

## 10) Tailscale / Remote Access

### P0

- (Integration) Status/admin-only.
- (E2E) UI: connect/auth flow happy path (LAN safe).

### P1

- (Integration) Exit node toggles do not break DNS/UI.

## 11) Static UI / SPA Fallback

### P0

- (Integration) `/api/ui/status` requires admin and reports dist/index presence.
- (Integration) SPA fallback serves index.html for deep links, but not for `/api/*` and not for missing assets.

## 12) Container / Appliance Smoke

### P0

- (Smoke) Compose up: health endpoint ok; UI reachable.
- (Smoke) Persistence: restart keeps admin/secrets/config.

### P1

- (Smoke) DNS: UDP query resolves allowed and blocks blocked.
- (Smoke) Upgrade path: new image over old volume keeps data.

## 13) Security Regression Suite

### P0

- (Integration) CSRF-resistant defaults: cookies sameSite strict; CORS origin restricted; credentials true.
- (Integration) AuthZ: no sensitive endpoints leak without cookie.

### P1

- (Integration) Rate-limit: brute force login limited.
- (Integration) Input validation for all params/query/body across routes.

## 14) Frontend Unit Tests (React)

### P0

- (Unit) Contexts: Rules/Clients contexts handle API errors and empty states.
- (Unit) Services: fetch wrappers handle 401 → redirect/login state.
- (Unit) API client setzt standardmäßig `credentials: 'include'` (Cross-Origin Dev Setup).

### P1

- (Unit) Query Logs page: large lists do not cause runaway renders (basic guard).

## 15) Playwright E2E (User Journeys)

### P0

- Setup → Dashboard → Query Logs navigation baseline.
- Add rule from query log → rule shows up → blocking effective.

### P1

- Notifications: unread count updates; mark-read works.
- Settings: DNS upstream save + persistence.
- Protection pause: toggle reflected across UI.

---

## Abdeckungs-Check (Mapping)

Empfehlung: pro Feature mindestens

- 1x Unit (pure logic)
- 1x Integration (API/auth/DB)
- 1x E2E (critical UI flow)

Damit ist die App gegen Regressionen in Logik, API und UI abgesichert.
