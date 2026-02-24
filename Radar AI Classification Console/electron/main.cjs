const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

const DEFAULT_INFER_PORT = Number(process.env.RADAR_INFER_PORT || 8787);
const DEFAULT_ARGUS_SOURCE_URL =
  process.env.RADAR_ARGUS_SOURCE_URL || 'http://127.0.0.1:8080/api/v1/radar/frame';

let mainWindow = null;
let inferProc = null;
let healthInterval = null;
let shutdownRequested = false;
let restartAttempts = 0;

const runtimeState = {
  startedAt: Date.now(),
  infer: {
    running: false,
    pid: null,
    lastExitCode: null,
    restarts: 0,
  },
  health: {
    ok: false,
    lastCheckedAt: null,
    lastResponseAt: null,
    error: null,
    payload: null,
  },
  logs: [],
};

const pushLog = (level, message) => {
  const entry = {
    ts: new Date().toISOString(),
    level,
    message,
  };
  runtimeState.logs.push(entry);
  if (runtimeState.logs.length > 500) {
    runtimeState.logs.shift();
  }
};

const getRuntimeConfigPath = () => path.join(app.getPath('userData'), 'runtime-config.json');

const loadRuntimeConfig = () => {
  const fallback = {
    inferPort: DEFAULT_INFER_PORT,
    argusSourceUrl: DEFAULT_ARGUS_SOURCE_URL,
    pollIntervalMs: 100,
    requestTimeoutMs: 1000,
    uavThreshold: 35,
    modelPath: '',
    activeModelId: 'heuristic-default',
  };

  const configPath = getRuntimeConfigPath();
  try {
    if (!fs.existsSync(configPath)) {
      return fallback;
    }
    const raw = fs.readFileSync(configPath, 'utf-8');
    const parsed = JSON.parse(raw);
    return {
      ...fallback,
      ...parsed,
    };
  } catch (error) {
    pushLog('warn', `runtime config load failed: ${error.message}`);
    return fallback;
  }
};

const saveRuntimeConfig = (nextConfig) => {
  const configPath = getRuntimeConfigPath();
  fs.writeFileSync(configPath, JSON.stringify(nextConfig, null, 2));
};

let runtimeConfig = {
  inferPort: DEFAULT_INFER_PORT,
  argusSourceUrl: DEFAULT_ARGUS_SOURCE_URL,
  pollIntervalMs: 100,
  requestTimeoutMs: 1000,
  uavThreshold: 35,
  modelPath: '',
  activeModelId: 'heuristic-default',
};

const inferHealthUrl = () => `http://127.0.0.1:${runtimeConfig.inferPort}/healthz`;
const inferFrameBaseUrl = () => `http://127.0.0.1:${runtimeConfig.inferPort}`;

const broadcastRuntimeStatus = () => {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }
  mainWindow.webContents.send('runtime:status', {
    ...runtimeState,
    uptimeSec: Math.floor((Date.now() - runtimeState.startedAt) / 1000),
    inferBaseUrl: inferFrameBaseUrl(),
    config: runtimeConfig,
  });
};

const resolveInferCommand = () => {
  const packagedExe = path.join(
    process.resourcesPath,
    'ARGUS-Brain',
    process.platform === 'win32' ? 'radar_infer.exe' : 'radar_infer'
  );

  if (fs.existsSync(packagedExe)) {
    return {
      command: packagedExe,
      args: [],
      cwd: path.dirname(packagedExe),
    };
  }

  const bundledScript = path.join(process.resourcesPath, 'ARGUS-Brain', 'app', 'main.py');
  if (fs.existsSync(bundledScript)) {
    return {
      command:
        process.env.RADAR_PYTHON_EXECUTABLE || (process.platform === 'win32' ? 'python' : 'python3'),
      args: [bundledScript],
      cwd: path.dirname(bundledScript),
    };
  }

  const localScript = path.join(app.getAppPath(), 'ARGUS-Brain', 'app', 'main.py');
  return {
    command:
      process.env.RADAR_PYTHON_EXECUTABLE || (process.platform === 'win32' ? 'python' : 'python3'),
    args: [localScript],
    cwd: path.dirname(localScript),
  };
};

const scheduleRestart = () => {
  if (shutdownRequested) {
    return;
  }
  const backoff = [1000, 2000, 5000, 10000][Math.min(restartAttempts, 3)];
  restartAttempts += 1;
  setTimeout(() => {
    startInferenceService();
  }, backoff);
};

const stopInferenceService = () => {
  if (!inferProc) {
    return;
  }
  const pid = inferProc.pid;
  inferProc.removeAllListeners();
  try {
    inferProc.kill('SIGTERM');
  } catch (error) {
    pushLog('warn', `failed to terminate inference service ${pid}: ${error.message}`);
  }
  inferProc = null;
  runtimeState.infer.running = false;
  runtimeState.infer.pid = null;
};

