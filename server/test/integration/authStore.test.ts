import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb } from '../../src/db.js';
import { hashPassword } from '../../src/authPassword.js';
import {
  addAdminSession,
  getAuthValue,
  removeAdminSession,
  setAdminUser,
  touchAdminSession,
  updateAdminPassword
} from '../../src/authStore.js';
import { hasDocker, startPostgresContainer } from './_harness.js';

describe('integration: authStore', () => {
  let dockerOk = false;
  let pg: Awaited<ReturnType<typeof startPostgresContainer>> | null = null;
  let db: ReturnType<typeof createDb> | null = null;

  beforeAll(async () => {
    dockerOk = await hasDocker();
    if (!dockerOk) return;

    pg = await startPostgresContainer();
    db = createDb({ DATABASE_URL: pg.databaseUrl } as any);
    await db.init();
  }, 120_000);

  afterAll(async () => {
    await db?.pool.end().catch(() => undefined);
    await pg?.stop().catch(() => undefined);
  }, 120_000);

  it('skips if Docker is unavailable', async () => {
    if (!dockerOk) {
      expect(dockerOk).toBe(false);
      return;
    }
    expect(dockerOk).toBe(true);
  });

  it('supports backward-compat adminPassword shape', async () => {
    if (!dockerOk || !db) return;

    await db.pool.query('DELETE FROM settings');
    await db.pool.query('INSERT INTO settings(key, value) VALUES ($1, $2)', [
      'auth_admin',
      { adminPassword: hashPassword('pw-old'), sessions: [] }
    ]);

    const v = await getAuthValue(db);
    expect(v.adminUser?.username).toBe('admin');
    expect(v.adminUser?.password).toHaveProperty('scheme', 'scrypt');
    expect(Array.isArray(v.sessions)).toBe(true);
  });

  it('setAdminUser preserves existing sessions', async () => {
    if (!dockerOk || !db) return;

    await db.pool.query('DELETE FROM settings');

    await db.pool.query('INSERT INTO settings(key, value) VALUES ($1, $2)', [
      'auth_admin',
      {
        adminUser: { username: 'admin', password: hashPassword('pw') },
        sessions: [
          { idHashB64: 'a', createdAt: new Date(0).toISOString(), lastSeenAt: new Date(0).toISOString() }
        ]
      }
    ]);

    await setAdminUser(db, { username: 'root', password: hashPassword('new') });
    const v = await getAuthValue(db);

    expect(v.adminUser?.username).toBe('root');
    expect(v.sessions?.map((s) => s.idHashB64)).toEqual(['a']);
  });

  it('addAdminSession de-dupes and truncates', async () => {
    if (!dockerOk || !db) return;

    await db.pool.query('DELETE FROM settings');
    await setAdminUser(db, { username: 'admin', password: hashPassword('pw') });

    const now = new Date().toISOString();

    await addAdminSession(db, { idHashB64: '1', createdAt: now, lastSeenAt: now }, 2);
    await addAdminSession(db, { idHashB64: '2', createdAt: now, lastSeenAt: now }, 2);
    await addAdminSession(db, { idHashB64: '1', createdAt: now, lastSeenAt: now }, 2); // move to front

    let v = await getAuthValue(db);
    expect(v.sessions?.map((s) => s.idHashB64)).toEqual(['1', '2']);

    await addAdminSession(db, { idHashB64: '3', createdAt: now, lastSeenAt: now }, 2);
    v = await getAuthValue(db);
    expect(v.sessions?.map((s) => s.idHashB64)).toEqual(['3', '1']);
  });

  it('touchAdminSession updates lastSeenAt only for existing session', async () => {
    if (!dockerOk || !db) return;

    await db.pool.query('DELETE FROM settings');
    await setAdminUser(db, { username: 'admin', password: hashPassword('pw') });

    const createdAt = new Date(0).toISOString();
    await addAdminSession(db, { idHashB64: 'x', createdAt, lastSeenAt: createdAt }, 10);

    await touchAdminSession(db, 'missing');
    let v = await getAuthValue(db);
    expect(v.sessions?.find((s) => s.idHashB64 === 'x')?.lastSeenAt).toBe(createdAt);

    await touchAdminSession(db, 'x');
    v = await getAuthValue(db);
    expect(v.sessions?.find((s) => s.idHashB64 === 'x')?.lastSeenAt).not.toBe(createdAt);
  });

  it('updateAdminPassword clears sessions by default (and can keep them)', async () => {
    if (!dockerOk || !db) return;

    await db.pool.query('DELETE FROM settings');
    await setAdminUser(db, { username: 'admin', password: hashPassword('pw') });

    const now = new Date().toISOString();
    await addAdminSession(db, { idHashB64: 's1', createdAt: now, lastSeenAt: now }, 10);

    await updateAdminPassword(db, hashPassword('pw2'));
    let v = await getAuthValue(db);
    expect(v.sessions?.length).toBe(0);

    await addAdminSession(db, { idHashB64: 's2', createdAt: now, lastSeenAt: now }, 10);
    await updateAdminPassword(db, hashPassword('pw3'), { clearSessions: false });
    v = await getAuthValue(db);
    expect(v.sessions?.map((s) => s.idHashB64)).toEqual(['s2']);
  });

  it('removeAdminSession deletes only the target session', async () => {
    if (!dockerOk || !db) return;

    await db.pool.query('DELETE FROM settings');
    await setAdminUser(db, { username: 'admin', password: hashPassword('pw') });

    const now = new Date().toISOString();
    await addAdminSession(db, { idHashB64: 'a', createdAt: now, lastSeenAt: now }, 10);
    await addAdminSession(db, { idHashB64: 'b', createdAt: now, lastSeenAt: now }, 10);

    await removeAdminSession(db, 'a');
    const v = await getAuthValue(db);
    expect(v.sessions?.map((s) => s.idHashB64)).toEqual(['b']);
  });
});
