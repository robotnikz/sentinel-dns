import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const DEFAULT_BASE_URL = process.env.SENTINEL_BASE_URL || 'http://localhost:8080';
const DEFAULT_OUT_DIR = 'docs/screenshots';
const DEFAULT_SEED = String(process.env.SENTINEL_SCREENSHOT_SEED || '').trim() === '1';
const DEFAULT_SEED_CLUSTER = String(process.env.SENTINEL_SCREENSHOT_SEED_CLUSTER || '').trim() === '1';
const DEFAULT_PEER_BASE_URL = String(process.env.SENTINEL_SCREENSHOT_PEER_BASE_URL || '').trim();
const DEFAULT_LEADER_INTERNAL_URL = String(process.env.SENTINEL_SCREENSHOT_LEADER_INTERNAL_URL || '').trim();

function parseArgs(argv) {
  const args = {
    baseUrl: DEFAULT_BASE_URL,
    outDir: DEFAULT_OUT_DIR,
    fullPage: false,
    seed: DEFAULT_SEED,
    seedCluster: DEFAULT_SEED_CLUSTER,
    peerBaseUrl: DEFAULT_PEER_BASE_URL,
    leaderInternalUrl: DEFAULT_LEADER_INTERNAL_URL
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if ((a === '--base' || a === '--baseUrl') && argv[i + 1]) {
      args.baseUrl = argv[++i];
      continue;
    }
    if ((a === '--out' || a === '--outDir') && argv[i + 1]) {
      args.outDir = argv[++i];
      continue;
    }
    if (a === '--fullPage') {
      args.fullPage = true;
      continue;
    }
    if (a === '--seed') {
      args.seed = true;
      continue;
    }
    if (a === '--no-seed') {
      args.seed = false;
      continue;
    }
    if (a === '--seedCluster') {
      args.seedCluster = true;
      continue;
    }
    if ((a === '--peerBase' || a === '--peerBaseUrl') && argv[i + 1]) {
      args.peerBaseUrl = argv[++i];
      continue;
    }
    if ((a === '--leaderInternalUrl' || a === '--leaderUrl') && argv[i + 1]) {
      args.leaderInternalUrl = argv[++i];
      continue;
    }
  }
  return args;
}

async function ensureDir(p) {
  await fs.mkdir(p, { recursive: true });
}

async function jsonOrText(res) {
  const ct = String(res.headers()?.['content-type'] || '').toLowerCase();
  if (ct.includes('application/json')) return res.json().catch(() => null);
  return res.text().catch(() => null);
}

async function isAdminAuthed(api) {
  const r = await api.get('/api/settings').catch(() => null);
  return Boolean(r && r.ok());
}

async function ensureAuth(api, label) {
  // Ensure an admin session exists (setup creates + logs in).
  const statusRes = await api.get('/api/auth/status');
  if (!statusRes.ok()) {
    throw new Error(`GET /api/auth/status failed (${label}): ${statusRes.status()} ${await statusRes.text()}`);
  }
  const status = await statusRes.json();

  if (!status?.configured) {
    console.log(`[screenshots] (${label}) auth not configured; running /api/auth/setup`);
    const setupRes = await api.post('/api/auth/setup', {
      data: { username: 'admin', password: 'adminadmin' }
    });
    if (!setupRes.ok()) {
      throw new Error(`POST /api/auth/setup failed (${label}): ${setupRes.status()} ${await setupRes.text()}`);
    }
  } else {
    console.log(`[screenshots] (${label}) auth already configured; attempting login as admin/adminadmin`);
    // Best-effort: if this fails (unknown password), we can still screenshot the login/setup UI.
    await api.post('/api/auth/login', { data: { username: 'admin', password: 'adminadmin' } }).catch(() => null);
  }
}

