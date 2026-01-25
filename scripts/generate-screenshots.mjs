import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const DEFAULT_BASE_URL = process.env.SENTINEL_BASE_URL || 'http://localhost:8080';
const DEFAULT_OUT_DIR = 'docs/screenshots';

function parseArgs(argv) {
  const args = { baseUrl: DEFAULT_BASE_URL, outDir: DEFAULT_OUT_DIR };
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
  }
  return args;
}

async function ensureDir(p) {
  await fs.mkdir(p, { recursive: true });
}

async function main() {
  const { baseUrl, outDir } = parseArgs(process.argv);

  const { chromium, request } = await import('playwright');

  const absOutDir = path.resolve(process.cwd(), outDir);
  await ensureDir(absOutDir);

  console.log(`[screenshots] baseUrl=${baseUrl}`);
  console.log(`[screenshots] outDir=${absOutDir}`);

  const api = await request.newContext({ baseURL: baseUrl });

  // Ensure an admin session exists (setup creates + logs in).
  const statusRes = await api.get('/api/auth/status');
  if (!statusRes.ok()) {
    throw new Error(`GET /api/auth/status failed: ${statusRes.status()} ${await statusRes.text()}`);
  }
  const status = await statusRes.json();

  if (!status?.configured) {
    console.log('[screenshots] auth not configured; running /api/auth/setup');
    const setupRes = await api.post('/api/auth/setup', {
      data: { username: 'admin', password: 'adminadmin' }
    });
    if (!setupRes.ok()) {
      throw new Error(`POST /api/auth/setup failed: ${setupRes.status()} ${await setupRes.text()}`);
    }
  } else {
    console.log('[screenshots] auth already configured; attempting login as admin/adminadmin');
    // Best-effort: if this fails (unknown password), we can still screenshot the login/setup UI.
    await api.post('/api/auth/login', { data: { username: 'admin', password: 'adminadmin' } }).catch(() => null);
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
      fullPage: true
    });
  }

  // The app uses hash routing.
  await snap('dashboard', 'dashboard.png');
  await snap('logs', 'query-logs.png');
  await snap('dns', 'dns-settings.png');
  await snap('clients', 'clients.png');

  await browser.close();
  await api.dispose();

  console.log('[screenshots] done');
  console.log('[screenshots] tip: if you see the login screen, your instance is already configured with a different password.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
