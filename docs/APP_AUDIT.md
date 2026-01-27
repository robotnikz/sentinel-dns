# Sentinel-DNS – Audit (Performance · Code Quality · Security)

Datum: 2026-01-27

## Ziele

- **Performance:** Engpässe/Hotpaths identifizieren, messbare Optimierungen ableiten.
- **Code-Qualität:** Robustheit, Wartbarkeit, Typ-Sicherheit, Fehlerbehandlung verbessern.
- **Security:** Bedrohungsmodell + konkrete Hardening-Maßnahmen (App + Container/Deploy).

## Kurzfazit (Executive Summary)

**Stärken (bereits gut gelöst):**

- Klare Trennung von **Server** (Fastify) und **UI** (Vite/React).
- **Zod-basierte Config-Validierung** im Backend.
- **Session-Konzept**: zufälliger Session-Token im Cookie, serverseitig als **SHA-256 Hash** gespeichert.
- **Rate-Limits** sind an vielen Endpoints vorhanden.
- **Testpyramide** existiert bereits: Unit + Docker-Integration + Playwright E2E.

**Top-Risiken (priorisiert):**

- **P0/P1 Security/Hardening:** Single-Container benötigt starke Capabilities (NET_ADMIN, /dev/net/tun). Das ist für LAN-Appliances ok, aber sollte explizit gehärtet/abgesichert werden.
- **P1 Performance:** `POST /api/query-logs/ingest` schreibt aktuell **Eintrag pro INSERT** in einer Schleife (bis zu 2000). Das skaliert schlecht und erzeugt unnötige DB-Last.
- **P1 Supply Chain:** Root `npm audit` meldete High-Severity Findings in **Dev/CI tooling** (semantic-release → npm libs). Das betrifft primär CI/Build-Umgebung, ist aber trotzdem zu adressieren.

Supply-Chain Baseline (Root):

- `npm audit --audit-level=moderate` meldet aktuell **4 moderate Findings** – transitiv über `@semantic-release/npm` → `@actions/http-client` → `undici`.
- Server `npm audit` ist aktuell **0 vulnerabilities**.

## Scope / Entry Points

- Server entry: `server/src/index.ts` → `buildApp`.
- Fastify Setup: `server/src/app.ts`.
- Auth / Sessions: `server/src/auth.ts`, `server/src/routes/auth.ts`, `server/src/authStore.ts`.
- Single-container runtime: `docker/single/Dockerfile`, `docker/single/entrypoint.sh`, `docker/single/supervisord.conf`.

## Security (Threat Model & Findings)

### Angriffsflächen

- **HTTP API** (Admin UI, Settings, Secrets, AI, Tailscale)
- **DNS Service** (UDP/TCP 53)
- **Embedded Tailscale** (VPN, Exit Node, iptables)
- **Persistenz** in `/data` (Postgres, Secrets, tokens, GeoIP)

### Findings & Empfehlungen

#### P0 – Kritisch

1) **Container-Capabilities / Privilegien**

- Der Default-Compose benötigt `cap_add: NET_ADMIN` + `/dev/net/tun`.
- Empfehlung:
  - Dokumentiert klar: **LAN/VPN only**; niemals Port 53 ins Internet.
  - Optional: Compose-Variante ohne Tailscale, die **ohne NET_ADMIN** auskommt.
  - Ergänzt Defense-in-depth: `read_only: true` (wo möglich), `tmpfs` für `/tmp`, restriktive `security_opt`, minimierte `cap_drop`.

#### P1 – Hoch

2) **`/api/query-logs/ingest` DB-Schreibpfad (Perf/DoS-Risiko)**

- Bis zu 2000 Items → 2000 `INSERT` Statements in einer TX.
- Empfehlung:
  - Batch-Insert in **1 Query** (z.B. JSONB Array → `jsonb_array_elements`).
  - Zusätzlich: serverseitige Größenlimits (Body size), evtl. separate Queue/Buffer.

3) **Supply Chain / CI Tooling**

