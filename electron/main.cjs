const { app, BrowserWindow, ipcMain, dialog, Menu, screen } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn, execFile } = require('child_process');

const isTruthyEnv = (value) => /^(1|true|yes|on)$/i.test(String(value || '').trim());
const isFalsyEnv = (value) => /^(0|false|no|off)$/i.test(String(value || '').trim());
const isWslEnvironment = (() => {
  if (process.platform !== 'linux') {
    return false;
  }
  if (process.env.WSL_DISTRO_NAME || process.env.WSL_INTEROP) {
    return true;
  }
  try {
    const procVersion = fs.readFileSync('/proc/version', 'utf8').toLowerCase();
    return procVersion.includes('microsoft');
  } catch {
    return false;
  }
})();

const disableGpuEnv = process.env.RADAR_ELECTRON_DISABLE_GPU;
const shouldDisableGpuByDefault = isWslEnvironment;
const shouldDisableGpu =
  disableGpuEnv === undefined || disableGpuEnv === null || disableGpuEnv === ''
    ? shouldDisableGpuByDefault
    : isTruthyEnv(disableGpuEnv) && !isFalsyEnv(disableGpuEnv);

const ozonePlatformEnv = String(process.env.RADAR_ELECTRON_OZONE_PLATFORM || '').trim().toLowerCase();
const preferredOzonePlatform = ozonePlatformEnv || (isWslEnvironment ? 'x11' : '');
if (preferredOzonePlatform === 'x11' || preferredOzonePlatform === 'wayland') {
  app.commandLine.appendSwitch('ozone-platform', preferredOzonePlatform);
  app.commandLine.appendSwitch('ozone-platform-hint', preferredOzonePlatform);
}

if (shouldDisableGpu) {
  app.disableHardwareAcceleration();
  app.commandLine.appendSwitch('disable-gpu');
  app.commandLine.appendSwitch('disable-gpu-compositing');
}

const DEFAULT_INFER_PORT = Number(process.env.RADAR_INFER_PORT || 8787);
const DEFAULT_ARGUS_SOURCE_URL =
  process.env.RADAR_ARGUS_SOURCE_URL || 'http://127.0.0.1:8080/api/v1/radar/frame';

let mainWindow = null;
let logViewerWindow = null;
let layoutDevConsoleWindow = null;
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
const getEventLogDirectoryPath = () => path.join(app.getPath('userData'), 'event-logs');

const ensureEventLogDirectory = () => {
  const directoryPath = getEventLogDirectoryPath();
  fs.mkdirSync(directoryPath, { recursive: true });
  return directoryPath;
};

const toIsoDateKey = (value) => {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return new Date().toISOString().slice(0, 10);
  }
  return parsed.toISOString().slice(0, 10);
};

