import type { Db } from './db.js';
import type { PasswordHashRecord } from './authPassword.js';

const AUTH_KEY = 'auth_admin';

export type AdminUserRecord = {
  username: string;
  password: PasswordHashRecord;
};

export type AdminSessionRecord = {
  idHashB64: string;
  createdAt: string;
  lastSeenAt: string;
};

export type AuthValue = {
  adminUser?: AdminUserRecord;
  sessions?: AdminSessionRecord[];
};

export async function getAuthValue(db: Db): Promise<AuthValue> {
  const res = await db.pool.query('SELECT value FROM settings WHERE key = $1', [AUTH_KEY]);
  const value = res.rows?.[0]?.value;
  if (!value || typeof value !== 'object') return {};

  const v: any = value;
  // Backward-compat: older versions stored { adminPassword } only.
  if (!v.adminUser && v.adminPassword) {
    return {
      adminUser: { username: 'admin', password: v.adminPassword as PasswordHashRecord },
      sessions: Array.isArray(v.sessions) ? (v.sessions as AdminSessionRecord[]) : []
    };
  }

  return value as AuthValue;
}

export async function setAdminUser(db: Db, user: AdminUserRecord): Promise<void> {
  const prev = await getAuthValue(db);
  const value: AuthValue = {
    adminUser: user,
    sessions: Array.isArray(prev.sessions) ? prev.sessions : []
  };

  await db.pool.query(
    'INSERT INTO settings(key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()',
    [AUTH_KEY, value]
  );
}

export async function updateAdminPassword(
  db: Db,
  password: PasswordHashRecord,
  opts?: { clearSessions?: boolean }
): Promise<void> {
  const prev = await getAuthValue(db);
  if (!prev.adminUser) return;

  const clearSessions = opts?.clearSessions !== false;
  const value: AuthValue = {
    adminUser: { ...prev.adminUser, password },
    sessions: clearSessions ? [] : (Array.isArray(prev.sessions) ? prev.sessions : [])
  };

  await db.pool.query(
    'INSERT INTO settings(key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()',
    [AUTH_KEY, value]
  );
}

export async function addAdminSession(db: Db, session: AdminSessionRecord, maxSessions = 10): Promise<void> {
  const prev = await getAuthValue(db);
  const sessions = Array.isArray(prev.sessions) ? prev.sessions : [];

  const next = [session, ...sessions.filter((s) => s?.idHashB64 !== session.idHashB64)].slice(0, maxSessions);
  const value: AuthValue = {
    adminUser: prev.adminUser,
    sessions: next
  };

  await db.pool.query(
    'INSERT INTO settings(key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()',
    [AUTH_KEY, value]
  );
}

export async function touchAdminSession(db: Db, idHashB64: string): Promise<void> {
  const prev = await getAuthValue(db);
  const sessions = Array.isArray(prev.sessions) ? prev.sessions : [];
  if (!sessions.some((s) => s?.idHashB64 === idHashB64)) return;

  const now = new Date().toISOString();
  const next = sessions.map((s) => (s?.idHashB64 === idHashB64 ? { ...s, lastSeenAt: now } : s));
  const value: AuthValue = { adminUser: prev.adminUser, sessions: next };

  await db.pool.query(
    'INSERT INTO settings(key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()',
    [AUTH_KEY, value]
  );
}

export async function removeAdminSession(db: Db, idHashB64: string): Promise<void> {
  const prev = await getAuthValue(db);
  const sessions = Array.isArray(prev.sessions) ? prev.sessions : [];
  const next = sessions.filter((s) => s?.idHashB64 !== idHashB64);
  const value: AuthValue = { adminUser: prev.adminUser, sessions: next };

  await db.pool.query(
    'INSERT INTO settings(key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()',
    [AUTH_KEY, value]
  );
}
