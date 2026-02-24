const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn, execFile } = require('child_process');

const DEFAULT_INFER_PORT = Number(process.env.RADAR_INFER_PORT || 8787);
const DEFAULT_ARGUS_SOURCE_URL =
  process.env.RADAR_ARGUS_SOURCE_URL || 'http://127.0.0.1:8080/api/v1/radar/frame';

let mainWindow = null;
let inferProc = null;
let healthInterval = null;
let resourceInterval = null;
let shutdownRequested = false;
let restartAttempts = 0;
let previousCpuSnapshot = null;
let gpuSamplingInFlight = false;
let lastGpuSampleAt = 0;
let gpuUnavailableLogged = false;

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
  resources: {
    cpuUsage: null,
    gpuUsage: null,
    ramUsage: null,
    gpuAvailable: false,
    lastUpdatedAt: null,
    source: 'bootstrap',
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

const clampPercent = (value) => Math.min(100, Math.max(0, value));

const GPU_QUERY_ARG_SETS = [
  ['--query-gpu=utilization.gpu', '--format=csv,noheader,nounits'],
  ['--query-gpu=utilization.gpu', '--format=csv,noheader'],
];

const buildGpuCommandCandidates = () => {
  if (process.platform === 'linux') {
    return ['nvidia-smi', '/usr/bin/nvidia-smi', '/usr/lib/wsl/lib/nvidia-smi'];
  }

  if (process.platform === 'win32') {
    const candidates = ['nvidia-smi'];
    const windowsRoots = [
      process.env.ProgramW6432,
      process.env['ProgramFiles'],
      process.env['ProgramFiles(x86)'],
    ].filter((value) => typeof value === 'string' && value);

    windowsRoots.forEach((root) => {
      candidates.push(path.join(root, 'NVIDIA Corporation', 'NVSMI', 'nvidia-smi.exe'));
    });

    return candidates;
  }

  return ['nvidia-smi'];
};

const parseGpuUsageValues = (stdout) =>
  stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => {
      const match = line.match(/-?\d+(\.\d+)?/);
      if (!match) return NaN;
      return Number(match[0]);
    })
    .filter((value) => Number.isFinite(value))
    .map((value) => clampPercent(value));

const runGpuQuery = (binary, args) =>
  new Promise((resolve) => {
    execFile(binary, args, { timeout: 1200, windowsHide: true }, (error, stdout) => {
      if (error) {
        resolve(null);
        return;
      }
      const values = parseGpuUsageValues(stdout);
      resolve(values.length > 0 ? values : null);
    });
  });

const readCpuSnapshot = () => {
  const cpus = os.cpus();
  let idle = 0;
  let total = 0;
  cpus.forEach((cpu) => {
    const times = cpu.times;
    idle += times.idle;
    total += times.user + times.nice + times.sys + times.irq + times.idle;
  });
  return { idle, total };
};

const sampleCpuUsage = () => {
  const current = readCpuSnapshot();
  if (!previousCpuSnapshot) {
    previousCpuSnapshot = current;
    return null;
  }

  const totalDiff = current.total - previousCpuSnapshot.total;
  const idleDiff = current.idle - previousCpuSnapshot.idle;
  previousCpuSnapshot = current;

  if (totalDiff <= 0) {
    return null;
  }

  return clampPercent(((totalDiff - idleDiff) / totalDiff) * 100);
};

const sampleRamUsage = () => {
  const total = os.totalmem();
  const free = os.freemem();
  if (total <= 0) return 0;
  return clampPercent(((total - free) / total) * 100);
};

