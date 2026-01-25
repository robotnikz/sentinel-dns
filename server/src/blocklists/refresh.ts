import type { Db } from '../db.js';

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

function extractDomainsFromText(text: string): string[] {
  const out: string[] = [];
  const lines = text.split(/\r?\n/);
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith('#') || line.startsWith('!') || line.startsWith('//')) continue;

    const hash = line.indexOf('#');
    const cleaned = hash >= 0 ? line.slice(0, hash).trim() : line;
    if (!cleaned) continue;

    const adblockDomain = tryExtractDomainFromAdblock(cleaned);
    if (adblockDomain) {
      if (adblockDomain === 'localhost' || adblockDomain.endsWith('.localhost')) continue;
      out.push(adblockDomain);
      continue;
    }

    const parts = cleaned.split(/\s+/).filter(Boolean);
    if (parts.length === 0) continue;

    const candidate = parts.length >= 2 ? parts[1] : parts[0];
    const domain = normalizeDomain(candidate);
    if (!domain) continue;
    if (domain === 'localhost' || domain.endsWith('.localhost')) continue;
    out.push(domain);
  }

  return Array.from(new Set(out));
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

export async function refreshBlocklist(
  db: Db,
  input: { id: number; name: string; url: string },
  opts?: { timeoutMs?: number; maxBytes?: number }
): Promise<{ fetched: number }> {
  const timeoutMs = opts?.timeoutMs ?? 15_000;
  const maxBytes = opts?.maxBytes ?? 25 * 1024 * 1024;

  const category = `Blocklist:${input.id}:${input.name}`;

  const text = await downloadText(input.url, timeoutMs, maxBytes);
  const domains = extractDomainsFromText(text);

  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');

    await client.query('DELETE FROM rules WHERE category = $1 AND type = $2', [category, 'BLOCKED']);

    const chunkSize = 5000;
    for (let i = 0; i < domains.length; i += chunkSize) {
      const chunk = domains.slice(i, i + chunkSize);
      await client.query(
        `INSERT INTO rules(domain, type, category)
         SELECT d, 'BLOCKED', $2 FROM unnest($1::text[]) AS d
         ON CONFLICT (domain, type, category) DO NOTHING`,
        [chunk, category]
      );
    }

    await client.query(
      'UPDATE blocklists SET last_updated_at = NOW(), last_error = NULL, last_rule_count = $2, updated_at = NOW() WHERE id = $1',
      [input.id, domains.length]
    );

    await client.query('COMMIT');
    return { fetched: domains.length };
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}
