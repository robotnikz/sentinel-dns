import { z } from 'zod';
import dotenv from 'dotenv';
import fs from 'node:fs';
import path from 'node:path';
import { loadOrCreatePersistedSecrets } from './persistedConfig.js';

dotenv.config({ path: process.env.DOTENV_CONFIG_PATH || undefined });

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).optional().default('development'),
  HOST: z.string().optional().default('0.0.0.0'),
  PORT: z.coerce.number().int().positive().optional().default(8080),

  // Used in single-container mode to persist generated config.
  DATA_DIR: z.string().optional().default('/data'),

  DNS_HOST: z.string().optional().default('0.0.0.0'),
  DNS_PORT: z.coerce.number().int().positive().optional().default(53),
  UPSTREAM_DNS: z.string().optional().default('127.0.0.1:5335'),
  ENABLE_DNS: z.coerce.boolean().optional().default(true),

  // DNS forwarding timeouts (ms). Tune when upstream networks are slow/filtered.
  DNS_FORWARD_UDP_TIMEOUT_MS: z.coerce.number().int().min(250).optional().default(2000),
  DNS_FORWARD_TCP_TIMEOUT_MS: z.coerce.number().int().min(250).optional().default(4000),
  DNS_FORWARD_DOT_TIMEOUT_MS: z.coerce.number().int().min(250).optional().default(4000),
  DNS_FORWARD_DOH_TIMEOUT_MS: z.coerce.number().int().min(250).optional().default(15000),

  // Prefer IPv4 when connecting to DoH endpoints (useful when IPv6 routing is slow/flaky).
  DNS_FORWARD_DOH_PREFER_IPV4: z.coerce.boolean().optional().default(true),

  // Optional: when a query is BLOCKED (we return NXDOMAIN), also resolve it upstream
  // only for analytics/logging so the World Map can show blocked destinations.
  // This will contact the upstream resolver for blocked domains.
  SHADOW_RESOLVE_BLOCKED: z.coerce.boolean().optional().default(true),

  FRONTEND_ORIGIN: z.string().optional().default('http://localhost:3000'),

  // If Sentinel is behind a reverse proxy (nginx/traefik/caddy), enable this so Fastify derives
  // protocol/host from X-Forwarded-* headers. Keep enabled by default for backward compatibility.
  TRUST_PROXY: z.coerce.boolean().optional().default(true),

  ADMIN_TOKEN: z.string().optional().default(''),

  DATABASE_URL: z.string().optional().default('postgres://sentinel:sentinel@localhost:5432/sentinel'),

  GEMINI_API_KEY: z.string().optional().default(''),

  // Path to a MaxMind GeoIP2/GeoLite2 mmdb file.
  // For point markers on the World Map, use a City database (GeoLite2-City.mmdb).
  // In single-container mode this is typically persisted in /data.
  GEOIP_DB_PATH: z.string().optional().default('/data/GeoLite2-City.mmdb'),

  // Used to encrypt secrets stored in the DB (Gemini/OpenAI keys, etc.).
  // Can be a passphrase; in production you should set this.
  SECRETS_KEY: z.string().optional().default(''),

  // Optional file path whose contents override cluster role: 'leader' or 'follower'.
  // Intended for keepalived/VRRP notify scripts to provide automatic role switching with a VIP.
  CLUSTER_ROLE_FILE: z.string().optional().default(''),

  // Performance/operations: keep query_logs bounded.
  // Set to 0 to disable retention.
  QUERY_LOGS_RETENTION_DAYS: z.coerce.number().int().min(0).optional().default(30),

  // Background maintenance frequency (cleanup queries, etc.).
  MAINTENANCE_INTERVAL_MINUTES: z.coerce.number().int().min(1).optional().default(60),

  // Short TTL cache for heavy metrics endpoints (server-side). Set to 0 to disable.
  METRICS_CACHE_TTL_MS: z.coerce.number().int().min(0).optional().default(2000)
});

export type AppConfig = z.infer<typeof schema>;

export function loadConfig(): AppConfig {
  const cfg = schema.parse(process.env);

  // Production must be secure-by-default without requiring users to hand-edit compose files.
  // In single-container mode we persist generated tokens in DATA_DIR (typically /data).
  if (cfg.NODE_ENV === 'production') {
    const persisted = loadOrCreatePersistedSecrets({
      dataDir: cfg.DATA_DIR,
      envAdminToken: cfg.ADMIN_TOKEN,
      envSecretsKey: cfg.SECRETS_KEY
    });

    cfg.ADMIN_TOKEN = persisted.adminToken;
    cfg.SECRETS_KEY = persisted.secretsKey;

    // Do not print ADMIN_TOKEN. UI-based password setup/login does not require copying tokens from logs.
  }

  // Best-effort migration: older installs used /data/GeoLite2-Country.mmdb.
  // If the config points to the City filename but only the legacy file exists,
  // move it so users don't lose GeoIP after upgrading.
  try {
    const expectedCityPath = path.join(cfg.DATA_DIR || '/data', 'GeoLite2-City.mmdb');
    const legacyCountryPath = path.join(cfg.DATA_DIR || '/data', 'GeoLite2-Country.mmdb');

    if (
      String(cfg.GEOIP_DB_PATH).trim() === expectedCityPath &&
      !fs.existsSync(expectedCityPath) &&
      fs.existsSync(legacyCountryPath)
    ) {
      fs.renameSync(legacyCountryPath, expectedCityPath);
    }
  } catch {
    // ignore
  }

  return cfg;
}

