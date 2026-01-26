import crypto from 'node:crypto';
import type { FastifyRequest } from 'fastify';
import type { Db } from './db.js';
import { getAuthValue, touchAdminSession } from './authStore.js';

const ADMIN_SESSION_COOKIE = 'sentinel_session';

export function getAdminCookieName(): string {
  return ADMIN_SESSION_COOKIE;
}

function sha256B64(input: string): string {
  return crypto.createHash('sha256').update(input, 'utf8').digest('base64');
}

function getSessionIdFromRequest(request: FastifyRequest): string {
  const cookies = (request as any).cookies as Record<string, string> | undefined;
  return cookies?.[ADMIN_SESSION_COOKIE] || '';
}

export async function isAdmin(db: Db, request: FastifyRequest): Promise<boolean> {
  const auth = await getAuthValue(db);
  if (!auth.adminUser) return false;

  const sessionId = getSessionIdFromRequest(request);
  if (!sessionId) return false;

  const idHashB64 = sha256B64(sessionId);
  const sessions = Array.isArray(auth.sessions) ? auth.sessions : [];
  const ok = sessions.some((s) => s?.idHashB64 === idHashB64);
  if (ok) {
    // Best-effort: keep lastSeen reasonably up to date.
    void touchAdminSession(db, idHashB64).catch(() => undefined);
  }
  return ok;
}

export async function requireAdmin(db: Db, request: FastifyRequest): Promise<void> {
  const ok = await isAdmin(db, request);
  if (!ok) {
    const err = new Error('Unauthorized');
    // @ts-expect-error Fastify will map this
    err.statusCode = 401;
    throw err;
  }
}

export function hashSessionId(sessionId: string): string {
  return sha256B64(sessionId);
}

export function generateSessionId(): string {
  return crypto.randomBytes(32).toString('base64url');
}