const escapeCsvValue = (value) => {
  if (value === null || value === undefined) return '';
  const stringValue = String(value);
  if (/[",\n\r]/.test(stringValue)) {
    return `"${stringValue.replace(/"/g, '""')}"`;
  }
  return stringValue;
};

const countReplacementChars = (text) => {
  if (!text) return 0;
  const matches = text.match(/\uFFFD/g);
  return matches ? matches.length : 0;
};

const decodeTextBuffer = (buffer) => {
  const utf8Text = new TextDecoder('utf-8', { fatal: false }).decode(buffer);
  const utf8ReplacementCount = countReplacementChars(utf8Text);

  if (utf8ReplacementCount === 0) {
    return {
      text: utf8Text,
      encoding: 'utf-8',
    };
  }

  try {
    const eucKrText = new TextDecoder('euc-kr', { fatal: false }).decode(buffer);
    const eucKrReplacementCount = countReplacementChars(eucKrText);
    if (eucKrReplacementCount < utf8ReplacementCount) {
      return {
        text: eucKrText,
        encoding: 'euc-kr',
      };
    }
  } catch {
    // Fall through to UTF-8 result.
  }

  return {
    text: utf8Text,
    encoding: 'utf-8',
  };
};

const appendEventLogsToCsv = (entries) => {
  if (!Array.isArray(entries) || entries.length === 0) {
    return { ok: true, count: 0, directory: ensureEventLogDirectory(), files: [] };
  }

  const logDirectory = ensureEventLogDirectory();
  const groupedByDay = new Map();

  entries.forEach((entry) => {
    const dayKey = toIsoDateKey(entry.timestamp);
    const list = groupedByDay.get(dayKey) || [];
    list.push(entry);
    groupedByDay.set(dayKey, list);
  });

  const writtenFiles = [];
  groupedByDay.forEach((dayEntries, dayKey) => {
    const filePath = path.join(logDirectory, `${dayKey}_event_log.csv`);
    const hasFile = fs.existsSync(filePath);
    if (!hasFile) {
      const header = 'timestamp,event_id,type,message,object_id,object_class\n';
      fs.writeFileSync(filePath, header, 'utf-8');
    }

    const lines = dayEntries
      .map((entry) =>
        [
          escapeCsvValue(entry.timestamp),
          escapeCsvValue(entry.id),
          escapeCsvValue(entry.type),
          escapeCsvValue(entry.message),
          escapeCsvValue(entry.objectId || ''),
          escapeCsvValue(entry.objectClass || ''),
        ].join(',')
      )
      .join('\n');

    fs.appendFileSync(filePath, `${lines}\n`, 'utf-8');
    writtenFiles.push(filePath);
  });

  return {
    ok: true,
    count: entries.length,
    directory: logDirectory,
    files: writtenFiles,
  };
};

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

  let child;
  try {
    child = spawn(launch.command, launch.args, {
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
  } catch (error) {
    runtimeState.infer.running = false;
    runtimeState.infer.pid = null;
    runtimeState.infer.lastExitCode = null;
    pushLog('error', `failed to spawn inference service: ${error.message}`);
    broadcastRuntimeStatus();
    scheduleRestart();
    return;
  }

  inferProc = child;

  let restartScheduled = false;
  const scheduleRestartSafe = () => {
    if (restartScheduled) return;
    restartScheduled = true;
    scheduleRestart();
  };

  runtimeState.infer.running = true;
  runtimeState.infer.pid = typeof child.pid === 'number' ? child.pid : null;
  runtimeState.infer.restarts += 1;
  broadcastRuntimeStatus();

  child.stdout.on('data', (chunk) => {
    pushLog('info', chunk.toString().trim());
  });

  child.stderr.on('data', (chunk) => {
    pushLog('error', chunk.toString().trim());
  });

  child.on('error', (error) => {
    if (inferProc === child) {
      inferProc = null;
    }
    runtimeState.infer.running = false;
    runtimeState.infer.pid = null;
    runtimeState.infer.lastExitCode = null;
    pushLog('error', `inference service start error: ${error.message}`);
    broadcastRuntimeStatus();
    scheduleRestartSafe();
  });

  child.on('exit', (code) => {
    if (inferProc === child) {
      inferProc = null;
    }
    runtimeState.infer.running = false;
    runtimeState.infer.pid = null;
    runtimeState.infer.lastExitCode = code;
    pushLog('warn', `inference service exited with code ${code}`);
    broadcastRuntimeStatus();
    scheduleRestartSafe();
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

const buildLogViewerUrl = () => {
  const base = process.env.ELECTRON_RENDERER_URL || 'http://127.0.0.1:5173';
  const url = new URL(base);
  url.pathname = '/log-viewer.html';
  url.search = '';
  return url.toString();
};

const buildLayoutDevConsoleUrl = () => {
  const base = process.env.ELECTRON_RENDERER_URL || 'http://127.0.0.1:5173';
  const url = new URL(base);
  url.pathname = '/layout-dev-console.html';
  url.search = '';
  return url.toString();
};

const placeWindowOnActiveDisplay = (win) => {
  if (!win || win.isDestroyed()) return;
  const cursorPoint = screen.getCursorScreenPoint();
  const targetDisplay = screen.getDisplayNearestPoint(cursorPoint) || screen.getPrimaryDisplay();
  const area = targetDisplay.workArea;
  const currentBounds = win.getBounds();
  const width = Math.max(640, Math.min(currentBounds.width, area.width));
  const height = Math.max(480, Math.min(currentBounds.height, area.height));
  const maxX = area.x + area.width - width;
  const maxY = area.y + area.height - height;
  const centeredX = area.x + Math.floor((area.width - width) / 2);
  const centeredY = area.y + Math.floor((area.height - height) / 2);
  const x = Math.min(Math.max(centeredX, area.x), maxX);
  const y = Math.min(Math.max(centeredY, area.y), maxY);
  win.setBounds({ x, y, width, height });
};

const placeWindowNearParent = (win, parent, offsetX = 36, offsetY = 36) => {
  if (!win || win.isDestroyed()) return;
  if (!parent || parent.isDestroyed()) {
    placeWindowOnActiveDisplay(win);
    return;
  }

  const parentBounds = parent.getBounds();
  const parentCenter = {
    x: parentBounds.x + Math.floor(parentBounds.width / 2),
    y: parentBounds.y + Math.floor(parentBounds.height / 2),
  };
  const targetDisplay = screen.getDisplayNearestPoint(parentCenter) || screen.getPrimaryDisplay();
  const area = targetDisplay.workArea;
  const currentBounds = win.getBounds();
  const width = Math.max(640, Math.min(currentBounds.width, area.width));
  const height = Math.max(480, Math.min(currentBounds.height, area.height));

  const preferredX = parentBounds.x + offsetX;
  const preferredY = parentBounds.y + offsetY;
  const maxX = area.x + area.width - width;
  const maxY = area.y + area.height - height;
  const x = Math.min(Math.max(preferredX, area.x), maxX);
  const y = Math.min(Math.max(preferredY, area.y), maxY);
  win.setBounds({ x, y, width, height });
};

const createWindow = async () => {
  mainWindow = new BrowserWindow({
    width: 1920,
    height: 1080,
    minWidth: 900,
    minHeight: 620,
    backgroundColor: '#0b0f14',
    autoHideMenuBar: true,
    show: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload.cjs'),
    },
  });
  mainWindow.setMenuBarVisibility(false);
  placeWindowOnActiveDisplay(mainWindow);
  mainWindow.once('ready-to-show', () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    placeWindowOnActiveDisplay(mainWindow);
    if (mainWindow.isMinimized()) {
      mainWindow.restore();
    }
    mainWindow.show();
    mainWindow.focus();
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

  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }
  placeWindowOnActiveDisplay(mainWindow);
  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }
  mainWindow.show();
  mainWindow.focus();
};

const createLogViewerWindow = async () => {
  if (logViewerWindow && !logViewerWindow.isDestroyed()) {
    logViewerWindow.focus();
    return logViewerWindow;
  }

  logViewerWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 840,
    minHeight: 560,
    backgroundColor: '#0b0f14',
    autoHideMenuBar: true,
    show: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload.cjs'),
    },
  });
  logViewerWindow.setMenuBarVisibility(false);
  placeWindowNearParent(logViewerWindow, mainWindow);
  logViewerWindow.once('ready-to-show', () => {
    if (!logViewerWindow || logViewerWindow.isDestroyed()) return;
    placeWindowNearParent(logViewerWindow, mainWindow);
    if (logViewerWindow.isMinimized()) {
      logViewerWindow.restore();
    }
    logViewerWindow.show();
    logViewerWindow.focus();
  });

  logViewerWindow.on('closed', () => {
    logViewerWindow = null;
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    await logViewerWindow.loadURL(buildLogViewerUrl());
  } else {
    await logViewerWindow.loadFile(path.join(app.getAppPath(), 'dist', 'log-viewer.html'));
  }

  if (!logViewerWindow || logViewerWindow.isDestroyed()) {
    return logViewerWindow;
  }
  placeWindowNearParent(logViewerWindow, mainWindow);
  if (logViewerWindow.isMinimized()) {
    logViewerWindow.restore();
  }
  logViewerWindow.show();
  logViewerWindow.focus();

  return logViewerWindow;
};

const createLayoutDevConsoleWindow = async () => {
  if (layoutDevConsoleWindow && !layoutDevConsoleWindow.isDestroyed()) {
    layoutDevConsoleWindow.focus();
    return layoutDevConsoleWindow;
  }

  layoutDevConsoleWindow = new BrowserWindow({
    width: 640,
    height: 760,
    minWidth: 540,
    minHeight: 620,
    backgroundColor: '#0a1118',
    autoHideMenuBar: true,
    show: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload.cjs'),
    },
  });
  layoutDevConsoleWindow.setMenuBarVisibility(false);
  placeWindowNearParent(layoutDevConsoleWindow, mainWindow, 54, 54);
  layoutDevConsoleWindow.once('ready-to-show', () => {
    if (!layoutDevConsoleWindow || layoutDevConsoleWindow.isDestroyed()) return;
    placeWindowNearParent(layoutDevConsoleWindow, mainWindow, 54, 54);
    if (layoutDevConsoleWindow.isMinimized()) {
      layoutDevConsoleWindow.restore();
    }
    layoutDevConsoleWindow.show();
    layoutDevConsoleWindow.focus();
  });

  layoutDevConsoleWindow.on('closed', () => {
    layoutDevConsoleWindow = null;
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    await layoutDevConsoleWindow.loadURL(buildLayoutDevConsoleUrl());
  } else {
    await layoutDevConsoleWindow.loadFile(path.join(app.getAppPath(), 'dist', 'layout-dev-console.html'));
  }

  if (!layoutDevConsoleWindow || layoutDevConsoleWindow.isDestroyed()) {
    return layoutDevConsoleWindow;
  }
  placeWindowNearParent(layoutDevConsoleWindow, mainWindow, 54, 54);
  if (layoutDevConsoleWindow.isMinimized()) {
    layoutDevConsoleWindow.restore();
  }
  layoutDevConsoleWindow.show();
  layoutDevConsoleWindow.focus();

  return layoutDevConsoleWindow;
};

const getLiveMainWindow = () => {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return null;
  }
  return mainWindow;
};

