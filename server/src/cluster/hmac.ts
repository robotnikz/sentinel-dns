import crypto from 'node:crypto';

export type ClusterAuthHeaders = {
  'x-sentinel-ts': string;
  'x-sentinel-nonce': string;
  'x-sentinel-sig': string;
};

function sha256Hex(input: string): string {
  return crypto.createHash('sha256').update(input, 'utf8').digest('hex');
}

function hmacB64Url(secret: string, payload: string): string {
  return crypto.createHmac('sha256', secret).update(payload, 'utf8').digest('base64url');
}

export function signClusterRequest(opts: {
  secret: string;
  method: string;
  path: string;
  body: unknown;
  tsMs?: number;
  nonce?: string;
}): ClusterAuthHeaders {
  const tsMs = Number.isFinite(opts.tsMs) ? (opts.tsMs as number) : Date.now();
  const nonce = opts.nonce || crypto.randomBytes(12).toString('base64url');
  const bodyJson = opts.body ? JSON.stringify(opts.body) : '';
  const bodyHash = sha256Hex(bodyJson);
  const payload = `${tsMs}\n${nonce}\n${opts.method.toUpperCase()}\n${opts.path}\n${bodyHash}`;
  const sig = hmacB64Url(opts.secret, payload);

  return {
    'x-sentinel-ts': String(tsMs),
    'x-sentinel-nonce': nonce,
    'x-sentinel-sig': sig
  };
}

export function verifyClusterRequest(opts: {
  secret: string;
  method: string;
  path: string;
  body: unknown;
  tsHeader?: string;
  nonceHeader?: string;
  sigHeader?: string;
  maxSkewMs?: number;
}): { ok: true } | { ok: false; error: string } {
  const maxSkewMs = opts.maxSkewMs ?? 60_000;

  const tsMs = Number(opts.tsHeader || '');
  if (!Number.isFinite(tsMs) || tsMs <= 0) return { ok: false, error: 'BAD_TS' };
  const now = Date.now();
  if (Math.abs(now - tsMs) > maxSkewMs) return { ok: false, error: 'TS_SKEW' };

  const nonce = String(opts.nonceHeader || '').trim();
  if (!nonce) return { ok: false, error: 'NO_NONCE' };

  const sig = String(opts.sigHeader || '').trim();
  if (!sig) return { ok: false, error: 'NO_SIG' };

  const bodyJson = opts.body ? JSON.stringify(opts.body) : '';
  const bodyHash = sha256Hex(bodyJson);
  const payload = `${tsMs}\n${nonce}\n${opts.method.toUpperCase()}\n${opts.path}\n${bodyHash}`;
  const expected = hmacB64Url(opts.secret, payload);

  try {
    const ok = crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(sig));
    return ok ? { ok: true } : { ok: false, error: 'BAD_SIG' };
  } catch {
    return { ok: false, error: 'BAD_SIG' };
  }
}
