import { spawn } from 'node:child_process';
import dgram from 'node:dgram';
import { createRequire } from 'node:module';

function run(cmd, args, { cwd } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd,
      stdio: 'inherit',
      shell: false,
      env: process.env
    });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${cmd} ${args.join(' ')} exited with code ${code}`));
    });
  });
}

async function sleep(ms) {
  await new Promise((r) => setTimeout(r, ms));
}

const require = createRequire(import.meta.url);
// Reuse the server dependency without adding it to the root package.
const dnsPacket = require('../server/node_modules/dns-packet');

async function dnsQueryUdp({ host, port, name, qtype = 'A', timeoutMs = 4000 }) {
  const msg = dnsPacket.encode({
    type: 'query',
    id: Math.floor(Math.random() * 65535),
    flags: dnsPacket.RECURSION_DESIRED,
    questions: [{ type: qtype, name }]
  });

  const socket = dgram.createSocket('udp4');
  try {
    const res = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('DNS_TIMEOUT')), timeoutMs);
      socket.once('error', (e) => {
        clearTimeout(timer);
        reject(e);
      });
      socket.once('message', (data) => {
        clearTimeout(timer);
        try {
          const dec = dnsPacket.decode(data);
          resolve(dec);
        } catch (e) {
          reject(e);
        }
      });
      socket.send(msg, port, host);
    });
    return res;
  } finally {
    try {
      socket.close();
    } catch {
      // ignore
    }
  }
}

function hasAnswerIp(decoded, ip) {
  const answers = Array.isArray(decoded?.answers) ? decoded.answers : [];
  for (const a of answers) {
    if ((a?.type === 'A' || a?.type === 'AAAA') && String(a?.data ?? '') === ip) return true;
  }
  return false;
}

async function waitForDnsAnswerIp({ host, port, name, qtype, expectedIp, timeoutMs = 60_000, intervalMs = 1000 }) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const dec = await dnsQueryUdp({ host, port, name, qtype });
      if (hasAnswerIp(dec, expectedIp)) return;
    } catch {
      // ignore
    }
    await sleep(intervalMs);
  }
  throw new Error(`Timed out waiting for DNS answer ${expectedIp} for ${name}`);
}

async function waitForQueryLogDomain({ baseUrl, cookie, domain, timeoutMs = 30_000, intervalMs = 1000 }) {
  const started = Date.now();
  const needle = String(domain || '').trim().toLowerCase();
  while (Date.now() - started < timeoutMs) {
    const res = await fetch(`${baseUrl}/api/query-logs?limit=250`, { headers: { cookie } }).catch(() => null);
    if (res && res.ok) {
      const json = await res.json().catch(() => ({}));
      const items = Array.isArray(json?.items) ? json.items : [];
      const found = items.some((x) => String(x?.domain ?? '').toLowerCase() === needle);
      if (found) return;
    }
    await sleep(intervalMs);
  }
  throw new Error(`Timed out waiting for query log entry for ${domain}`);
}

async function waitForDnsRcode({ host, port, name, qtype, expectedRcode, timeoutMs = 60_000, intervalMs = 1000 }) {
  const started = Date.now();
  let lastRcode = '';

  while (Date.now() - started < timeoutMs) {
    try {
      const dec = await dnsQueryUdp({ host, port, name, qtype });
      lastRcode = String(dec?.rcode ?? '');
      if (lastRcode === expectedRcode) return;
    } catch {
      // ignore
    }
    await sleep(intervalMs);
  }

  throw new Error(`Timed out waiting for DNS rcode ${expectedRcode} for ${name}. Last rcode=${lastRcode || 'unknown'}`);
}

async function waitForHealth(url, { timeoutMs, intervalMs } = {}) {
  const timeout = timeoutMs ?? 60_000;
  const interval = intervalMs ?? 1_000;
  const started = Date.now();

  while (Date.now() - started < timeout) {
    try {
      const res = await fetch(url, { headers: { accept: 'application/json' } });
      if (res.ok) {
        return;
      }
    } catch {
      // ignore
    }
    await sleep(interval);
  }

  throw new Error(`Timed out waiting for health: ${url}`);
}

function parseArgs(argv) {
  const args = {
    composeFile: 'docker-compose.yml',
    project: '',
    projectPrefix: 'sentinel-smoke',
    host: '127.0.0.1',
    dnsPort: 53,
    httpPort: 8080,
    build: true,
    assertBlocking: true,
    ruleDomain: 'example.com',
    skipUp: false,
    skipDown: false
  };

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--compose-file') args.composeFile = argv[++i];
    else if (a === '--project') args.project = argv[++i];
    else if (a === '--project-prefix') args.projectPrefix = argv[++i];
    else if (a === '--host') args.host = argv[++i];
    else if (a === '--dns-port') args.dnsPort = Number(argv[++i]);
    else if (a === '--http-port') args.httpPort = Number(argv[++i]);
    else if (a === '--no-build') args.build = false;
    else if (a === '--no-assert-blocking') args.assertBlocking = false;
    else if (a === '--rule-domain') args.ruleDomain = argv[++i];
    else if (a === '--skip-up') args.skipUp = true;
    else if (a === '--skip-down') args.skipDown = true;
    else if (a === '--help' || a === '-h') {
      console.log(`Usage: node scripts/smoke-compose.mjs [options]