const resizeMainWindowTo = (targetWidth, targetHeight) => {
  const win = getLiveMainWindow();
  if (!win) return null;

  const currentBounds = win.getBounds();
  const centerPoint = {
    x: currentBounds.x + Math.floor(currentBounds.width / 2),
    y: currentBounds.y + Math.floor(currentBounds.height / 2),
  };
  const display = screen.getDisplayNearestPoint(centerPoint) || screen.getPrimaryDisplay();
  const area = display.workArea;
  const [minWidth, minHeight] = win.getMinimumSize();
  const safeMinWidth = Math.max(640, Number.isFinite(minWidth) ? minWidth : 640);
  const safeMinHeight = Math.max(480, Number.isFinite(minHeight) ? minHeight : 480);
  const width = Math.max(safeMinWidth, Math.min(Math.round(targetWidth), area.width));
  const height = Math.max(safeMinHeight, Math.min(Math.round(targetHeight), area.height));
  const x = area.x + Math.floor((area.width - width) / 2);
  const y = area.y + Math.floor((area.height - height) / 2);

  win.setBounds({ x, y, width, height }, true);
  return win.getBounds();
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

ipcMain.handle('runtime:appendEventLogsCsv', async (_event, entries = []) => {
  try {
    const normalizedEntries = Array.isArray(entries)
      ? entries
          .map((entry) => {
            if (!entry || typeof entry !== 'object') return null;
            return {
              timestamp:
                typeof entry.timestamp === 'string' && entry.timestamp.trim()
                  ? entry.timestamp.trim()
                  : new Date().toISOString(),
              id:
                typeof entry.id === 'string' && entry.id.trim()
                  ? entry.id.trim()
                  : `EVT-${Date.now()}`,
              type:
                typeof entry.type === 'string' && entry.type.trim()
                  ? entry.type.trim()
                  : 'INFO',
              message:
                typeof entry.message === 'string' && entry.message.trim()
                  ? entry.message.trim()
                  : '',
              objectId:
                typeof entry.objectId === 'string' && entry.objectId.trim()
                  ? entry.objectId.trim()
                  : '',
              objectClass:
                typeof entry.objectClass === 'string' && entry.objectClass.trim()
                  ? entry.objectClass.trim()
                  : '',
            };
          })
          .filter(Boolean)
      : [];

    const result = appendEventLogsToCsv(normalizedEntries);
    return result;
  } catch (error) {
    pushLog('warn', `event log csv append failed: ${error.message}`);
    return { ok: false, count: 0, error: error.message };
  }
});

ipcMain.handle('runtime:listEventLogFiles', async () => {
  try {
    const directory = ensureEventLogDirectory();
    const files = fs
      .readdirSync(directory, { withFileTypes: true })
      .filter((entry) => entry.isFile() && /_event_log\.csv$/i.test(entry.name))
      .map((entry) => {
        const filePath = path.join(directory, entry.name);
        const stat = fs.statSync(filePath);
        return {
          name: entry.name,
          dateKey: entry.name.slice(0, 10),
          sizeBytes: stat.size,
          updatedAt: new Date(stat.mtimeMs).toISOString(),
        };
      })
      .sort((a, b) => b.name.localeCompare(a.name));

    return {
      ok: true,
      directory,
      files,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    pushLog('warn', `list event log files failed: ${message}`);
    return {
      ok: false,
      directory: getEventLogDirectoryPath(),
      files: [],
      error: message,
    };
  }
});

ipcMain.handle('runtime:readEventLogFile', async (_event, payload = {}) => {
  try {
    const rawFileName =
      typeof payload.fileName === 'string' && payload.fileName.trim() ? payload.fileName.trim() : '';
    const fileName = path.basename(rawFileName);

    if (!fileName || !/_event_log\.csv$/i.test(fileName)) {
      return {
        ok: false,
        fileName: '',
        content: '',
        error: 'invalid file name',
      };
    }

    const directory = ensureEventLogDirectory();
    const filePath = path.join(directory, fileName);
    if (!fs.existsSync(filePath)) {
      return {
        ok: false,
        fileName,
        content: '',
        error: 'file not found',
      };
    }

    const raw = fs.readFileSync(filePath);
    const decoded = decodeTextBuffer(raw);
    return {
      ok: true,
      fileName,
      content: decoded.text,
      encoding: decoded.encoding,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    pushLog('warn', `read event log file failed: ${message}`);
    return {
      ok: false,
      fileName: '',
      content: '',
      error: message,
    };
  }
});

ipcMain.handle('runtime:openEventLogViewer', async () => {
  try {
    await createLogViewerWindow();
    return { ok: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    pushLog('warn', `open event log viewer failed: ${message}`);
    return { ok: false, error: message };
  }
});

ipcMain.handle('runtime:openLayoutDevConsole', async () => {
  try {
    await createLayoutDevConsoleWindow();
    return { ok: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    pushLog('warn', `open layout dev console failed: ${message}`);
    return { ok: false, error: message };
  }
});

ipcMain.handle('runtime:getMainWindowBounds', async () => {
  const win = getLiveMainWindow();
  if (!win) {
    return {
      ok: false,
      error: 'main window unavailable',
    };
  }

  const bounds = win.getBounds();
  const [minWidth, minHeight] = win.getMinimumSize();
  return {
    ok: true,
    bounds,
    minWidth,
    minHeight,
  };
});

ipcMain.handle('runtime:setMainWindowSize', async (_event, payload = {}) => {
  const win = getLiveMainWindow();
  if (!win) {
    return {
      ok: false,
      error: 'main window unavailable',
    };
  }

  const width = Number(payload.width);
  const height = Number(payload.height);
  if (!Number.isFinite(width) || !Number.isFinite(height)) {
    return {
      ok: false,
      error: 'invalid size',
    };
  }

  const nextBounds = resizeMainWindowTo(width, height);
  if (!nextBounds) {
    return {
      ok: false,
      error: 'failed to resize main window',
    };
  }

  pushLog('info', `main window resized: ${nextBounds.width}x${nextBounds.height}`);
  return {
    ok: true,
    bounds: nextBounds,
  };
});

ipcMain.handle('runtime:pickModelPath', async (_event, options = {}) => {
  try {
    const title =
      typeof options.title === 'string' && options.title.trim()
        ? options.title.trim()
        : '모델 파일 또는 디렉터리 선택';
    let defaultPath;
    if (typeof options.defaultPath === 'string' && options.defaultPath.trim()) {
      const raw = options.defaultPath.trim();
      if (!/^https?:\/\//i.test(raw)) {
        const normalized = path.resolve(raw);
        const normalizedDir =
          fs.existsSync(normalized) && fs.statSync(normalized).isDirectory()
            ? normalized
            : path.dirname(normalized);
        if (fs.existsSync(normalizedDir)) {
          defaultPath = normalizedDir;
        }
      }
    }
    const result = await dialog.showOpenDialog(mainWindow ?? undefined, {
      title,
      defaultPath,
      properties: ['openFile', 'openDirectory', 'createDirectory'],
      filters: [
        {
          name: 'Model Files',
          extensions: ['onnx', 'pt', 'pth', 'bin', 'engine', 'trt', 'tflite', 'pb'],
        },
        { name: 'All Files', extensions: ['*'] },
      ],
    });
    return {
      canceled: result.canceled,
      path: result.filePaths[0] || null,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    pushLog('warn', `model path picker failed: ${message}`);
    return {
      canceled: true,
      path: null,
      error: message,
    };
  }
});

ipcMain.handle('runtime:pickDirectory', async (_event, options = {}) => {
  try {
    const title =
      typeof options.title === 'string' && options.title.trim()
        ? options.title.trim()
        : '폴더 선택';
    let defaultPath;
    if (typeof options.defaultPath === 'string' && options.defaultPath.trim()) {
      const raw = options.defaultPath.trim();
      if (!/^https?:\/\//i.test(raw)) {
        const normalized = path.resolve(raw);
        const normalizedDir = fs.existsSync(normalized) && fs.statSync(normalized).isDirectory()
          ? normalized
          : path.dirname(normalized);
        if (fs.existsSync(normalizedDir)) {
          defaultPath = normalizedDir;
        }
      }
    }
    const result = await dialog.showOpenDialog(mainWindow ?? undefined, {
      title,
      defaultPath,
      properties: ['openDirectory', 'createDirectory'],
    });
    return {
      canceled: result.canceled,
      path: result.filePaths[0] || null,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    pushLog('warn', `directory picker failed: ${message}`);
    return {
      canceled: true,
      path: null,
      error: message,
    };
  }
});

ipcMain.handle('runtime:readGeoJsonFromDirectory', async (_event, payload = {}) => {
  try {
    const rawBasePath =
      typeof payload.basePath === 'string' && payload.basePath.trim()
        ? payload.basePath.trim()
        : '';
    if (!rawBasePath) {
      return { ok: false, path: null, data: null };
    }

    const fileNames = Array.isArray(payload.fileNames)
      ? payload.fileNames
          .map((name) => (typeof name === 'string' ? path.basename(name.trim()) : ''))
          .filter((name) => name.length > 0)
      : [];

    if (fileNames.length === 0) {
      return { ok: false, path: null, data: null };
    }

    const basePath = path.resolve(rawBasePath);
    for (const fileName of fileNames) {
      const filePath = path.join(basePath, fileName);
      if (!fs.existsSync(filePath)) {
        continue;
      }

      try {
        const raw = fs.readFileSync(filePath, 'utf8');
        const data = JSON.parse(raw);
        return { ok: true, path: filePath, data };
      } catch {
        continue;
      }
    }

    return { ok: false, path: null, data: null };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    pushLog('warn', `readGeoJsonFromDirectory failed: ${message}`);
    return {
      ok: false,
      path: null,
      data: null,
      error: message,
    };
  }
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
  Menu.setApplicationMenu(null);
  runtimeConfig = loadRuntimeConfig();
  shutdownRequested = false;
  await createWindow();
  startInferenceService();
  startHealthMonitor();
  startResourceMonitor();
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
