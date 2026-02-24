const { spawn } = require('child_process');

const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const npxCmd = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const devUrl = 'http://127.0.0.1:5173';

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

const vite = spawn(
  npmCmd,
  ['run', 'dev:web', '--', '--host', '127.0.0.1', '--port', '5173'],
  { stdio: 'inherit' }
);

let electron = null;

const shutdown = () => {
  if (electron && !electron.killed) {
    electron.kill('SIGTERM');
  }
  if (!vite.killed) {
    vite.kill('SIGTERM');
  }
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

vite.on('exit', (code) => {
  if (code !== 0) {
    process.exit(code || 1);
  }
});

(async () => {
  await waitForServer(devUrl);

  electron = spawn(npxCmd, ['electron', '.'], {
    stdio: 'inherit',
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