Options:
  --compose-file <path>   Compose file (default: docker-compose.yml)
  --project <name>        Compose project name (isolates volumes/network)
  --project-prefix <pfx>  Project prefix when auto-generating a name (default: sentinel-smoke)
  --host <ip>             Host to test against (default: 127.0.0.1)
  --dns-port <port>       DNS UDP port (default: 53)
  --http-port <port>      API port (default: 8080)
  --no-build              Do not build images on compose up
  --no-assert-blocking    Skip creating a rule + NXDOMAIN assertion
  --rule-domain <domain>  Domain to block for assertion (default: example.com)
  --skip-up               Do not run docker compose up
  --skip-down             Do not run docker compose down (keeps container running)
`);
      process.exit(0);
    }
  }

  if (!Number.isFinite(args.dnsPort) || args.dnsPort <= 0) throw new Error('Invalid --dns-port');
  if (!Number.isFinite(args.httpPort) || args.httpPort <= 0) throw new Error('Invalid --http-port');

  return args;
}

const cwd = process.cwd();
const args = parseArgs(process.argv.slice(2));

const project = args.project || `${args.projectPrefix}-${Date.now()}`;

const composeArgsBase = ['compose', '-p', project, '-f', args.composeFile];

function cookieFromSetCookie(headers) {
  // Node.js (undici) provides getSetCookie(); fall back to raw header.
  const setCookies = typeof headers.getSetCookie === 'function' ? headers.getSetCookie() : [];
  const raw = headers.get('set-cookie');
  const all = [...setCookies, ...(raw ? [raw] : [])].filter(Boolean);
  for (const sc of all) {
    const m = String(sc).match(/\b(sentinel_session)=([^;]+)/);
    if (m) return `${m[1]}=${m[2]}`;
  }
  return '';
}

async function postJson(url, body, { cookie } = {}) {
  const headers = { 'content-type': 'application/json' };
  if (cookie) headers.cookie = cookie;
  const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
  const text = await res.text().catch(() => '');
  let json;
  try {
    json = text ? JSON.parse(text) : undefined;
  } catch {
    json = undefined;
  }
  return { res, json, text, setCookie: cookieFromSetCookie(res.headers) };
}

async function main() {
  if (!args.skipUp) {
    const upArgs = [...composeArgsBase, 'up', '-d'];
    if (args.build) upArgs.push('--build');
    await run('docker', upArgs, { cwd });
  }

  const healthUrl = `http://${args.host}:${args.httpPort}/api/health`;
  await waitForHealth(healthUrl, { timeoutMs: 90_000, intervalMs: 1_000 });

  // DNS UDP response smoke test.
  await waitForDnsRcode({
    host: args.host,
    port: args.dnsPort,
    name: 'example.com',
    qtype: 'A',
    expectedRcode: 'NOERROR',
    timeoutMs: 15_000,
    intervalMs: 500
  });

  if (args.assertBlocking) {
    const baseUrl = `http://${args.host}:${args.httpPort}`;
    const username = `smoke-${Date.now()}`;
    const password = `smoke-pass-${Math.random().toString(16).slice(2)}-${Math.random().toString(16).slice(2)}`;

    // First run in an isolated project should always be unconfigured, but handle both.
    const statusRes = await fetch(`${baseUrl}/api/auth/status`).catch(() => null);
    const statusJson = statusRes && statusRes.ok ? await statusRes.json().catch(() => ({})) : {};
    const configured = Boolean(statusJson?.configured);

    let cookie = '';
    if (!configured) {
      const setup = await postJson(`${baseUrl}/api/auth/setup`, { username, password });
      if (!setup.res.ok) throw new Error(`auth setup failed: HTTP ${setup.res.status} ${setup.text.slice(0, 200)}`);
      cookie = setup.setCookie;
    }

    // If for some reason already configured, we cannot assume credentials.
    if (!cookie) {
      throw new Error('Smoke blocking assertion requires a fresh/unconfigured instance (cookie missing after setup).');
    }

    // Deterministic DNS rewrite assertion (does not require WAN/internet).
    const rewriteDomain = `smoke-${Date.now()}.lan`;
    const rewriteTarget = '1.2.3.4';
    const addRewrite = await postJson(`${baseUrl}/api/dns/rewrites`, { domain: rewriteDomain, target: rewriteTarget }, { cookie });
    if (!addRewrite.res.ok) {
      throw new Error(`add rewrite failed: HTTP ${addRewrite.res.status} ${addRewrite.text.slice(0, 200)}`);
    }

    await waitForDnsAnswerIp({
      host: args.host,
      port: args.dnsPort,
      name: rewriteDomain,
      qtype: 'A',
      expectedIp: rewriteTarget,
      timeoutMs: 75_000,
      intervalMs: 1000
    });

    await waitForQueryLogDomain({ baseUrl, cookie, domain: rewriteDomain, timeoutMs: 45_000, intervalMs: 1000 });

    const ruleDomain = String(args.ruleDomain || 'example.com').trim();
    const addRule = await postJson(
      `${baseUrl}/api/rules`,
      { domain: ruleDomain, type: 'BLOCKED', category: 'SmokeTest' },
      { cookie }
    );
    if (!addRule.res.ok && addRule.res.status !== 409) {
      throw new Error(`add rule failed: HTTP ${addRule.res.status} ${addRule.text.slice(0, 200)}`);
    }

    // Confirm the rule is visible via the API (helps debug failures).
    const rulesRes = await fetch(`${baseUrl}/api/rules`, { headers: { cookie } }).catch(() => null);
    if (!rulesRes || !rulesRes.ok) {
      throw new Error(`rules list failed: HTTP ${rulesRes ? rulesRes.status : 'NO_RESPONSE'}`);
    }
    const rulesJson = await rulesRes.json().catch(() => ({}));
    const items = Array.isArray(rulesJson?.items) ? rulesJson.items : [];
    const present = items.some((r) => String(r?.domain ?? '').toLowerCase() === ruleDomain.toLowerCase() && String(r?.type) === 'BLOCKED');
    if (!present) {
      throw new Error('Blocking rule not present in /api/rules response; cannot assert DNS blocking.');
    }

    // DNS rules are cached and reloaded with a cooldown; poll until we observe NXDOMAIN.
    await waitForDnsRcode({
      host: args.host,
      port: args.dnsPort,
      name: ruleDomain,
      qtype: 'A',
      expectedRcode: 'NXDOMAIN',
      timeoutMs: 75_000,
      intervalMs: 1000
    });

    await waitForQueryLogDomain({ baseUrl, cookie, domain: ruleDomain, timeoutMs: 45_000, intervalMs: 1000 });
  }
}

try {
  await main();
  console.log('[smoke] OK');
} catch (err) {
  console.error('[smoke] FAILED');
  console.error(err);
  process.exitCode = 1;
} finally {
  if (!args.skipDown) {
    try {
      await run('docker', [...composeArgsBase, 'down', '--remove-orphans', '--volumes'], { cwd });
    } catch (e) {
      console.error('[smoke] compose down failed');
      console.error(e);
      process.exitCode = process.exitCode || 1;
    }
  }
}
