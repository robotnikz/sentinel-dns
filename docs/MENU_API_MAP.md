# Sentinel DNS – UI Menu/Submenu → Backend/API Map

This document maps the visible UI menus/submenus (sidebar + settings tabs + header widgets) to backend endpoints and the main persistence/dependency surfaces.

## Header widgets (always visible)

### Protection dropdown
- API
  - `POST /api/protection/pause`
- Dependencies
  - Settings/state persisted server-side (see server `protection` routes)
  - Triggers bell-feed notifications (if enabled)

### Notifications bell
- API
  - `GET /api/notifications/feed?limit=...`
  - `GET /api/notifications/feed/unread-count`
  - `POST /api/notifications/feed/mark-read` (`{ all: true }` or `{ ids: number[] }`)
- Persistence
  - `notifications` table (`read` flag + `entry` JSON)

### Sidebar status area
- API
  - `GET /api/health`
  - `GET /api/version`
  - `GET /api/metrics/summary?hours=24`

## Sidebar → Pages

### Monitoring → Overview (Dashboard)
- API
  - `GET /api/metrics/summary?hours=24`
  - `GET /api/metrics/timeseries?hours=24`
  - `GET /api/metrics/top-domains?hours=24&limit=20`
  - `GET /api/metrics/top-blocked?hours=24&limit=20`
  - `GET /api/geo/countries?hours=24&limit=40`
  - `GET /api/query-logs?limit=500`
- Persistence
  - Query logs table (DNS traffic history)
  - Optional GeoIP DB file (`GEOIP_DB_PATH`) for map details

### Monitoring → Query Log
- API
  - `GET /api/query-logs?limit=500` (initial load)
  - `POST /api/ai/analyze-domain` (AI domain analysis)
  - Rule quick-actions use the Rules API via `RulesContext`:
    - `POST /api/rules` (quick block/allow)
- Dependencies
  - Optional AI secrets (`/api/secrets/*`) for AI analysis to work

### Monitoring → Network Map
- API
  - `GET /api/discovery/clients`
- Dependencies
  - Discovery subsystem (client identification)

### Controls → Filtering (Blocking)
- API
  - `GET /api/blocklists`
  - `POST /api/blocklists` / `PUT /api/blocklists/:id` / `DELETE /api/blocklists/:id` (list management)
  - `GET /api/settings` (loads global settings)
  - `PUT /api/settings/global_blocked_apps` (global blocked apps)
  - `GET /api/query-logs?limit=1000` (used for UI insights)
  - Rules API via `RulesContext`:
    - `GET /api/rules`
    - `POST /api/rules`
    - `DELETE /api/rules/:id`
- Persistence
  - `blocklists` tables/config
  - `rules` table
  - `settings` table

### Controls → Client Policies (Clients)
- API
  - `GET /api/settings`
  - `GET /api/blocklists`
  - `GET /api/discovery/clients?limit=200`
  - Clients API via `ClientsContext`:
    - `GET /api/clients`
    - `POST /api/clients`
    - `PUT /api/clients/:id`
    - `DELETE /api/clients/:id`
- Persistence
  - `clients` table
  - `settings` table

### Controls → Local DNS (DNS Settings)
- API
  - `GET /api/dns/settings`
  - `PUT /api/dns/settings`
  - `GET /api/dns/rewrites`
  - `POST /api/dns/rewrites`
  - `DELETE /api/dns/rewrites/:id`
  - `GET /api/discovery/settings`
  - `PUT /api/discovery/settings`
  - `POST /api/discovery/test-ptr`
- Dependencies
  - DNS server runtime (UDP/TCP resolver)
  - Optional discovery for PTR naming and client mapping

### System Settings
The UI uses `Settings2` with tabs.

#### AI Keys tab
- API
  - `GET /api/secrets/status`
  - `PUT /api/secrets/gemini_api_key`
  - `PUT /api/secrets/openai_api_key`
- Dependencies
  - Requires `SECRETS_KEY` configured to store encrypted secrets

#### GeoIP / World Map tab
- API
  - `GET /api/geoip/status`
  - `POST /api/geoip/update` (downloads MaxMind archive and installs `.mmdb`)
  - `PUT /api/secrets/maxmind_license_key`
- Dependencies
  - External network access to MaxMind (only when updating)
  - Local file storage at `GEOIP_DB_PATH`

#### Tailscale tab
- API
  - `GET /api/tailscale/status`
  - `POST /api/tailscale/auth-url`
  - `PUT /api/secrets/tailscale_auth_key`
  - `POST /api/tailscale/up`
  - `POST /api/tailscale/config`
  - `POST /api/tailscale/down`
- Dependencies
  - `tailscale` CLI available in container + `tailscaled` running with `/dev/net/tun` and `NET_ADMIN`

#### Notifications tab
- API
  - `PUT /api/settings/discord_webhook`
  - `POST /api/notifications/discord/test`
  - `PUT /api/settings/notification_events`
- Notes
  - Only `https://discord.com/api/webhooks/...` is accepted for the **TEST** endpoint.
  - Event toggles control eligibility for both Discord notifications and the bell feed.
