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