const startInferenceService = () => {
  stopInferenceService();

  const launch = resolveInferCommand();
  pushLog('info', `start inference service: ${launch.command} ${launch.args.join(' ')}`);

  inferProc = spawn(launch.command, launch.args, {
    cwd: launch.cwd,
    env: {
      ...process.env,
      RADAR_INFER_PORT: String(runtimeConfig.inferPort),
      RADAR_ARGUS_SOURCE_URL: String(runtimeConfig.argusSourceUrl),
      RADAR_POLL_INTERVAL_MS: String(runtimeConfig.pollIntervalMs),
      RADAR_REQUEST_TIMEOUT_MS: String(runtimeConfig.requestTimeoutMs),
      RADAR_UAV_THRESHOLD: String(runtimeConfig.uavThreshold),
      RADAR_MODEL_PATH: String(runtimeConfig.modelPath || ''),
      RADAR_ACTIVE_MODEL_ID: String(runtimeConfig.activeModelId || 'heuristic-default'),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  runtimeState.infer.running = true;
  runtimeState.infer.pid = inferProc.pid;
  runtimeState.infer.restarts += 1;
  broadcastRuntimeStatus();

  inferProc.stdout.on('data', (chunk) => {
    pushLog('info', chunk.toString().trim());
  });

  inferProc.stderr.on('data', (chunk) => {
    pushLog('error', chunk.toString().trim());
  });

  inferProc.on('exit', (code) => {
    runtimeState.infer.running = false;
    runtimeState.infer.pid = null;
    runtimeState.infer.lastExitCode = code;
    pushLog('warn', `inference service exited with code ${code}`);
    broadcastRuntimeStatus();
    scheduleRestart();
  });
};

const startHealthMonitor = () => {
  if (healthInterval) {
    clearInterval(healthInterval);
  }
  healthInterval = setInterval(async () => {
    try {
      const response = await fetch(inferHealthUrl(), { method: 'GET' });
      const payload = await response.json();
      runtimeState.health.ok = response.ok;
      runtimeState.health.lastCheckedAt = new Date().toISOString();
      runtimeState.health.lastResponseAt = new Date().toISOString();
      runtimeState.health.error = response.ok ? null : `HTTP ${response.status}`;
      runtimeState.health.payload = payload;
      if (response.ok) {
        restartAttempts = 0;
      }
    } catch (error) {
      runtimeState.health.ok = false;
      runtimeState.health.lastCheckedAt = new Date().toISOString();
      runtimeState.health.error = error.message;
    }
    broadcastRuntimeStatus();
  }, 2000);
};

const buildRendererUrl = () => {
  const base = process.env.ELECTRON_RENDERER_URL || 'http://127.0.0.1:5173';
  const url = new URL(base);
  url.searchParams.set('argusBaseUrl', inferFrameBaseUrl());
  url.searchParams.set('argusPollMs', '200');
  url.searchParams.set('argusTimeoutMs', '1000');
  return url.toString();
};

const createWindow = async () => {
  mainWindow = new BrowserWindow({
    width: 1800,
    height: 1050,
    minWidth: 1280,
    minHeight: 800,
    backgroundColor: '#0b0f14',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload.cjs'),
    },
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    await mainWindow.loadURL(buildRendererUrl());
  } else {
    await mainWindow.loadFile(path.join(app.getAppPath(), 'dist', 'index.html'), {
      query: {
        argusBaseUrl: inferFrameBaseUrl(),
        argusPollMs: '200',
        argusTimeoutMs: '1000',
      },
    });
  }
};

ipcMain.handle('runtime:getStatus', async () => {
  return {
    ...runtimeState,
    uptimeSec: Math.floor((Date.now() - runtimeState.startedAt) / 1000),
    inferBaseUrl: inferFrameBaseUrl(),
    config: runtimeConfig,
  };
});

ipcMain.handle('runtime:getLogs', async () => {
  return runtimeState.logs.slice(-200);
});

ipcMain.handle('runtime:updateConfig', async (_event, patch = {}) => {
  runtimeConfig = {
    ...runtimeConfig,
    ...patch,
  };
  saveRuntimeConfig(runtimeConfig);
  startInferenceService();
  broadcastRuntimeStatus();
  return {
    ok: true,
    config: runtimeConfig,
  };
});

app.whenReady().then(async () => {
  runtimeConfig = loadRuntimeConfig();
  shutdownRequested = false;
  startInferenceService();
  startHealthMonitor();
  await createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  shutdownRequested = true;
  if (healthInterval) {
    clearInterval(healthInterval);
    healthInterval = null;
  }
  stopInferenceService();
});