- Root `npm audit` meldete High-Severity Issues in devDependencies (semantic-release → npm libs wie `tar`, `glob`).
- Empfehlung:
  - `semantic-release` / `@semantic-release/npm` auf Versionen aktualisieren, die nicht die verwundbaren npm-lib Stacks ziehen.
  - Verbleibende moderate Findings aktuell upstream (`@actions/http-client`/`undici`); bis Fix verfügbar ist: CI isolieren, least privilege, keine untrusted inputs in Release-Jobs.
  - CI isolieren (least privilege) und Secrets exposure minimieren.

4) **Trust Proxy / Header Trust (Potential correctness + hardening)**

- `trustProxy: true` ist global gesetzt. In reinen LAN-HTTP Deployments ist das ok, aber bei Direktzugriff können X-Forwarded-* Header unerwartete Effekte haben.
- Empfehlung:
  - `TRUST_PROXY` Konfigflag, default: `false` (oder heuristisch nur in Docker/behind-proxy).
  - Cookie `secure` idealerweise über Fastify `request.protocol` + korrekt konfigurierten `trustProxy` ermitteln.

#### P2 – Mittel

5) **Settings API ist sehr frei**

- `PUT /api/settings/:key` akzeptiert beliebige JSON Bodies und `:key` ist nicht validiert.
- Empfehlung:
  - `params` Schema: erlaubte key-Pattern (z.B. `^[a-z0-9_\-]{1,64}$`).
  - Optional: Allowlist bekannter keys.

6) **Secrets API ohne explizites Rate-Limit/Schema-Härtung**

- `PUT /api/secrets/:name` hat Schema, aber kein rateLimit.
- Empfehlung:
  - Rate-Limit hinzufügen.
  - Audit/Logging vermeiden: keine Secret Values loggen.

## Code-Qualität (Server)

- Positiv: Viele Endpoints nutzen bereits rateLimit + `requireAdmin`.
- Verbesserungspunkte:
  - Konsistente Schema-Validierung (params/query/body) über alle Routes.
  - Mehr modulare Helper-Funktionen für DB-Hotpaths (Batching, Paging).
  - Einheitliches Error-Handling (Fastify error handler) + stabile Error Codes.

## Performance

### Server

- Hotspots typischerweise:
  - Query Logs: ingest + aggregations (`metrics/*`).
  - DNS pipeline: matching/rules + logging.

Empfehlungen:

- **DB Indizes** prüfen/ergänzen: `query_logs(ts)` und ggf. JSONB indexes je nach Queries.
- `query_logs/ingest`: Batch Insert.
- Aggregations: ggf. Materialized views / Pre-aggregation (optional, wenn scale).

### Frontend

- Aktionspunkte (typisch für React/Context):
  - Re-render Hotspots in Contexts (Clients/Rules).
  - Virtualisierung bei langen Listen (Query Logs).
  - Memoization der teuren Map/Chart Komponenten.

Zusätzliches Finding (Correctness/Dev-UX):

- API Calls werden im Frontend teils direkt via `fetch('/api/...')` gemacht.
- Für Cookie-basierte Sessions über **Cross-Origin** (z.B. Dev UI `localhost:3000` → API `localhost:8080`) braucht es konsistent `credentials: 'include'`.
- Empfehlung: zentrale `apiFetch()`-Helper-Funktion in `web/src/services/apiClient.ts`, die standardmäßig `credentials: 'include'` setzt, und Nutzung im gesamten Frontend vereinheitlichen.

## Observability / Messbarkeit

- Server:
  - Request-Logging (bereits vorhanden), ergänzt um correlation id.
  - Optional: Prometheus Metrics (wenn gewünscht) oder zumindest strukturierte Logs.

- Frontend:
  - Web Vitals / Performance marks für Query Logs rendering.

## Nächste Schritte

- Aus diesem Audit: priorisierte Fix-Liste (P0/P1 zuerst) + Tests.
- Siehe Testfall-Katalog in `docs/TEST_CASES.md`.
