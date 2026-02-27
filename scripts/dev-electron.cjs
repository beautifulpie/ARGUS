const { spawn } = require('child_process');
const path = require('path');

const devUrl = 'http://127.0.0.1:5173';
const projectRoot = path.resolve(__dirname, '..');
const binDir = path.join(projectRoot, 'node_modules', '.bin');
const viteCmd = path.join(binDir, process.platform === 'win32' ? 'vite.cmd' : 'vite');
const electronCmd = path.join(binDir, process.platform === 'win32' ? 'electron.cmd' : 'electron');

const isTtyEio = (error) => error && error.code === 'EIO' && error.syscall === 'read';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const waitForServer = async (url, timeoutMs = 45000) => {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        return;
      }
    } catch (_error) {
      // waiting for dev server startup
    }
    await sleep(500);
  }
  throw new Error(`Timed out waiting for Vite server: ${url}`);
};

if (process.stdin && typeof process.stdin.on === 'function') {
  process.stdin.on('error', (error) => {
    if (isTtyEio(error)) {
      // Some WSL terminals can emit transient EIO when the PTY is closed/reopened.
      console.warn('[ARGUS] Ignored TTY EIO on stdin. Please rerun in a fresh terminal if needed.');
      return;
    }
    throw error;
  });
}

let shuttingDown = false;

const vite = spawn(viteCmd, ['--host', '127.0.0.1', '--port', '5173'], {
  cwd: projectRoot,
  stdio: ['ignore', 'inherit', 'inherit'],
});

let electron = null;

const shutdown = () => {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;

  if (electron && !electron.killed) {
    electron.kill('SIGTERM');
  }
  if (!vite.killed) {
    vite.kill('SIGTERM');
  }
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
process.on('uncaughtException', (error) => {
  if (isTtyEio(error)) {
    console.warn('[ARGUS] Ignored terminal EIO error and closed dev runner safely.');
    shutdown();
    process.exit(0);
  }
  console.error(error);
  shutdown();
  process.exit(1);
});
process.on('unhandledRejection', (reason) => {
  console.error(reason);
  shutdown();
  process.exit(1);
});

vite.on('exit', (code) => {
  if (code !== 0) {
    process.exit(code || 1);
  }
});

(async () => {
  await waitForServer(devUrl);

  electron = spawn(electronCmd, ['.'], {
    cwd: projectRoot,
    stdio: ['ignore', 'inherit', 'inherit'],
    env: {
      ...process.env,
      ELECTRON_RENDERER_URL: devUrl,
    },
  });

  electron.on('exit', (code) => {
    shutdown();
    process.exit(code || 0);
  });
})().catch((error) => {
  console.error(error.message);
  shutdown();
  process.exit(1);
});