async function seedDemoData(api) {
  if (!(await isAdminAuthed(api))) {
    console.log('[screenshots] seed skipped: not authenticated as admin');
    return;
  }

  const clients = [
    { id: 'demo-laptop-alex', name: "Alex’s Laptop", type: 'laptop', ip: '192.168.1.23' },
    { id: 'demo-phone-sam', name: "Sam’s Phone", type: 'smartphone', ip: '192.168.1.31' },
    { id: 'demo-tv-livingroom', name: 'Living Room TV', type: 'tv', ip: '192.168.1.40' },
    { id: 'demo-iot-printer', name: 'Office Printer', type: 'iot', ip: '192.168.1.55' },
    { id: 'demo-subnet-home', name: 'Home LAN', type: 'subnet', cidr: '192.168.1.0/24' },
    { id: 'demo-subnet-guests', name: 'Guest Wi‑Fi', type: 'subnet', cidr: '192.168.50.0/24' }
  ];

  for (const c of clients) {
    const r = await api.put(`/api/clients/${encodeURIComponent(c.id)}`, { data: c }).catch(() => null);
    if (!r || !(r.ok() || r.status() === 409)) {
      console.log(`[screenshots] seed clients: failed ${c.id}: ${r ? r.status() : 'NO_RESPONSE'}`);
    }
  }

  const rules = [
    // Global rules
    { domain: 'ads.example', type: 'BLOCKED', category: 'Manual' },
    { domain: 'telemetry.example', type: 'BLOCKED', category: 'Manual' },
    { domain: 'login.microsoftonline.com', type: 'ALLOWED', category: 'Manual' },
    // Per-client/per-subnet examples
    { domain: 'youtube.com', type: 'BLOCKED', category: 'Client:demo-tv-livingroom' },
    { domain: 'tiktok.com', type: 'BLOCKED', category: 'Subnet:demo-subnet-guests' }
  ];

  for (const rule of rules) {
    const r = await api.post('/api/rules', { data: rule }).catch(() => null);
    if (!r) continue;
    if (r.ok() || r.status() === 409) continue;
    const body = await jsonOrText(r);
    console.log(`[screenshots] seed rules: failed ${rule.domain}: ${r.status()} ${JSON.stringify(body)}`);
  }

  // Blocklists used by the UI tabs:
  // - name starting with "Category:" appears in the Categories tab
  // - name starting with "App:" appears in the Apps tab
  const blocklistsToCreate = [
    {
      name: 'Default: Ads & Tracking (demo)',
      url: 'https://raw.githubusercontent.com/StevenBlack/hosts/master/hosts',
      enabled: true,
      mode: 'ACTIVE'
    },
    {
      name: 'Category: Social Media (demo)',
      url: 'https://raw.githubusercontent.com/StevenBlack/hosts/master/data/social/hosts',
      enabled: true,
      mode: 'ACTIVE'
    },
    {
      name: 'Category: Adult Content (demo)',
      url: 'https://raw.githubusercontent.com/StevenBlack/hosts/master/data/porn/hosts',
      enabled: true,
      mode: 'SHADOW'
    },
    {
      name: 'App: TikTok (demo)',
      url: 'https://raw.githubusercontent.com/nextdns/services/main/services/tiktok',
      enabled: true,
      mode: 'ACTIVE'
    },
    {
      name: 'App: Discord (demo)',
      url: 'https://raw.githubusercontent.com/nextdns/services/main/services/discord',
      enabled: true,
      mode: 'SHADOW'
    }
  ];

  for (const b of blocklistsToCreate) {
    const r = await api.post('/api/blocklists', { data: b }).catch(() => null);
    if (!r) continue;
    if (r.ok() || r.status() === 409) continue;
    const body = await jsonOrText(r);
    console.log(`[screenshots] seed blocklists: failed ${b.name}: ${r.status()} ${JSON.stringify(body)}`);
  }

  // Prefer refreshing *small* lists so ruleCount/lastUpdated look realistic, but keep it best-effort
  // so screenshots can still be generated offline.
  try {
    const listRes = await api.get('/api/blocklists').catch(() => null);
    const data = listRes && listRes.ok() ? await listRes.json().catch(() => null) : null;
    const items = Array.isArray(data?.items) ? data.items : [];
    const byUrl = new Map(items.map((x) => [String(x?.url || ''), String(x?.id || '')]));
    for (const b of blocklistsToCreate) {
      // Only auto-refresh known-small lists (NextDNS service files) to keep screenshot generation fast.
      if (!String(b.url).startsWith('https://raw.githubusercontent.com/nextdns/services/')) continue;
      const id = byUrl.get(b.url);
      if (!id) continue;
      await api.post(`/api/blocklists/${encodeURIComponent(id)}/refresh`).catch(() => null);
    }
  } catch {
    // ignore
  }

  // Make Query Logs look "alive".
  const now = Date.now();
  const domains = [
    'google.com',
    'youtube.com',
    'cdn.discordapp.com',
    'api.tiktokv.com',
    'graph.facebook.com',
    'ads.example',
    'telemetry.example',
    'github.com',
    'cloudflare-dns.com',
    'login.microsoftonline.com'
  ];
  const clientsForLogs = [
    { client: "Alex’s Laptop", ip: '192.168.1.23' },
    { client: "Sam’s Phone", ip: '192.168.1.31' },
    { client: 'Living Room TV', ip: '192.168.1.40' },
    { client: 'Office Printer', ip: '192.168.1.55' }
  ];
  const statuses = ['PERMITTED', 'CACHED', 'BLOCKED', 'SHADOW_BLOCKED'];
  const types = ['A', 'AAAA', 'HTTPS', 'TXT', 'SRV'];

  const items = [];
  const count = 220;
  for (let i = 0; i < count; i++) {
    const d = domains[i % domains.length];
    const c = clientsForLogs[i % clientsForLogs.length];
    const status = statuses[i % statuses.length];
    const t = types[i % types.length];
    const ts = new Date(now - i * 17_000).toISOString();
    const durationMs = (i % 9) * 6 + (status === 'CACHED' ? 1 : 18);
    items.push({
      id: `demo-${now}-${i}`,
      timestamp: ts,
      domain: d,
      client: c.client,
      clientIp: c.ip,
      status,
      type: t,
      durationMs
    });
  }

  await api.post('/api/query-logs/ingest', { data: { items } }).catch(() => null);

  // Enable some global apps so the Apps tab shows selection states.
  await api
    .put('/api/settings/global_blocked_apps', {
      data: {
        blockedApps: ['tiktok', 'discord'],
        shadowApps: ['instagram']
      }
    })
    .catch(() => null);
}

