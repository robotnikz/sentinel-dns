export function toBase64UrlJson(obj: unknown): string {
  const json = JSON.stringify(obj);
  return Buffer.from(json, 'utf8').toString('base64url');
}

export function fromBase64UrlJson<T>(token: string): T {
  const raw = Buffer.from(String(token || ''), 'base64url').toString('utf8');
  return JSON.parse(raw) as T;
}
