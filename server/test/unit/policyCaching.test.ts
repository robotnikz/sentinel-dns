import { describe, expect, it, beforeEach } from 'vitest';
import { __testing, domainPolicyCheck } from '../../src/dns/dnsServer.js';

type QueryResult = { rows: any[]; rowCount?: number };

function createMockDb() {
  let queryCount = 0;

  const pool = {
    query: async (sql: string, params?: any[]): Promise<QueryResult> => {
      queryCount++;

      // Clients
      if (sql.includes('FROM clients')) {
        return {
          rows: [
            {
              profile: {
                id: 'c1',
                name: 'Client 1',
                ip: '10.0.0.5',
                useGlobalSettings: true,
                useGlobalCategories: true,
                useGlobalApps: true,
                assignedBlocklists: []
              }
            }
          ]
        };
      }

      // Blocklists status
      if (sql.trim() === 'SELECT id, enabled, mode, name FROM blocklists') {
        return { rows: [{ id: 1, enabled: true, mode: 'ACTIVE', name: 'BL1' }] };
      }

      // Category/app URL resolution (we don't need any for this test)
      if (sql.startsWith('SELECT id, url, enabled FROM blocklists WHERE url = ANY')) {
        return { rows: [] };
      }

      // global_blocked_apps setting
      if (sql === 'SELECT value FROM settings WHERE key = $1' && Array.isArray(params) && params[0] === 'global_blocked_apps') {
        return { rows: [{ value: { blockedApps: [], shadowApps: [] } }] };
      }

      // Manual rules
      if (sql.includes('FROM rules') && sql.includes("category NOT LIKE 'Blocklist:%'")) {
        return { rows: [] };
      }

      // Blocklist rules lookup
      if (sql.includes('FROM rules') && sql.includes("type = 'BLOCKED'")) {
        return { rows: [{ domain: 'example.com', category: 'Blocklist:1' }] };
      }

      throw new Error(`Unexpected SQL in test mock: ${sql}`);
    }
  };

  return {
    db: { pool } as any,
    getQueryCount: () => queryCount
  };
}

describe('policy caching', () => {
  beforeEach(() => {
    __testing.resetPolicyCaches();
  });

  it('extractBlocklistId supports both Blocklist:<id> and legacy Blocklist:<id>:<name>', () => {
    expect(__testing.extractBlocklistId('Blocklist:12')).toBe('12');
    expect(__testing.extractBlocklistId('Blocklist:12:Some Name')).toBe('12');
    expect(__testing.extractBlocklistId('Nope:12')).toBeNull();
  });

  it('domainPolicyCheck reuses cached DB reads in bursts', async () => {
    const { db, getQueryCount } = createMockDb();

    const r1 = await domainPolicyCheck(db, 'example.com', { clientIp: '10.0.0.5' });
    expect(r1.decision).toBe('BLOCKED');

    const afterFirst = getQueryCount();
    expect(afterFirst).toBeGreaterThan(0);

    const r2 = await domainPolicyCheck(db, 'example.com', { clientIp: '10.0.0.5' });
    expect(r2.decision).toBe('BLOCKED');

    // Second call should hit caches (no additional SQL expected within TTL).
    expect(getQueryCount()).toBe(afterFirst);
  });
});
