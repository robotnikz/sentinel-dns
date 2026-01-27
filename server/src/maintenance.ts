import type { AppConfig } from './config.js';
import type { Db } from './db.js';

export type MaintenanceHandle = {
  close: () => Promise<void>;
};

export function startMaintenanceJobs(config: AppConfig, db: Db): MaintenanceHandle {
  // Avoid background timers in unit/integration tests.
  if (config.NODE_ENV === 'test') {
    return { close: async () => undefined };
  }

  const retentionDaysRaw = Number(config.QUERY_LOGS_RETENTION_DAYS ?? 0);
  const retentionDays = Number.isFinite(retentionDaysRaw) ? Math.max(0, Math.floor(retentionDaysRaw)) : 0;

  const intervalMinutesRaw = Number(config.MAINTENANCE_INTERVAL_MINUTES ?? 60);
  const intervalMinutes = Number.isFinite(intervalMinutesRaw) ? Math.max(1, Math.floor(intervalMinutesRaw)) : 60;

  const runOnce = async () => {
    try {
      // Best-effort: delete old query logs to prevent unbounded DB growth.
      if (retentionDays > 0) {
        await db.pool.query(`DELETE FROM query_logs WHERE ts < NOW() - ($1::text || ' days')::interval`, [
          String(retentionDays)
        ]);
      }

      // Keep ignored anomalies bounded too (matches UI behavior).
      await db.pool.query("DELETE FROM ignored_anomalies WHERE ignored_at < NOW() - interval '30 days'");
    } catch {
      // ignore
    }
  };

  // First run shortly after startup (avoid impacting boot latency).
  const initial = setTimeout(() => void runOnce(), 15_000);
  const interval = setInterval(() => void runOnce(), intervalMinutes * 60_000);

  // Don't keep the process alive solely due to maintenance timers.
  initial.unref?.();
  interval.unref?.();

  return {
    close: async () => {
      clearTimeout(initial);
      clearInterval(interval);
    }
  };
}
