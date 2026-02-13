import type { Db } from '../db.js';
import { Readable } from 'node:stream';

function normalizeDomain(input: string): string | null {
  const d = input.trim().toLowerCase();
  if (!d) return null;
  const noDot = d.endsWith('.') ? d.slice(0, -1) : d;
  if (noDot.length < 1 || noDot.length > 253) return null;
  if (!noDot.includes('.')) return null;
  if (!/^[a-z0-9.-]+$/.test(noDot)) return null;
  if (noDot.startsWith('-') || noDot.endsWith('-')) return null;
  if (noDot.includes('..')) return null;
  return noDot;
}

function isLocalhostDomain(domain: string): boolean {
  return domain === 'localhost' || domain.endsWith('.localhost');
}

function tryExtractDomainFromAdblock(line: string): string | null {
  // Ignore exception rules
  if (line.startsWith('@@')) return null;

  // Ignore cosmetic filters (not network blocking)
  if (line.includes('##') || line.includes('#@#') || line.includes('#?#')) return null;

  // Remove options (everything after $)
  const withoutOptions = (() => {
    const idx = line.indexOf('$');
    return idx >= 0 ? line.slice(0, idx) : line;
  })().trim();

  if (withoutOptions.startsWith('||')) {
    let rest = withoutOptions.slice(2);
    rest = rest.replace(/^\*\.?/, '');

    const stopIdx = (() => {
      const candidates = [rest.indexOf('^'), rest.indexOf('/'), rest.indexOf(':')].filter((i) => i >= 0);
      return candidates.length ? Math.min(...candidates) : -1;
    })();

    const host = (stopIdx >= 0 ? rest.slice(0, stopIdx) : rest).trim();
    if (!host) return null;
    return normalizeDomain(host);
  }

  if (withoutOptions.startsWith('|http://') || withoutOptions.startsWith('|https://')) {
    const urlStr = withoutOptions.slice(1);
    try {
      const u = new URL(urlStr);
      return normalizeDomain(u.hostname);
    } catch {
      return null;
    }
  }

  if (withoutOptions.startsWith('http://') || withoutOptions.startsWith('https://')) {
    try {
      const u = new URL(withoutOptions);
      return normalizeDomain(u.hostname);
    } catch {
      return null;
    }
  }

  return null;
}

function extractDomainFromLine(raw: string): string | null {
  const line = raw.trim();
  if (!line) return null;
  if (line.startsWith('#') || line.startsWith('!') || line.startsWith('//')) return null;

  const hash = line.indexOf('#');
  const cleaned = hash >= 0 ? line.slice(0, hash).trim() : line;
  if (!cleaned) return null;

  const adblockDomain = tryExtractDomainFromAdblock(cleaned);
  if (adblockDomain) return isLocalhostDomain(adblockDomain) ? null : adblockDomain;

  // hosts-style: "0.0.0.0 example.com" or plain domains
  const parts = cleaned.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return null;
  const candidate = parts.length >= 2 ? parts[1] : parts[0];
  const domain = normalizeDomain(candidate);
  if (!domain) return null;
  return isLocalhostDomain(domain) ? null : domain;
}

async function downloadText(url: string, timeoutMs: number, maxBytes: number): Promise<string> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: { 'user-agent': 'sentinel-dns/0.1' },
      signal: ac.signal
    });
    if (!res.ok) throw new Error(`HTTP_${res.status}`);

    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > maxBytes) throw new Error('TOO_LARGE');
    return buf.toString('utf8');
  } finally {
    clearTimeout(timer);
  }
}

async function* downloadLines(url: string, timeoutMs: number, maxBytes: number): AsyncGenerator<string> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: { 'user-agent': 'sentinel-dns/0.1' },
      signal: ac.signal
    });
    if (!res.ok) throw new Error(`HTTP_${res.status}`);

    // Prefer streaming to keep memory bounded.
    const body: any = (res as any).body;
    if (!body) {
      const text = await downloadText(url, timeoutMs, maxBytes);
      for (const line of text.split(/\r?\n/)) yield line;
      return;
    }

    const decoder = new TextDecoder('utf-8');
    let buffered = '';
    let seenBytes = 0;

    // Node/undici: Response.body can be a WHATWG ReadableStream. Convert when needed.
    const nodeStream: NodeJS.ReadableStream =
      typeof body.getReader === 'function' ? Readable.fromWeb(body as ReadableStream<Uint8Array>) : (body as NodeJS.ReadableStream);

    for await (const chunk of nodeStream as any) {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      seenBytes += buf.length;
      if (seenBytes > maxBytes) throw new Error('TOO_LARGE');

      buffered += decoder.decode(buf, { stream: true });
      let idx: number;
      while ((idx = buffered.indexOf('\n')) >= 0) {
        let line = buffered.slice(0, idx);
        buffered = buffered.slice(idx + 1);
        if (line.endsWith('\r')) line = line.slice(0, -1);
        yield line;
      }
    }

    buffered += decoder.decode();
    if (buffered.length) yield buffered.endsWith('\r') ? buffered.slice(0, -1) : buffered;
  } finally {
    clearTimeout(timer);
  }
}

export async function refreshBlocklist(
  db: Db,
  input: { id: number; name: string; url: string },
  opts?: { timeoutMs?: number; maxBytes?: number }
): Promise<{ fetched: number }> {
  const timeoutMs = opts?.timeoutMs ?? 15_000;
  const maxBytes = opts?.maxBytes ?? 25 * 1024 * 1024;

  // IMPORTANT: keep this stable. Older versions used `Blocklist:<id>:<name>`
  // which breaks deletes after renames and slows lookups.
  const category = `Blocklist:${input.id}`;

  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');

    // Backward-compatible cleanup for legacy categories (Blocklist:<id>:<name>).
    await client.query(
      "DELETE FROM rules WHERE type = 'BLOCKED' AND (category = $1 OR category LIKE ($1 || ':%'))",
      [category]
    );

    const chunkSize = 5000;
    let inserted = 0;
    let chunk: string[] = [];

    const flush = async (): Promise<void> => {
      if (!chunk.length) return;
      const res = await client.query(
        `INSERT INTO rules(domain, type, category)
         SELECT d, 'BLOCKED', $2 FROM unnest($1::text[]) AS d
         ON CONFLICT (domain, type, category) DO NOTHING`,
        [chunk, category]
      );
      inserted += Number(res.rowCount ?? 0);
      chunk = [];
    };

    // Parse and insert incrementally to keep memory bounded.
    for await (const line of downloadLines(input.url, timeoutMs, maxBytes)) {
      const domain = extractDomainFromLine(line);
      if (!domain) continue;
      chunk.push(domain);
      if (chunk.length >= chunkSize) await flush();
    }
    await flush();

    await client.query(
      'UPDATE blocklists SET last_updated_at = NOW(), last_error = NULL, last_rule_count = $2, updated_at = NOW() WHERE id = $1',
      [input.id, inserted]
    );

    await client.query('COMMIT');
    return { fetched: inserted };
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}