function guessLocal2NodeInternalLeaderUrl(baseUrl) {
  try {
    const u = new URL(baseUrl);
    // If user points at the local 2-node compose leader (8081), followers can reach it as sentinel_a:8080.
    if (u.hostname === 'localhost' && u.port === '8081') return 'http://sentinel_a:8080';
  } catch {
    // ignore
  }
  return '';
}

async function seedClusterTwoNode({ apiLeader, apiFollower, leaderInternalUrl }) {
  if (!(await isAdminAuthed(apiLeader)) || !(await isAdminAuthed(apiFollower))) {
    console.log('[screenshots] seedCluster skipped: not authenticated as admin on leader/follower');
    return;
  }

  if (!leaderInternalUrl) {
    console.log('[screenshots] seedCluster skipped: missing leaderInternalUrl');
    return;
  }

  // Enable leader mode.
  await apiLeader.post('/api/cluster/enable-leader', { data: { leaderUrl: leaderInternalUrl } }).catch(() => null);

  // Configure follower.
  const joinRes = await apiLeader.get('/api/cluster/join-code').catch(() => null);
  if (joinRes && joinRes.ok()) {
    const body = await joinRes.json().catch(() => null);
    const joinCode = String(body?.joinCode || '');
    if (joinCode) {
      await apiFollower.post('/api/cluster/configure-follower', { data: { joinCode } }).catch(() => null);
    }
  }

  // Seed HA config (used by /api/cluster/peer-status indicator). This does not require keepalived to run.
  const haAuthPass = 'sentinel';
  const leaderHa = {
    enabled: true,
    vip: '10.0.0.53',
    vrid: 53,
    priority: 110,
    advertInt: 1,
    mode: 'unicast',
    unicastPeers: ['sentinel_b'],
    authPass: haAuthPass
  };
  const followerHa = {
    enabled: true,
    vip: '10.0.0.53',
    vrid: 53,
    priority: 100,
    advertInt: 1,
    mode: 'unicast',
    unicastPeers: ['sentinel_a'],
    authPass: haAuthPass
  };

  await apiLeader.put('/api/cluster/ha/config', { data: leaderHa }).catch(() => null);
  await apiFollower.put('/api/cluster/ha/config', { data: followerHa }).catch(() => null);

  // Wait for the follower to perform an initial sync so readiness turns green.
  for (let i = 0; i < 6; i++) {
    const r = await apiFollower.get('/api/cluster/ready').catch(() => null);
    const body = r && r.ok() ? await r.json().catch(() => null) : null;
    if (body && body.ok === true) break;
    await new Promise((res) => setTimeout(res, 2000));
  }
}

