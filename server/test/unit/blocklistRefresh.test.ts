import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { refreshBlocklist } from '../../src/blocklists/refresh.js';

function createMockDb() {
  const inserted = new Set<string>();
  const queries: string[] = [];

  const client = {
    query: async (sql: string, params?: any[]) => {
      queries.push(sql);
      if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [], rowCount: 0 };

      if (sql.startsWith('DELETE FROM rules')) {
        inserted.clear();
        return { rows: [], rowCount: 0 };
      }

      if (sql.includes('INSERT INTO rules')) {
        const domains: string[] = Array.isArray(params?.[0]) ? params![0] : [];
        let added = 0;
        for (const d of domains) {
          const s = String(d);
          if (!inserted.has(s)) {
            inserted.add(s);
            added++;
          }
        }
        return { rows: [], rowCount: added };
      }

      if (sql.startsWith('UPDATE blocklists SET')) {
        return { rows: [], rowCount: 1 };
      }

      throw new Error(`Unexpected SQL in mock client: ${sql}`);
    },
    release: () => {}
  };

  const pool = {
    connect: async () => client
  };

  return { db: { pool } as any, inserted, queries };
}

function streamFromChunks(chunks: string[]) {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of chunks) controller.enqueue(new TextEncoder().encode(c));
      controller.close();
    }
  });
}

describe('refreshBlocklist (streaming)', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('parses domains from streamed response and inserts unique domains', async () => {
    const { db, inserted } = createMockDb();

    const body = streamFromChunks([
      '# comment\n',
      '0.0.0.0 example.com\n',
      '0.0.0.0 example.com\n',
      '||ads.example.net^\n',
      '@@||whitelist.example.org^\n',
      'localhost\n',
      '0.0.0.0 test.localhost\n',
      'badline\n'
    ]);

    globalThis.fetch = vi.fn(async () => {
      return new Response(body, { status: 200 });
    }) as any;

    const res = await refreshBlocklist(db, { id: 1, name: 'BL', url: 'https://example.invalid/list.txt' }, { maxBytes: 1024 });

    // example.com and ads.example.net are the only valid non-localhost domains.
    expect(res.fetched).toBe(2);
    expect(inserted.has('example.com')).toBe(true);
    expect(inserted.has('ads.example.net')).toBe(true);
  });
});
