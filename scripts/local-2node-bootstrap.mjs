// Local helper to bootstrap the 2-node compose simulation.
// Usage: node scripts/local-2node-bootstrap.mjs

const ADMIN_USER = process.env.SENTINEL_ADMIN_USER || 'admin';
const ADMIN_PASS = process.env.SENTINEL_ADMIN_PASS || 'adminadmin';

const BASE_A = process.env.SENTINEL_A_URL || 'http://localhost:8081';
const BASE_B = process.env.SENTINEL_B_URL || 'http://localhost:8082';

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function pickSetCookie(headers) {
  // Prefer Node/undici API when available.
  if (typeof headers.getSetCookie === 'function') {
    const setCookies = headers.getSetCookie();
    const cookiePairs = (setCookies || [])
      .map((v) => String(v || '').split(';')[0].trim())
      .filter(Boolean);
    return cookiePairs.join('; ');
  }

  // Fallback: single header value.
  const raw = headers.get('set-cookie');
  if (!raw) return '';
  return String(raw).split(';')[0].trim();
}

async function httpJson(base, path, { method = 'GET', body, cookie } = {}) {
  const url = base.replace(/\/$/, '') + path;
  const headers = { 'accept': 'application/json' };
  if (cookie) headers.cookie = cookie;
  if (body !== undefined) headers['content-type'] = 'application/json';

  const res = await fetch(url, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined
  });

  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    // ignore
  }

  return {
    ok: res.ok,
    status: res.status,
    json,
    text,
    cookie: pickSetCookie(res.headers)
  };
}

async function ensureAdminSession(base) {
  const status = await httpJson(base, '/api/auth/status');
  if (!status.ok) throw new Error(`GET /api/auth/status failed on ${base}: ${status.status} ${status.text}`);

  if (!status.json?.configured) {
    const setup = await httpJson(base, '/api/auth/setup', {
      method: 'POST',
      body: { username: ADMIN_USER, password: ADMIN_PASS }
    });
    if (!setup.ok) throw new Error(`POST /api/auth/setup failed on ${base}: ${setup.status} ${setup.text}`);
    if (!setup.cookie) throw new Error(`No session cookie from /api/auth/setup on ${base}`);
    return setup.cookie;
  }

  const login = await httpJson(base, '/api/auth/login', {
    method: 'POST',
    body: { username: ADMIN_USER, password: ADMIN_PASS }
  });
  if (!login.ok) throw new Error(`POST /api/auth/login failed on ${base}: ${login.status} ${login.text}`);
  if (!login.cookie) throw new Error(`No session cookie from /api/auth/login on ${base}`);
  return login.cookie;
}

async function main() {
  console.log(`[bootstrap] A=${BASE_A}`);
  console.log(`[bootstrap] B=${BASE_B}`);

  const cookieA = await ensureAdminSession(BASE_A);
  const cookieB = await ensureAdminSession(BASE_B);

  console.log('[cluster] enable leader on A');
  const enable = await httpJson(BASE_A, '/api/cluster/enable-leader', {
    method: 'POST',
    cookie: cookieA,
    body: { leaderUrl: 'http://sentinel_a:8080' }
  });
  if (!enable.ok) throw new Error(`POST /api/cluster/enable-leader failed: ${enable.status} ${enable.text}`);

  console.log('[cluster] get join code from A');
  const jc = await httpJson(BASE_A, '/api/cluster/join-code', { cookie: cookieA });
  if (!jc.ok || !jc.json?.joinCode) throw new Error(`GET /api/cluster/join-code failed: ${jc.status} ${jc.text}`);

  console.log('[cluster] configure follower on B');
  const conf = await httpJson(BASE_B, '/api/cluster/configure-follower', {
    method: 'POST',
    cookie: cookieB,
    body: { joinCode: jc.json.joinCode }
  });
  if (!conf.ok) throw new Error(`POST /api/cluster/configure-follower failed: ${conf.status} ${conf.text}`);

  console.log('[cluster] wait for follower readiness');
  const deadline = Date.now() + 45_000;
  while (true) {
    const ready = await httpJson(BASE_B, '/api/cluster/ready');
    if (ready.ok && ready.json?.ok) {
      console.log(`[cluster] follower ready: ${JSON.stringify(ready.json)}`);
      break;
    }
    if (Date.now() > deadline) {
      throw new Error(`Follower never became ready. Last response: ${ready.status} ${ready.text}`);
    }
    await sleep(1500);
  }

  // Applying the leader snapshot can reset auth/session state on the follower.
  // Re-login before calling admin endpoints.
  const cookieBAfterSync = await ensureAdminSession(BASE_B);

  const statusA = await httpJson(BASE_A, '/api/cluster/status', { cookie: cookieA });
  const statusB = await httpJson(BASE_B, '/api/cluster/status', { cookie: cookieBAfterSync });

  console.log('[cluster] status A:');
  console.log(JSON.stringify(statusA.json, null, 2));
  console.log('[cluster] status B:');
  console.log(JSON.stringify(statusB.json, null, 2));

  console.log('[cluster] follower read-only guard check (POST /api/rules on B)');
  const ro = await httpJson(BASE_B, '/api/rules', {
    method: 'POST',
    cookie: cookieBAfterSync,
    body: { domain: 'example.com', type: 'BLOCKED', category: 'ReadOnlyTest' }
  });
  console.log(`[cluster] follower mutation result: HTTP ${ro.status} ${ro.text.slice(0, 200)}`);

  console.log('[bootstrap] done');
}

main().catch((e) => {
  console.error('[bootstrap] failed:', e?.message || e);
  process.exit(1);
});