const sampleGpuUsage = async () => {
  if (process.platform !== 'linux' && process.platform !== 'win32') {
    return null;
  }

  const binaries = buildGpuCommandCandidates();

  for (const binary of binaries) {
    for (const args of GPU_QUERY_ARG_SETS) {
      // eslint-disable-next-line no-await-in-loop
      const values = await runGpuQuery(binary, args);
      if (!values || values.length === 0) continue;
      const avg = values.reduce((sum, value) => sum + value, 0) / values.length;
      return clampPercent(avg);
    }
  }

  if (!gpuUnavailableLogged) {
    gpuUnavailableLogged = true;
    pushLog('info', `GPU usage monitor unavailable (checked: ${binaries.join(', ')}).`);
  }

  return null;
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
    detectionMode: 'ACCURACY',
    resourceMonitorIntervalMs: 1000,
  };

  const configPath = getRuntimeConfigPath();
  try {
    if (!fs.existsSync(configPath)) {
      return fallback;
    }
    const raw = fs.readFileSync(configPath, 'utf-8');
    const parsed = JSON.parse(raw);
    const normalizedParsed =
      parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    const merged = {
      ...fallback,
      ...normalizedParsed,
    };
    const detectionMode = merged.detectionMode === 'SPEED' ? 'SPEED' : 'ACCURACY';
    const parsedResourceInterval = Number(merged.resourceMonitorIntervalMs);
    const hasPersistedInterval = Object.prototype.hasOwnProperty.call(
      normalizedParsed,
      'resourceMonitorIntervalMs'
    );
    const resourceMonitorIntervalMs =
      hasPersistedInterval && Number.isFinite(parsedResourceInterval) && parsedResourceInterval >= 1000
        ? Math.floor(parsedResourceInterval)
        : detectionMode === 'SPEED'
          ? 5000
          : 1000;
    return {
      ...merged,
      detectionMode,
      resourceMonitorIntervalMs,
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
  detectionMode: 'ACCURACY',
  resourceMonitorIntervalMs: 1000,
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

const stopResourceMonitor = () => {
  if (resourceInterval) {
    clearInterval(resourceInterval);
    resourceInterval = null;
  }
};

const startResourceMonitor = () => {
  stopResourceMonitor();
  previousCpuSnapshot = null;
  const configuredInterval = Number(runtimeConfig.resourceMonitorIntervalMs);
  const intervalMs =
    Number.isFinite(configuredInterval) && configuredInterval >= 1000
      ? Math.floor(configuredInterval)
      : 1000;

  const sampleResources = async () => {
    const cpuUsage = sampleCpuUsage();
    if (typeof cpuUsage === 'number') {
      runtimeState.resources.cpuUsage = Number(cpuUsage.toFixed(1));
    }
    runtimeState.resources.ramUsage = Number(sampleRamUsage().toFixed(1));

    if (!gpuSamplingInFlight && Date.now() - lastGpuSampleAt >= 3000) {
      gpuSamplingInFlight = true;
      lastGpuSampleAt = Date.now();
      try {
        const gpuUsage = await sampleGpuUsage();
        if (typeof gpuUsage === 'number') {
          runtimeState.resources.gpuUsage = Number(gpuUsage.toFixed(1));
          runtimeState.resources.gpuAvailable = true;
        }
      } finally {
        gpuSamplingInFlight = false;
      }
    }

    runtimeState.resources.lastUpdatedAt = new Date().toISOString();
    runtimeState.resources.source = 'electron-host';
    broadcastRuntimeStatus();
  };

  void sampleResources();
  resourceInterval = setInterval(() => {
    void sampleResources();
  }, intervalMs);
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
  const previousConfig = runtimeConfig;
  runtimeConfig = {
    ...runtimeConfig,
    ...patch,
  };

  runtimeConfig.detectionMode = runtimeConfig.detectionMode === 'SPEED' ? 'SPEED' : 'ACCURACY';
  const hasDetectionModePatch = Object.prototype.hasOwnProperty.call(patch, 'detectionMode');
  const hasIntervalPatch = Object.prototype.hasOwnProperty.call(patch, 'resourceMonitorIntervalMs');
  const parsedInterval = Number(runtimeConfig.resourceMonitorIntervalMs);
  const isValidInterval = Number.isFinite(parsedInterval) && parsedInterval >= 1000;

  if (hasIntervalPatch) {
    runtimeConfig.resourceMonitorIntervalMs = isValidInterval
      ? Math.floor(parsedInterval)
      : runtimeConfig.detectionMode === 'SPEED'
        ? 5000
        : 1000;
  } else if (hasDetectionModePatch) {
    runtimeConfig.resourceMonitorIntervalMs = runtimeConfig.detectionMode === 'SPEED' ? 5000 : 1000;
  } else if (isValidInterval) {
    runtimeConfig.resourceMonitorIntervalMs = Math.floor(parsedInterval);
  } else {
    runtimeConfig.resourceMonitorIntervalMs = runtimeConfig.detectionMode === 'SPEED' ? 5000 : 1000;
  }

  saveRuntimeConfig(runtimeConfig);

  const shouldRestartInfer =
    (Object.prototype.hasOwnProperty.call(patch, 'inferPort') &&
      previousConfig.inferPort !== runtimeConfig.inferPort) ||
    (Object.prototype.hasOwnProperty.call(patch, 'argusSourceUrl') &&
      previousConfig.argusSourceUrl !== runtimeConfig.argusSourceUrl) ||
    (Object.prototype.hasOwnProperty.call(patch, 'pollIntervalMs') &&
      previousConfig.pollIntervalMs !== runtimeConfig.pollIntervalMs) ||
    (Object.prototype.hasOwnProperty.call(patch, 'requestTimeoutMs') &&
      previousConfig.requestTimeoutMs !== runtimeConfig.requestTimeoutMs) ||
    (Object.prototype.hasOwnProperty.call(patch, 'uavThreshold') &&
      previousConfig.uavThreshold !== runtimeConfig.uavThreshold) ||
    (Object.prototype.hasOwnProperty.call(patch, 'modelPath') &&
      previousConfig.modelPath !== runtimeConfig.modelPath) ||
    (Object.prototype.hasOwnProperty.call(patch, 'activeModelId') &&
      previousConfig.activeModelId !== runtimeConfig.activeModelId);

  if (shouldRestartInfer) {
    startInferenceService();
  }

  if (
    hasIntervalPatch ||
    hasDetectionModePatch
  ) {
    startResourceMonitor();
  }

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
  startResourceMonitor();
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
  stopResourceMonitor();
  stopInferenceService();
});
