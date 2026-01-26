import { Pool } from 'pg';
import type { AppConfig } from './config.js';

export type Db = {
  pool: Pool;
  init: () => Promise<void>;
};

export function createDb(config: AppConfig): Db {
  const pool = new Pool({ connectionString: config.DATABASE_URL });

  async function init(): Promise<void> {
    const client = await pool.connect();
    try {
      await client.query(`
        CREATE TABLE IF NOT EXISTS settings (
          key TEXT PRIMARY KEY,
          value JSONB NOT NULL,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
      `);

      // dns_rewrites is stored in settings as JSON (no dedicated table).

      await client.query(`
        CREATE TABLE IF NOT EXISTS rules (
          id BIGSERIAL PRIMARY KEY,
          domain TEXT NOT NULL,
          type TEXT NOT NULL CHECK (type IN ('BLOCKED','ALLOWED')),
          category TEXT NOT NULL DEFAULT 'Manual',
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
      `);

      // Older databases used a UNIQUE(domain) constraint, which breaks overlapping
      // blocklists and per-client blocklist overrides. We now allow duplicates per
      // (domain,type,category) and enforce uniqueness on that tuple instead.
      await client.query('ALTER TABLE rules DROP CONSTRAINT IF EXISTS rules_domain_key');
      await client.query(
        'CREATE UNIQUE INDEX IF NOT EXISTS rules_domain_type_category_uidx ON rules (domain, type, category)'
      );

      await client.query(`
        CREATE TABLE IF NOT EXISTS clients (
          id TEXT PRIMARY KEY,
          profile JSONB NOT NULL,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
      `);

      await client.query(`
        CREATE TABLE IF NOT EXISTS query_logs (
          id BIGSERIAL PRIMARY KEY,
          ts TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          entry JSONB NOT NULL
        );
      `);

      // Suspicious activity ignores (signature-based) with retention.
      // UI uses this to suppress known-false-positive anomaly signatures across pages.
      await client.query(`
        CREATE TABLE IF NOT EXISTS ignored_anomalies (
          signature TEXT PRIMARY KEY,
          ignored_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
      `);

      await client.query(`
        CREATE TABLE IF NOT EXISTS notifications (
          id BIGSERIAL PRIMARY KEY,
          ts TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          read BOOLEAN NOT NULL DEFAULT FALSE,
          entry JSONB NOT NULL
        );
      `);

      await client.query(`
        CREATE TABLE IF NOT EXISTS blocklists (
          id BIGSERIAL PRIMARY KEY,
          name TEXT NOT NULL,
          url TEXT NOT NULL,
          enabled BOOLEAN NOT NULL DEFAULT TRUE,
          mode TEXT NOT NULL DEFAULT 'ACTIVE',
          last_updated_at TIMESTAMPTZ,
          last_error TEXT,
          last_rule_count INTEGER NOT NULL DEFAULT 0,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          UNIQUE(url)
        );
      `);

      // Backfill for older databases that were created before `mode` existed.
      await client.query("ALTER TABLE blocklists ADD COLUMN IF NOT EXISTS mode TEXT NOT NULL DEFAULT 'ACTIVE'");

      await client.query('CREATE INDEX IF NOT EXISTS query_logs_ts_idx ON query_logs (ts DESC)');
      await client.query('CREATE INDEX IF NOT EXISTS notifications_ts_idx ON notifications (ts DESC)');
      await client.query('CREATE INDEX IF NOT EXISTS notifications_unread_ts_idx ON notifications (read, ts DESC)');
      await client.query('CREATE INDEX IF NOT EXISTS ignored_anomalies_ignored_at_idx ON ignored_anomalies (ignored_at DESC)');
    } finally {
      client.release();
    }
  }

  return { pool, init };
}
