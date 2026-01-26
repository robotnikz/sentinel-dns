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

async function hasDocker() {
  try {
    await run('docker', ['version']);
    return true;
  } catch {
    return false;
  }
}

function boolEnv(name, def = false) {
  const v = String(process.env[name] || '').trim().toLowerCase();
  if (!v) return def;
  return v === '1' || v === 'true' || v === 'yes' || v === 'on';
}

async function main() {
  const cwd = process.cwd();
  const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';

  // Always run fast layers.
  await run(npmCmd, ['run', 'test:unit:frontend'], { cwd });
  await run(npmCmd, ['run', 'test:unit:server'], { cwd });

  const dockerOk = await hasDocker();
  if (!dockerOk) {
    console.log('\n[ci] Docker not available: skipping integration/smoke/e2e compose layers.');
    return;
  }

  await run(npmCmd, ['run', 'test:integration:server'], { cwd });

  // Smoke is relatively cheap and catches container wiring regressions.
  await run(npmCmd, ['run', 'smoke:compose'], { cwd });

  // E2E is expensive; default OFF locally, ON in CI (or when RUN_E2E=1).
  const runE2e = boolEnv('RUN_E2E', boolEnv('CI', false));
  if (runE2e) {
    await run(npmCmd, ['run', 'test:e2e:compose'], { cwd });
  } else {
    console.log('\n[ci] Skipping E2E (set RUN_E2E=1 to enable).');
  }
}

await main();
