import { spawn } from 'node:child_process';

function run(cmd, args, { cwd, env } = {}) {
  return new Promise((resolve, reject) => {
    const isWin = process.platform === 'win32';
    const isCmdShim = isWin && /\.(cmd|bat)$/i.test(cmd);
    const command = isCmdShim ? 'cmd.exe' : cmd;
    const commandArgs = isCmdShim ? ['/d', '/s', '/c', cmd, ...args] : args;

    const child = spawn(command, commandArgs, {
      cwd,
      stdio: 'inherit',
      env: env || process.env
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

async function waitForHealth(url, { timeoutMs = 90_000, intervalMs = 1_000 } = {}) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const res = await fetch(url, { headers: { accept: 'application/json' } });
      if (res.ok) return;
    } catch {
      // ignore
    }
    await sleep(intervalMs);
  }
  throw new Error(`Timed out waiting for health: ${url}`);
}

function parseArgs(argv) {
  const args = {
    composeFile: 'docker-compose.smoke.yml',
    projectPrefix: 'sentinel-e2e',
    project: '',
    httpPort: 18080,
    build: true,
    headed: false
  };

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--compose-file') args.composeFile = argv[++i];
    else if (a === '--project') args.project = argv[++i];
    else if (a === '--project-prefix') args.projectPrefix = argv[++i];
    else if (a === '--http-port') args.httpPort = Number(argv[++i]);
    else if (a === '--no-build') args.build = false;
    else if (a === '--headed') args.headed = true;
    else if (a === '--help' || a === '-h') {
      console.log(`Usage: node scripts/e2e-compose.mjs [options]

Options:
  --compose-file <path>   Compose file to run (default: docker-compose.smoke.yml)
  --project <name>        Compose project name
  --project-prefix <pfx>  Prefix for auto project name (default: sentinel-e2e)
  --http-port <port>      Mapped HTTP port (default: 18080)
  --no-build              Do not build images on compose up
  --headed                Run Playwright headed
`);
      process.exit(0);
    }
  }

  if (!Number.isFinite(args.httpPort) || args.httpPort <= 0) throw new Error('Invalid --http-port');
  return args;
}

const cwd = process.cwd();
const args = parseArgs(process.argv.slice(2));
const project = args.project || `${args.projectPrefix}-${Date.now()}`;
const composeArgsBase = ['compose', '-p', project, '-f', args.composeFile];
const npxCmd = process.platform === 'win32' ? 'npx.cmd' : 'npx';

async function main() {
  const upArgs = [...composeArgsBase, 'up', '-d'];
  if (args.build) upArgs.push('--build');
  try {
    await run('docker', upArgs, { cwd });
  } catch (e) {
    console.error('\nCompose startup failed.');
    console.error('If Docker build fails with a snapshot/cache error like:');
    console.error('  parent snapshot sha256:... does not exist');
    console.error('a common fix is to prune the builder cache and rebuild:');
    console.error('  docker image rm -f sentinel-dns-smoke:local');
    console.error('  docker builder prune -a -f');
    console.error('  docker buildx prune -a -f\n');
    throw e;
  }

  const baseUrl = `http://127.0.0.1:${args.httpPort}`;
  await waitForHealth(`${baseUrl}/api/health`, { timeoutMs: 120_000, intervalMs: 1_000 });

  const env = {
    ...process.env,
    BASE_URL: baseUrl
  };

  const pwArgs = ['playwright', 'test'];
  if (args.headed) pwArgs.push('--headed');

  await run(npxCmd, pwArgs, { cwd, env });
}

try {
  await main();
} finally {
  try {
    await run('docker', [...composeArgsBase, 'down', '--remove-orphans', '--volumes'], { cwd });
  } catch {
    // ignore
  }
}
