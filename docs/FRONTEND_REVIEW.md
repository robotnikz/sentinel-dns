# Frontend Review (Code Quality + Performance)

## Findings (P0–P2)

### P1 – Data fetching consistency
- **Issue**: Many code paths call `fetch('/api/...')` directly; cookie auth can break in cross-origin deployments.
- **Mitigation**: Centralize via `apiFetch()` and/or a fetch shim for relative `/api/*`.

### P1 – Polling overlaps / in-flight requests
- **Issue**: Polling views (Query Logs, Dashboard metrics) can overlap requests and update state after unmount.
- **Mitigation**: Use `AbortController` per effect/polling loop and abort on unmount.

### P2 – Test coverage for critical API glue
- **Issue**: Previously no tests for fetch shim + context loading.
- **Mitigation**: Add focused unit tests for `installApiFetchDefaults()` and `ClientsContext` initial load.

## Changes applied
- Query Logs + Dashboard: `apiFetch` + abort in-flight requests.
- ClientsContext: `apiFetch` + abort initial load.
- Unit tests: fetch shim behavior + ClientsContext load.

## Next (optional, nice-to-have)
- Replace remaining direct `fetch('/api/...')` calls with `apiFetch` (incrementally).
- Add React component tests for critical pages (Settings, DNS settings, Logs) for error states.
- Consider list virtualization for very large query log rendering (if the table becomes heavy at >1–5k rows).
