import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Db } from '../db.js';
import { generateSessionId, getAdminCookieName, hashSessionId, isAdmin, requireAdmin } from '../auth.js';
import { hashPassword, verifyPassword, type PasswordHashRecord } from '../authPassword.js';
import { addAdminSession, getAuthValue, removeAdminSession, setAdminUser, updateAdminPassword } from '../authStore.js';

const cookieName = getAdminCookieName();
const cookieOptionsBase = {
  httpOnly: true,
  sameSite: 'strict' as const,
  path: '/',
  maxAge: 60 * 60 * 24 * 30
};

function isHttps(request: FastifyRequest): boolean {
  const xf = String(request.headers['x-forwarded-proto'] ?? '').split(',')[0].trim().toLowerCase();
  if (xf === 'https') return true;
  const proto = (request as any).protocol as string | undefined;
  return proto === 'https';
}

function cookieOptionsFor(request: FastifyRequest) {
  return { ...cookieOptionsBase, secure: isHttps(request) };
}

export async function registerAuthRoutes(app: FastifyInstance, _config: unknown, db: Db): Promise<void> {
  app.get('/api/auth/status', async () => {
    const auth = await getAuthValue(db);
    return { configured: !!auth.adminUser };
  });

  app.get('/api/auth/me', async (request: FastifyRequest) => {
    const auth = await getAuthValue(db);
    const loggedIn = await isAdmin(db, request);
    return { loggedIn, username: loggedIn ? auth.adminUser?.username : undefined };
  });

  app.post(
    '/api/auth/setup',
    {
      config: { rateLimit: { max: 5, timeWindow: '15 minutes' } },
      schema: {
        body: {
          type: 'object',
          required: ['username', 'password'],
          properties: {
            username: { type: 'string', minLength: 1, maxLength: 64 },
            password: { type: 'string', minLength: 8, maxLength: 1024 }
          }
        }
      }
    },
    async (request: FastifyRequest<{ Body: { username: string; password: string } }>, reply: FastifyReply) => {
      const auth = await getAuthValue(db);
      if (auth.adminUser) {
        reply.code(409);
        return { error: 'ALREADY_CONFIGURED' };
      }

      const username = request.body.username.trim();
      if (!username) {
        reply.code(400);
        return { error: 'INVALID_USERNAME' };
      }

      const passwordHash = hashPassword(request.body.password);
      await setAdminUser(db, { username, password: passwordHash });

      const sessionId = generateSessionId();
      const now = new Date().toISOString();
      await addAdminSession(db, { idHashB64: hashSessionId(sessionId), createdAt: now, lastSeenAt: now });
      reply.setCookie(cookieName, sessionId, cookieOptionsFor(request));
      return { ok: true };
    }
  );

  app.post(
    '/api/auth/login',
    {
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
      schema: {
        body: {
          type: 'object',
          required: ['username', 'password'],
          properties: {
            username: { type: 'string', minLength: 1, maxLength: 64 },
            password: { type: 'string', minLength: 1, maxLength: 1024 }
          }
        }
      }
    },
    async (request: FastifyRequest<{ Body: { username: string; password: string } }>, reply: FastifyReply) => {
      const auth = await getAuthValue(db);
      const user = auth.adminUser;
      const rec = user?.password as PasswordHashRecord | undefined;
      if (!user || !rec) {
        reply.code(409);
        return { error: 'NOT_CONFIGURED', message: 'Admin user not configured yet.' };
      }

      if (user.username !== request.body.username.trim()) {
        reply.code(401);
        return { error: 'INVALID_CREDENTIALS' };
      }

      const ok = verifyPassword(request.body.password, rec);
      if (!ok) {
        reply.code(401);
        return { error: 'INVALID_CREDENTIALS' };
      }

      const sessionId = generateSessionId();
      const now = new Date().toISOString();
      await addAdminSession(db, { idHashB64: hashSessionId(sessionId), createdAt: now, lastSeenAt: now });
      reply.setCookie(cookieName, sessionId, cookieOptionsFor(request));
      return { ok: true };
    }
  );

  app.post(
    '/api/auth/change-password',
    {
      config: { rateLimit: { max: 5, timeWindow: '15 minutes' } },
      schema: {
        body: {
          type: 'object',
          required: ['currentPassword', 'newPassword'],
          properties: {
            currentPassword: { type: 'string', minLength: 1, maxLength: 1024 },
            newPassword: { type: 'string', minLength: 8, maxLength: 1024 }
          }
        }
      }
    },
    async (
      request: FastifyRequest<{ Body: { currentPassword: string; newPassword: string } }>,
      reply: FastifyReply
    ) => {
      await requireAdmin(db, request);

      const auth = await getAuthValue(db);
      const user = auth.adminUser;
      const rec = user?.password as PasswordHashRecord | undefined;
      if (!user || !rec) {
        reply.code(409);
        return { error: 'NOT_CONFIGURED' };
      }

      const ok = verifyPassword(request.body.currentPassword, rec);
      if (!ok) {
        reply.code(401);
        return { error: 'INVALID_CREDENTIALS', message: 'Current password is incorrect.' };
      }

      const nextHash = hashPassword(request.body.newPassword);
      // Rotate sessions (log out other browsers) and issue a new session for this browser.
      await updateAdminPassword(db, nextHash, { clearSessions: true });
      const sessionId = generateSessionId();
      const now = new Date().toISOString();
      await addAdminSession(db, { idHashB64: hashSessionId(sessionId), createdAt: now, lastSeenAt: now });
      reply.setCookie(cookieName, sessionId, cookieOptionsFor(request));
      return { ok: true };
    }
  );

  app.post('/api/auth/logout', async (request: FastifyRequest, reply: FastifyReply) => {
    const sessionId = (request as any).cookies?.[cookieName] as string | undefined;
    if (sessionId) {
      await removeAdminSession(db, hashSessionId(sessionId));
    }
    reply.clearCookie(cookieName, { path: '/' });
    return { ok: true };
  });
}
