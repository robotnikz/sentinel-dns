import { describe, expect, it, vi } from 'vitest';

describe('unit: maintenance jobs', () => {
  it('runs retention deletes when enabled', async () => {
    const { startMaintenanceJobs } = await import('../../src/maintenance.js');

    const db = {
      pool: {
        query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 })
      }
    } as any;

    const config = {
      NODE_ENV: 'production',
      QUERY_LOGS_RETENTION_DAYS: 7,
      MAINTENANCE_INTERVAL_MINUTES: 60
    } as any;

    const timeoutSpy = vi.spyOn(globalThis, 'setTimeout');
    const intervalSpy = vi.spyOn(globalThis, 'setInterval');

    const handle = startMaintenanceJobs(config, db);

    expect(timeoutSpy).toHaveBeenCalled();
    expect(intervalSpy).toHaveBeenCalled();

    // Trigger the initial run callback immediately
    const initialCb = (timeoutSpy.mock.calls[0] as any)[0] as Function;
    await initialCb();

    expect(db.pool.query).toHaveBeenCalled();

    const calls = (db.pool.query as any).mock.calls.map((c: any[]) => String(c[0]));
    expect(calls.some((sql: string) => sql.includes('DELETE FROM query_logs'))).toBe(true);
    expect(calls.some((sql: string) => sql.includes('DELETE FROM ignored_anomalies'))).toBe(true);

    await handle.close();

    timeoutSpy.mockRestore();
    intervalSpy.mockRestore();
  });

  it('does nothing in test env (no timers)', async () => {
    const { startMaintenanceJobs } = await import('../../src/maintenance.js');

    const db = {
      pool: {
        query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 })
      }
    } as any;

    const config = {
      NODE_ENV: 'test',
      QUERY_LOGS_RETENTION_DAYS: 7,
      MAINTENANCE_INTERVAL_MINUTES: 60
    } as any;

    const timeoutSpy = vi.spyOn(globalThis, 'setTimeout');
    const intervalSpy = vi.spyOn(globalThis, 'setInterval');

    const handle = startMaintenanceJobs(config, db);
    await handle.close();

    expect(timeoutSpy).not.toHaveBeenCalled();
    expect(intervalSpy).not.toHaveBeenCalled();
    expect(db.pool.query).not.toHaveBeenCalled();

    timeoutSpy.mockRestore();
    intervalSpy.mockRestore();
  });
});
