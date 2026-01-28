export function getAdminToken(): string {
  // Cookie-based auth (HttpOnly) does not expose tokens to JS.
  return '';
}

export function setAdminToken(token: string): void {
  // No-op: we do not store admin tokens in the browser.
  void token;
}

export function getAuthHeaders(): Record<string, string> {
  // Auth is handled via HttpOnly cookie; no headers needed.
  return {};
}

export function apiFetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  // Default to include cookies even when UI and API are on different origins.
  // This is safe for same-origin usage too.
  const credentials = init.credentials ?? 'include';
  return fetch(input, { ...init, credentials });
}

export function installApiFetchDefaults(): void {
  // Ensure even direct fetch('/api/...') calls send cookies in cross-origin deployments.
  // We only affect same-origin relative /api URLs.
  if (typeof window === 'undefined') return;
  const w = window as any;
  if (w.__sentinelApiFetchShimInstalled) return;
  w.__sentinelApiFetchShimInstalled = true;

  const originalFetch: typeof fetch = window.fetch.bind(window);
  window.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    try {
      const url =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.toString()
            : (input as Request).url;

      if (typeof url === 'string' && url.startsWith('/api/')) {
        const credentials = init?.credentials ?? 'include';
        return originalFetch(input as any, { ...(init || {}), credentials });
      }
    } catch {
      // ignore
    }
    return originalFetch(input as any, init as any);
  }) as any;
}
