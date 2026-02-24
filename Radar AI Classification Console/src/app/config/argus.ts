interface RuntimeArgusConfig {
  baseUrl?: string;
  framePath?: string;
  authToken?: string;
  pollIntervalMs?: number;
  requestTimeoutMs?: number;
  fallbackToMock?: boolean;
}

declare global {
  interface Window {
    __RADAR_RUNTIME__?: RuntimeArgusConfig;
  }
}

const toTrimmedString = (value: unknown): string => {
  if (typeof value !== 'string') {
    return '';
  }
  return value.trim();
};

const toPositiveInteger = (value: unknown, fallback: number): number => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.floor(parsed);
};

const readQueryValue = (key: string): string => {
  if (typeof window === 'undefined') {
    return '';
  }
  const queryValue = new URLSearchParams(window.location.search).get(key);
  return queryValue?.trim() || '';
};

const readRuntimeConfig = (): RuntimeArgusConfig => {
  if (typeof window === 'undefined') {
    return {};
  }
  return window.__RADAR_RUNTIME__ || {};
};

const runtimeConfig = readRuntimeConfig();
const baseUrl =
  toTrimmedString(import.meta.env.VITE_ARGUS_BASE_URL) ||
  toTrimmedString(runtimeConfig.baseUrl) ||
  readQueryValue('argusBaseUrl');
const framePath =
  toTrimmedString(import.meta.env.VITE_ARGUS_FRAME_PATH) ||
  toTrimmedString(runtimeConfig.framePath) ||
  '/api/v1/radar/frame';
const authToken =
  toTrimmedString(import.meta.env.VITE_ARGUS_AUTH_TOKEN) ||
  toTrimmedString(runtimeConfig.authToken);
const pollIntervalMs = toPositiveInteger(
  import.meta.env.VITE_ARGUS_POLL_INTERVAL_MS ??
    runtimeConfig.pollIntervalMs ??
    readQueryValue('argusPollMs'),
  200
);
const requestTimeoutMs = toPositiveInteger(
  import.meta.env.VITE_ARGUS_TIMEOUT_MS ??
    runtimeConfig.requestTimeoutMs ??
    readQueryValue('argusTimeoutMs'),
  1000
);
const fallbackToMockRaw = import.meta.env.VITE_ARGUS_FALLBACK_TO_MOCK;
const fallbackToMock =
  fallbackToMockRaw !== undefined
    ? String(fallbackToMockRaw).toLowerCase() !== 'false'
    : runtimeConfig.fallbackToMock ?? true;

export const ARGUS_CONFIG = {
  baseUrl,
  framePath,
  authToken,
  pollIntervalMs,
  requestTimeoutMs,
  fallbackToMock,
} as const;

export const isArgusConfigured = (): boolean => ARGUS_CONFIG.baseUrl.length > 0;

export const buildArgusUrl = (path: string): string => {
  if (/^https?:\/\//i.test(path)) {
    return path;
  }

  if (!ARGUS_CONFIG.baseUrl) {
    return path;
  }

  const normalizedBase = ARGUS_CONFIG.baseUrl.replace(/\/+$/, '');
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${normalizedBase}${normalizedPath}`;
};