async function main() {
  const { baseUrl, outDir, fullPage, seed, seedCluster, peerBaseUrl, leaderInternalUrl } = parseArgs(process.argv);

  const { chromium, request } = await import('playwright');

  const absOutDir = path.resolve(process.cwd(), outDir);
  await ensureDir(absOutDir);

  console.log(`[screenshots] baseUrl=${baseUrl}`);
  console.log(`[screenshots] outDir=${absOutDir}`);

  const api = await request.newContext({ baseURL: baseUrl });

  await ensureAuth(api, 'leader');

  if (seed) {
    console.log('[screenshots] seeding demo data (best-effort)');
    await seedDemoData(api);
  }

  if (seedCluster) {
    const peer = String(peerBaseUrl || '').trim();
    const guessedLeaderUrl = leaderInternalUrl || guessLocal2NodeInternalLeaderUrl(baseUrl);
    if (!peer) {
      console.log('[screenshots] seedCluster requested but no peer base URL was provided; skipping');
    } else {
      console.log(`[screenshots] seeding 2-node cluster (peer=${peer})`);
      const apiPeer = await request.newContext({ baseURL: peer });
      await ensureAuth(apiPeer, 'follower');
      await seedClusterTwoNode({ apiLeader: api, apiFollower: apiPeer, leaderInternalUrl: guessedLeaderUrl });
      await apiPeer.dispose();
    }
  }

  const storageState = await api.storageState();

  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2,
    storageState
  });

  const page = await context.newPage();

  async function snap(hash, fileName) {
    const url = `${baseUrl}/#${hash}`;
    console.log(`[screenshots] capturing ${url} -> ${fileName}`);
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500);
    await page.screenshot({
      path: path.join(absOutDir, fileName),
      // For README previews we want consistent sizes; fullPage is opt-in.
      fullPage
    });
  }

  // The app uses hash routing.
  await snap('dashboard', 'dashboard.png');
  await snap('logs', 'query-logs.png');
  await snap('blocking', 'filtering.png');
  await snap('dns', 'dns-settings.png');
  await snap('clients', 'clients.png');
  await snap('cluster', 'cluster-ha.png');

  await browser.close();
  await api.dispose();

  console.log('[screenshots] done');
  console.log('[screenshots] tip: if you see the login screen, your instance is already configured with a different password.');
  console.log('[screenshots] tip: use --seed for demo data and --seedCluster with --peerBaseUrl for 2-node cluster screenshots.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
