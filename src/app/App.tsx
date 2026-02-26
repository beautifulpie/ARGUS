import { useState, useEffect, useCallback, useRef } from 'react';
import { StatusBar } from './components/StatusBar';
import { LidarSpatialView } from './components/LidarSpatialView';
import { SelectedTargetPanel } from './components/SelectedTargetPanel';
import { ObjectListTable } from './components/ObjectListTable';
import { EventTimeline } from './components/EventTimeline';
import { AutoTrackingDialog } from './components/AutoTrackingDialog';
import { DeveloperAccessDialog } from './components/DeveloperAccessDialog';
import {
  SettingsDialog,
  type ConsoleSettings,
  type PositionCodePreset,
} from './components/SettingsDialog';
import {
  updateObjectTracking,
  consumeMockLostReasons,
  generateSystemStatus,
  generateEvent,
  generateObjectEvent,
  generateDetectedObject,
} from './utils/mockData';
import { ARGUS_CONFIG, isArgusConfigured } from './config/argus';
import { fetchArgusFrame } from './services/argusBridge';
import {
  LAYOUT_DEV_CONFIG_STORAGE_KEY,
  type LayoutDevConfig,
  sanitizeLayoutDevConfig,
  readLayoutDevConfig,
} from './layoutDevConfig';
import {
  TimelineEvent,
  SystemStatus,
  DetectedObject,
  ObjectClass,
} from './types';

import { CandidateTracksPanel } from './components/CandidateTracksPanel';

const MAX_EVENT_LOGS = 400;
const SETTINGS_STORAGE_KEY = 'argus.console.settings.v1';
const MAP_CALIBRATION_STORAGE_KEY = 'argus.map.calibration.v1';
const DEV_MODEL_PATH_STORAGE_KEY = 'argus.developer.model-path.v1';

const DEV_CREDENTIAL_HASH = {
  id: '8c6976e5b5410415bde908bd4dee15dfb167a9c873fc4bb8a81f6f2ab448a918',
  password: 'ee260f08526f9930ff7d9450916b76a7ce3d2f4b924dfdb84dd0fa77dfa1d8aa',
} as const;

type RuntimeResourceMetrics = Partial<Pick<SystemStatus, 'cpuUsage' | 'gpuUsage' | 'ramUsage'>>;

interface RuntimeStatusPayload {
  resources?: RuntimeResourceMetrics;
}

interface TimelineCsvLogEntry {
  id: string;
  timestamp: string;
  type: string;
  message: string;
  objectId?: string;
  objectClass?: string;
}

interface RadarRuntimeBridge {
  getStatus?: () => Promise<RuntimeStatusPayload>;
  onStatus?: (handler: (payload: RuntimeStatusPayload) => void) => (() => void) | void;
  updateConfig?: (patch: Record<string, unknown>) => Promise<unknown>;
  appendEventLogsCsv?: (entries: TimelineCsvLogEntry[]) => Promise<unknown>;
  pickDirectory?: (options?: { title?: string; defaultPath?: string }) => Promise<unknown>;
  openEventLogViewer?: () => Promise<unknown>;
  openLayoutDevConsole?: () => Promise<unknown>;
}

const POSITION_CODE_PRESETS: PositionCodePreset[] = [
  { code: 'ARGUS-HQ', name: 'ARGUS 본부 (서울)', lat: 36.3001071, lon: 127.2305427 },
  { code: 'ROK-CP-NORTH', name: '북부 지휘소', lat: 37.9107827915598, lon: 126.895791134059 },
  { code: 'ROK-CP-SOUTH', name: '남부 지휘소', lat: 35.1796, lon: 129.0756 },
  { code: 'ROK-CP-EAST', name: '동부 지휘소', lat: 37.7519, lon: 128.8761 },
  { code: 'ROK-CP-JEJU', name: '제주 지휘소', lat: 33.4996, lon: 126.5312 },
  { code: 'ROK-CP-WEST', name: '서해 지휘소', lat: 36.4875, lon: 126.2637 },
];

const DEFAULT_CONSOLE_SETTINGS: ConsoleSettings = {
  mapCenter: {
    lat: 36.3001071,
    lon: 127.2305427,
  },
  positionCode: 'ARGUS-HQ',
  modelPath: '',
  detectionMode: 'ACCURACY',
  mapLabelLevel: 'EMD',
  mapTheme: 'DARK',
  showUtmGrid: true,
  showMgrsLabels: true,
  mapDataPath: '/official',
  mapDataLoadNonce: 0,
};

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const sanitizeCenter = (lat: number, lon: number) => ({
  lat: clamp(lat, 32.7, 39.9),
  lon: clamp(lon, 123.0, 132.2),
});

const sha256Hex = async (value: string): Promise<string> => {
  const encoded = new TextEncoder().encode(value);
  const digest = await window.crypto.subtle.digest('SHA-256', encoded);
  const bytes = new Uint8Array(digest);
  return Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
};

const normalizeMapLabelLevel = (
  value: unknown,
  legacyScaleValue: unknown,
  fallback: ConsoleSettings['mapLabelLevel']
): ConsoleSettings['mapLabelLevel'] => {
  if (value === 'PROVINCE' || value === 'DISTRICT' || value === 'EMD') {
    return value;
  }

  if (typeof legacyScaleValue === 'number' && Number.isFinite(legacyScaleValue)) {
    if (legacyScaleValue <= 0.2) return 'PROVINCE';
    if (legacyScaleValue <= 0.9) return 'DISTRICT';
    return 'EMD';
  }

  if (typeof legacyScaleValue === 'object' && legacyScaleValue !== null) {
    const record = legacyScaleValue as Record<string, unknown>;
    const province = Number(record.province);
    const district = Number(record.district);
    const emd = Number(record.emd);
    if (Number.isFinite(emd) && emd > 0.05) return 'EMD';
    if (Number.isFinite(district) && district > 0.05) return 'DISTRICT';
    if (Number.isFinite(province) && province > 0.05) return 'PROVINCE';
  }

  return fallback;
};

const readInitialSettings = (): ConsoleSettings => {
  if (typeof window === 'undefined') {
    return DEFAULT_CONSOLE_SETTINGS;
  }

  let loaded = { ...DEFAULT_CONSOLE_SETTINGS };

  try {
    const raw = window.localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<ConsoleSettings>;
      const parsedRecord = parsed as Record<string, unknown>;
      const parsedLat = Number(parsed.mapCenter?.lat);
      const parsedLon = Number(parsed.mapCenter?.lon);
      const fallbackCenter =
        Number.isFinite(parsedLat) && Number.isFinite(parsedLon)
          ? sanitizeCenter(parsedLat, parsedLon)
          : loaded.mapCenter;

      loaded = {
        mapCenter: fallbackCenter,
        positionCode:
          typeof parsed.positionCode === 'string'
            ? parsed.positionCode
            : loaded.positionCode,
        modelPath: typeof parsed.modelPath === 'string' ? parsed.modelPath : loaded.modelPath,
        detectionMode:
          parsed.detectionMode === 'SPEED' || parsed.detectionMode === 'ACCURACY'
            ? parsed.detectionMode
            : loaded.detectionMode,
        mapLabelLevel: normalizeMapLabelLevel(
          parsed.mapLabelLevel,
          parsedRecord.mapLabelScale,
          loaded.mapLabelLevel
        ),
        mapTheme: parsed.mapTheme === 'LIGHT' || parsed.mapTheme === 'DARK'
          ? parsed.mapTheme
          : loaded.mapTheme,
        showUtmGrid:
          typeof parsed.showUtmGrid === 'boolean'
            ? parsed.showUtmGrid
            : loaded.showUtmGrid,
        showMgrsLabels:
          typeof parsed.showMgrsLabels === 'boolean'
            ? parsed.showMgrsLabels
            : loaded.showMgrsLabels,
        mapDataPath:
          typeof parsed.mapDataPath === 'string' && parsed.mapDataPath.trim()
            ? parsed.mapDataPath
            : loaded.mapDataPath,
        mapDataLoadNonce: Number.isFinite(Number(parsed.mapDataLoadNonce))
          ? Math.max(0, Math.floor(Number(parsed.mapDataLoadNonce)))
          : loaded.mapDataLoadNonce,
      };
    }
  } catch {
    // Ignore malformed settings payload.
  }

  try {
    const calibrationRaw = window.localStorage.getItem(MAP_CALIBRATION_STORAGE_KEY);
    if (calibrationRaw) {
      const calibration = JSON.parse(calibrationRaw) as { lat?: number; lon?: number };
      if (Number.isFinite(calibration.lat) && Number.isFinite(calibration.lon)) {
        loaded = {
          ...loaded,
          mapCenter: sanitizeCenter(Number(calibration.lat), Number(calibration.lon)),
        };
      }
    }
  } catch {
    // Ignore malformed calibration payload.
  }

  try {
    const devModelPath = window.localStorage.getItem(DEV_MODEL_PATH_STORAGE_KEY);
    if (typeof devModelPath === 'string' && devModelPath.trim()) {
      loaded = {
        ...loaded,
        modelPath: devModelPath.trim(),
      };
    }
  } catch {
    // Ignore malformed developer model path payload.
  }

  return loaded;
};

const adjustStatusForConsoleSettings = (
  status: SystemStatus,
  settings: ConsoleSettings,
  applyPerformanceProfile: boolean
): SystemStatus => {
  const tuned = { ...status };
  const modeScale = settings.detectionMode === 'ACCURACY' ? 1.18 : 0.82;

  const tuneMetric = (value: number | undefined, scale: number) =>
    typeof value === 'number' ? Math.max(0, value * scale) : value;

  if (applyPerformanceProfile) {
    tuned.latency = clamp(tuned.latency * modeScale, 0, 5000);
    tuned.modelLatencyP50 = tuneMetric(tuned.modelLatencyP50, modeScale);
    tuned.modelLatencyP95 = tuneMetric(tuned.modelLatencyP95, modeScale);
    tuned.inferenceLatencyP50 = tuneMetric(tuned.inferenceLatencyP50, modeScale);
    tuned.inferenceLatencyP95 = tuneMetric(tuned.inferenceLatencyP95, modeScale);
    tuned.pipelineLatencyP95 = tuneMetric(
      tuned.pipelineLatencyP95,
      settings.detectionMode === 'ACCURACY' ? 1.1 : 0.92
    );
  }

  const modeLabel = settings.detectionMode === 'ACCURACY' ? '정확성 우선' : '속도 우선';
  const modelFileName = settings.modelPath.trim().split(/[\\/]/).filter(Boolean).pop();
  if (modelFileName) {
    tuned.modelName = modelFileName;
  }
  tuned.modelVersion = `${status.modelVersion} · ${modeLabel}`;

  return tuned;
};

const getDataFrameStrideForMode = (mode: ConsoleSettings['detectionMode']) =>
  mode === 'SPEED' ? 4 : 1;

const getMockTickIntervalMsForMode = (mode: ConsoleSettings['detectionMode']) =>
  mode === 'SPEED' ? 50 : 50;

type MockLostReason = 'OUT_OF_RANGE' | 'SIGNAL_LOST';

const buildObjectChangeEvents = (
  previousObjects: DetectedObject[],
  nextObjects: DetectedObject[],
  lostReasons?: Map<string, MockLostReason>
): TimelineEvent[] => {
  const previousMap = new Map(previousObjects.map((obj) => [obj.id, obj]));
  const nextMap = new Map(nextObjects.map((obj) => [obj.id, obj]));
  const events: TimelineEvent[] = [];

  nextObjects.forEach((obj) => {
    const previous = previousMap.get(obj.id);
    if (!previous) {
      events.push(generateObjectEvent(obj, 'DETECTED'));
      return;
    }

    if (obj.status === 'LOST' && previous.status !== 'LOST') {
      events.push(generateObjectEvent(obj, 'LOST'));
      return;
    }

    if (Math.abs(obj.speed - previous.speed) > 3) {
      events.push(generateObjectEvent(obj, 'SPEED_CHANGE'));
      return;
    }

    if (
      obj.riskLevel !== previous.riskLevel &&
      (obj.riskLevel === 'HIGH' || obj.riskLevel === 'CRITICAL')
    ) {
      events.push(generateObjectEvent(obj, 'RISK_CHANGE'));
    }

    const threshold = obj.uavThreshold ?? 35;
    const previousProbability = previous.uavProbability ?? 0;
    const currentProbability = obj.uavProbability ?? 0;
    const crossedToUav = previousProbability < threshold && currentProbability >= threshold;
    const decisionChangedToUav = previous.uavDecision !== 'UAV' && obj.uavDecision === 'UAV';

    if (crossedToUav || decisionChangedToUav) {
      events.push(
        generateEvent(
          'ALERT',
          `${obj.id} UAV 의심 객체 감지 (${currentProbability.toFixed(1)}%)`,
          obj.id,
          obj.class
        )
      );
    } else if (previous.uavDecision === 'UAV' && obj.uavDecision === 'NON_UAV') {
      events.push(
        generateEvent(
          'INFO',
          `${obj.id} UAV 판정 해제 (${currentProbability.toFixed(1)}%)`,
          obj.id,
          obj.class
        )
      );
    }
  });

  previousObjects.forEach((obj) => {
    if (!nextMap.has(obj.id)) {
      const lostReason = lostReasons?.get(obj.id);
      if (lostReason === 'OUT_OF_RANGE') {
        events.push(
          generateEvent(
            'WARNING',
            `관측 반경(35km) 이탈로 트랙 손실 (${obj.id})`,
            obj.id,
            obj.class
          )
        );
      } else if (lostReason === 'SIGNAL_LOST') {
        events.push(
          generateEvent(
            'WARNING',
            `신호 소실로 트랙 손실 (${obj.id})`,
            obj.id,
            obj.class
          )
        );
      } else {
        events.push(generateObjectEvent({ ...obj, status: 'LOST' }, 'LOST'));
      }
    }
  });

  return events;
};

function App() {
  const useArgusBridge = isArgusConfigured();
  const [settings, setSettings] = useState<ConsoleSettings>(() => readInitialSettings());
  const [layoutDevConfig, setLayoutDevConfig] = useState<LayoutDevConfig>(() => readLayoutDevConfig());
  const [previewTheme, setPreviewTheme] = useState<ConsoleSettings['mapTheme'] | null>(null);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isAutoTrackingOpen, setIsAutoTrackingOpen] = useState(false);
  const [isAutoTrackingEnabled, setIsAutoTrackingEnabled] = useState(false);
  const [isDeveloperAuthOpen, setIsDeveloperAuthOpen] = useState(false);
  const [isDeveloperAuthPending, setIsDeveloperAuthPending] = useState(false);
  const [developerAuthError, setDeveloperAuthError] = useState<string | null>(null);
  const [isLive, setIsLive] = useState(false);
  const [isFrozen, setIsFrozen] = useState(false);
  const [objects, setObjects] = useState<DetectedObject[]>([]);
  const [frozenSnapshotObjects, setFrozenSnapshotObjects] = useState<DetectedObject[] | null>(null);
  const [selectedObjectId, setSelectedObjectId] = useState<string | null>(null);
  const [events, setEvents] = useState<TimelineEvent[]>([]);
  const [systemStatus, setSystemStatus] = useState<SystemStatus>(() => 
    generateSystemStatus(false, 0)
  );
  const objectsRef = useRef<DetectedObject[]>([]);
  const trackClassByIdRef = useRef<Map<string, ObjectClass>>(new Map());
  const argusErrorLoggedRef = useRef(false);
  const previousDetectionModeRef = useRef(settings.detectionMode);
  const runtimeResourcesRef = useRef<RuntimeResourceMetrics | null>(null);
  const pendingTimelineLogEventsRef = useRef<TimelineEvent[]>([]);
  const dataUpdateTimestampsRef = useRef<number[]>([]);
  const dataUpdateFpsRef = useRef(0);
  const mockTickCounterRef = useRef(0);
  const mockPendingDeltaRef = useRef(0);
  const mockLastTickTimestampRef = useRef<number | null>(null);
  const isFrozenRef = useRef(isFrozen);
  const isLiveRef = useRef(isLive);
  const frozenObjectsRef = useRef<DetectedObject[] | null>(null);
  const logoSecretTapRef = useRef<{ count: number; lastAt: number }>({ count: 0, lastAt: 0 });

  const mergeRuntimeResources = useCallback((status: SystemStatus, fallback?: SystemStatus): SystemStatus => {
    const runtimeResources = runtimeResourcesRef.current;
    if (!runtimeResources) {
      return status;
    }

    const fallbackStatus = fallback ?? status;

    return {
      ...status,
      cpuUsage:
        typeof runtimeResources.cpuUsage === 'number'
          ? clamp(runtimeResources.cpuUsage, 0, 100)
          : fallbackStatus.cpuUsage,
      gpuUsage:
        typeof runtimeResources.gpuUsage === 'number'
          ? clamp(runtimeResources.gpuUsage, 0, 100)
          : fallbackStatus.gpuUsage,
      ramUsage:
        typeof runtimeResources.ramUsage === 'number'
          ? clamp(runtimeResources.ramUsage, 0, 100)
          : fallbackStatus.ramUsage,
    };
  }, []);

  const setDataUpdateFps = useCallback((fps: number) => {
    const normalized = clamp(fps, 0, 240);
    dataUpdateFpsRef.current = normalized;
    setSystemStatus((prev) => {
      const current = prev.measuredFps ?? prev.fps;
      if (Math.abs(current - normalized) < 0.05 && Math.abs(prev.fps - normalized) < 0.05) {
        return prev;
      }
      return {
        ...prev,
        fps: normalized,
        measuredFps: normalized,
      };
    });
  }, []);

  const applyDataUpdateFps = useCallback(
    (status: SystemStatus, forceZero = false): SystemStatus => {
      const nextFps = forceZero || !isLive || isFrozen ? 0 : dataUpdateFpsRef.current;
      return {
        ...status,
        fps: nextFps,
        measuredFps: nextFps,
      };
    },
    [isFrozen, isLive]
  );

  const recordDataUpdateFrame = useCallback(() => {
    const now =
      typeof performance !== 'undefined' && typeof performance.now === 'function'
        ? performance.now()
        : Date.now();
    const windowMs = 4000;
    const timestamps = dataUpdateTimestampsRef.current;
    timestamps.push(now);
    while (timestamps.length > 0 && now - timestamps[0] > windowMs) {
      timestamps.shift();
    }

    const fps =
      timestamps.length >= 2
        ? ((timestamps.length - 1) * 1000) / Math.max(1, now - timestamps[0])
        : 0;
    setDataUpdateFps(fps);
  }, [setDataUpdateFps]);

  useEffect(() => {
    objectsRef.current = objects;
    for (const obj of objects) {
      trackClassByIdRef.current.set(obj.id, obj.class);
    }
  }, [objects]);

  useEffect(() => {
    isFrozenRef.current = isFrozen;
  }, [isFrozen]);

  useEffect(() => {
    isLiveRef.current = isLive;
  }, [isLive]);

  useEffect(() => {
    mockTickCounterRef.current = 0;
    mockPendingDeltaRef.current = 0;
    mockLastTickTimestampRef.current = null;
    if (!isLive || isFrozen) {
      dataUpdateTimestampsRef.current = [];
      setDataUpdateFps(0);
    }
  }, [isLive, isFrozen, setDataUpdateFps]);

  useEffect(() => {
    mockTickCounterRef.current = 0;
    mockPendingDeltaRef.current = 0;
    mockLastTickTimestampRef.current = null;
    dataUpdateTimestampsRef.current = [];
    setDataUpdateFps(0);
  }, [settings.detectionMode, setDataUpdateFps]);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    window.localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
    window.localStorage.setItem(
      MAP_CALIBRATION_STORAGE_KEY,
      JSON.stringify({
        lat: settings.mapCenter.lat,
        lon: settings.mapCenter.lon,
      })
    );
  }, [settings]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(DEV_MODEL_PATH_STORAGE_KEY, settings.modelPath ?? '');
  }, [settings.modelPath]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(
      LAYOUT_DEV_CONFIG_STORAGE_KEY,
      JSON.stringify(sanitizeLayoutDevConfig(layoutDevConfig))
    );
  }, [layoutDevConfig]);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const handleStorage = (event: StorageEvent) => {
      if (event.key !== LAYOUT_DEV_CONFIG_STORAGE_KEY) return;
      setLayoutDevConfig(readLayoutDevConfig());
    };

    window.addEventListener('storage', handleStorage);
    return () => {
      window.removeEventListener('storage', handleStorage);
    };
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const handleStorage = (event: StorageEvent) => {
      if (event.key !== DEV_MODEL_PATH_STORAGE_KEY) return;
      const nextModelPath = typeof event.newValue === 'string' ? event.newValue : '';
      setSettings((prev) => {
        if (prev.modelPath === nextModelPath) return prev;
        return {
          ...prev,
          modelPath: nextModelPath,
        };
      });
    };

    window.addEventListener('storage', handleStorage);
    return () => {
      window.removeEventListener('storage', handleStorage);
    };
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const runtime = (window as Window & { radarRuntime?: RadarRuntimeBridge }).radarRuntime;
    if (!runtime) return;

    let disposed = false;

    const applyRuntimeResources = (payload?: RuntimeStatusPayload | null) => {
      const resources = payload?.resources;
      if (!resources) return;
      runtimeResourcesRef.current = resources;
      setSystemStatus((prev) => applyDataUpdateFps(mergeRuntimeResources(prev, prev)));
    };

    if (typeof runtime.getStatus === 'function') {
      runtime
        .getStatus()
        .then((payload) => {
          if (disposed) return;
          applyRuntimeResources(payload);
        })
        .catch(() => {
          // Ignore runtime bridge errors in web mode/dev fallback.
        });
    }

    let unsubscribe: (() => void) | undefined;
    if (typeof runtime.onStatus === 'function') {
      const maybeUnsubscribe = runtime.onStatus((payload) => {
        if (disposed) return;
        applyRuntimeResources(payload);
      });
      if (typeof maybeUnsubscribe === 'function') {
        unsubscribe = maybeUnsubscribe;
      }
    }

    return () => {
      disposed = true;
      unsubscribe?.();
    };
  }, [mergeRuntimeResources, applyDataUpdateFps]);

  const appendEvents = useCallback((nextEvents: TimelineEvent[]) => {
    if (nextEvents.length === 0) {
      return;
    }

    const normalizedEvents = nextEvents.map((event) => {
      const knownClass =
        event.objectClass && event.objectClass !== 'UNKNOWN'
          ? event.objectClass
          : event.objectId
          ? trackClassByIdRef.current.get(event.objectId) ?? 'UNKNOWN'
          : 'UNKNOWN';

      if (event.objectId && knownClass !== 'UNKNOWN') {
        trackClassByIdRef.current.set(event.objectId, knownClass);
      }

      return {
        ...event,
        objectClass: knownClass,
      };
    });

    const runtime = (window as Window & { radarRuntime?: RadarRuntimeBridge }).radarRuntime;
    if (runtime && typeof runtime.appendEventLogsCsv === 'function') {
      pendingTimelineLogEventsRef.current.push(...normalizedEvents);
    }

    setEvents((prev) => [...prev, ...normalizedEvents].slice(-MAX_EVENT_LOGS));
  }, []);

  const flushTimelineEventLogs = useCallback(async () => {
    if (typeof window === 'undefined') return;
    const runtime = (window as Window & { radarRuntime?: RadarRuntimeBridge }).radarRuntime;
    if (!runtime || typeof runtime.appendEventLogsCsv !== 'function') return;
    if (pendingTimelineLogEventsRef.current.length === 0) return;

    const batch = pendingTimelineLogEventsRef.current.splice(0, pendingTimelineLogEventsRef.current.length);
    const payload: TimelineCsvLogEntry[] = batch.map((event) => {
      const parsedDate =
        event.timestamp instanceof Date ? event.timestamp : new Date(event.timestamp as unknown as string);
      const timestampIso = Number.isNaN(parsedDate.getTime())
        ? new Date().toISOString()
        : parsedDate.toISOString();

      return {
        id: event.id,
        timestamp: timestampIso,
        type: event.type,
        message: event.message,
        objectId: event.objectId,
        objectClass: event.objectClass,
      };
    });

    try {
      await runtime.appendEventLogsCsv(payload);
    } catch {
      // If write fails, prepend batch back to queue so it can retry next cycle.
      pendingTimelineLogEventsRef.current = [...batch, ...pendingTimelineLogEventsRef.current];
    }
  }, []);

  useEffect(() => {
    const interval = window.setInterval(() => {
      void flushTimelineEventLogs();
    }, 60_000);

    return () => {
      window.clearInterval(interval);
      void flushTimelineEventLogs();
    };
  }, [flushTimelineEventLogs]);

  const runMockTick = useCallback(() => {
    if (isFrozenRef.current || !isLiveRef.current) {
      mockLastTickTimestampRef.current = null;
      return;
    }
    const frameStride = getDataFrameStrideForMode(settings.detectionMode);
    const shouldSkipDataFrame = mockTickCounterRef.current % frameStride !== 0;
    const defaultTickDeltaSeconds = getMockTickIntervalMsForMode(settings.detectionMode) / 1000;
    const nowMs =
      typeof performance !== 'undefined' && typeof performance.now === 'function'
        ? performance.now()
        : Date.now();
    const previousTickMs = mockLastTickTimestampRef.current;
    mockLastTickTimestampRef.current = nowMs;
    const tickDeltaSeconds =
      previousTickMs === null
        ? defaultTickDeltaSeconds
        : clamp((nowMs - previousTickMs) / 1000, 0.01, 2);
    mockTickCounterRef.current += 1;

    if (!shouldSkipDataFrame) {
      const mockDeltaSeconds = tickDeltaSeconds + mockPendingDeltaRef.current;
      mockPendingDeltaRef.current = 0;
      setObjects((prevObjects) => {
        if (prevObjects.length === 0) {
          const seedCount = 3 + Math.floor(Math.random() * 4);
          const seededObjects: DetectedObject[] = Array.from({ length: seedCount }, () =>
            generateDetectedObject()
          );
          appendEvents(buildObjectChangeEvents(prevObjects, seededObjects));
          return seededObjects;
        }

        const nextObjects = updateObjectTracking(prevObjects, mockDeltaSeconds);
        appendEvents(buildObjectChangeEvents(prevObjects, nextObjects, consumeMockLostReasons()));
        return nextObjects;
      });
      recordDataUpdateFrame();
    } else {
      mockPendingDeltaRef.current += tickDeltaSeconds;
    }

    setSystemStatus((prev) =>
      mergeRuntimeResources(
        applyDataUpdateFps(
          adjustStatusForConsoleSettings(
            generateSystemStatus(true, prev.trackedObjects),
            settings,
            true
          )
        ),
        prev
      )
    );
  }, [appendEvents, settings, mergeRuntimeResources, recordDataUpdateFrame, applyDataUpdateFps]);

  useEffect(() => {
    const runtime = (window as Window & { radarRuntime?: RadarRuntimeBridge }).radarRuntime;
    if (runtime && typeof runtime.updateConfig === 'function') {
      void runtime.updateConfig({
        detectionMode: settings.detectionMode,
        resourceMonitorIntervalMs: settings.detectionMode === 'SPEED' ? 5000 : 1000,
        modelPath: settings.modelPath.trim(),
      });
    }
  }, [settings.detectionMode, settings.modelPath]);

  useEffect(() => {
    if (previousDetectionModeRef.current === settings.detectionMode) {
      return;
    }
    const modeLabel = settings.detectionMode === 'ACCURACY' ? '정확성 우선' : '속도 우선';
    appendEvents([generateEvent('INFO', `탐지 모드 변경: ${modeLabel}`)]);
    previousDetectionModeRef.current = settings.detectionMode;
  }, [settings.detectionMode, appendEvents]);

  // Real-time simulation when live
  useEffect(() => {
    if (!isLive || isFrozen) return;

    let isDisposed = false;
    let isTickRunning = false;

    const tick = async () => {
      if (isDisposed || isTickRunning) {
        return;
      }

      isTickRunning = true;

      try {
        if (!useArgusBridge) {
          runMockTick();
          return;
        }

        const frame = await fetchArgusFrame(objectsRef.current);
        if (isDisposed || isFrozenRef.current || !isLiveRef.current) {
          return;
        }

        const frameStride = getDataFrameStrideForMode(settings.detectionMode);
        const shouldSkipDataFrame = mockTickCounterRef.current % frameStride !== 0;
        mockTickCounterRef.current += 1;

        if (shouldSkipDataFrame) {
          setSystemStatus((prev) =>
            mergeRuntimeResources(
              applyDataUpdateFps(adjustStatusForConsoleSettings(frame.systemStatus, settings, false)),
              prev
            )
          );
          argusErrorLoggedRef.current = false;
          return;
        }

        if (frame.objects.length === 0) {
          if (ARGUS_CONFIG.fallbackToMock) {
            runMockTick();
            argusErrorLoggedRef.current = false;
            return;
          }

          if (objectsRef.current.length > 0) {
            setSystemStatus((prev) =>
              mergeRuntimeResources(
                applyDataUpdateFps(adjustStatusForConsoleSettings(frame.systemStatus, settings, false)),
                prev
              )
            );
            argusErrorLoggedRef.current = false;
            return;
          }
        }

        for (const obj of frame.objects) {
          trackClassByIdRef.current.set(obj.id, obj.class);
        }

        const derivedEvents = buildObjectChangeEvents(objectsRef.current, frame.objects);
        setObjects(frame.objects);
        recordDataUpdateFrame();
        setSystemStatus((prev) =>
          mergeRuntimeResources(
            applyDataUpdateFps(adjustStatusForConsoleSettings(frame.systemStatus, settings, false)),
            prev
          )
        );
        appendEvents([...derivedEvents, ...frame.events]);
        argusErrorLoggedRef.current = false;
      } catch (error) {
        if (isDisposed || isFrozenRef.current || !isLiveRef.current) {
          return;
        }

        if (!argusErrorLoggedRef.current) {
          const reason = error instanceof Error ? error.message : '알 수 없는 오류';
          appendEvents([generateEvent('WARNING', `ARGUS 연동 실패: ${reason}`)]);
          argusErrorLoggedRef.current = true;
        }

        if (ARGUS_CONFIG.fallbackToMock) {
          runMockTick();
        } else {
          dataUpdateTimestampsRef.current = [];
          setDataUpdateFps(0);
          setSystemStatus((prev) => ({
            ...applyDataUpdateFps(mergeRuntimeResources(prev, prev), true),
            connectionStatus: 'DISCONNECTED',
            sensorStatus: 'DEGRADED',
          }));
        }
      } finally {
        isTickRunning = false;
      }
    };

    const intervalMs = useArgusBridge
      ? ARGUS_CONFIG.pollIntervalMs
      : getMockTickIntervalMsForMode(settings.detectionMode);
    void tick();
    const interval = setInterval(() => {
      void tick();
    }, intervalMs);

    return () => {
      isDisposed = true;
      clearInterval(interval);
    };
  }, [
    isLive,
    isFrozen,
    settings.detectionMode,
    useArgusBridge,
    runMockTick,
    recordDataUpdateFrame,
    applyDataUpdateFps,
    appendEvents,
    mergeRuntimeResources,
    setDataUpdateFps,
  ]);

  // Add initial events and objects when going live
  useEffect(() => {
    if (isLive) {
      appendEvents([
        generateEvent('INFO', '시스템 온라인'),
        generateEvent(
          'INFO',
          useArgusBridge
            ? `ARGUS 브리지 연결 모드 (${ARGUS_CONFIG.baseUrl})`
            : 'ARGUS 센서 모드 활성화'
        ),
      ]);

      if (useArgusBridge) {
        setObjects([]);
      } else {
        const initialObjects: DetectedObject[] = [];
        const numInitial = 3 + Math.floor(Math.random() * 4); // 3-6 initial objects
        for (let i = 0; i < numInitial; i += 1) {
          initialObjects.push(generateDetectedObject());
        }
        setObjects(initialObjects);
        recordDataUpdateFrame();

        setTimeout(() => {
          appendEvents(
            initialObjects.map((obj) => generateObjectEvent(obj, 'DETECTED'))
          );
        }, 500);
      }
    } else {
      // Clear objects when stopping
      setObjects([]);
      setFrozenSnapshotObjects(null);
      setSelectedObjectId(null);
      dataUpdateTimestampsRef.current = [];
      setDataUpdateFps(0);
      setSystemStatus((prev) =>
        mergeRuntimeResources(applyDataUpdateFps(generateSystemStatus(false, 0), true), prev)
      );
      argusErrorLoggedRef.current = false;
    }
  }, [
    isLive,
    useArgusBridge,
    appendEvents,
    mergeRuntimeResources,
    recordDataUpdateFrame,
    setDataUpdateFps,
    applyDataUpdateFps,
  ]);

  const visibleObjects = isFrozen && frozenSnapshotObjects ? frozenSnapshotObjects : objects;

  // Update system status with current object count
  useEffect(() => {
    setSystemStatus((prev) => ({
      ...applyDataUpdateFps(mergeRuntimeResources(prev, prev)),
      trackedObjects: visibleObjects.length,
      activeTracksCount: visibleObjects.filter(obj => obj.status === 'STABLE' || obj.status === 'TRACKING').length,
    }));
  }, [visibleObjects, mergeRuntimeResources, applyDataUpdateFps]);

  useEffect(() => {
    if (!selectedObjectId) {
      return;
    }

    const stillExists = visibleObjects.some((obj) => obj.id === selectedObjectId);
    if (!stillExists) {
      setSelectedObjectId(null);
    }
  }, [visibleObjects, selectedObjectId]);

  const handleToggleLive = useCallback(() => {
    setIsLive((prev) => {
      const next = !prev;
      isLiveRef.current = next;
      return next;
    });
    setIsFrozen(false);
    isFrozenRef.current = false;
    frozenObjectsRef.current = null;
    setFrozenSnapshotObjects(null);
  }, []);

  const handleFreeze = useCallback(() => {
    const next = !isFrozenRef.current;
    isFrozenRef.current = next;
    setIsFrozen(next);

    if (next) {
      // Keep current tracks on screen while data updates are paused.
      frozenObjectsRef.current = objectsRef.current;
      setFrozenSnapshotObjects(objectsRef.current);
      if (objectsRef.current.length > 0) {
        setObjects(objectsRef.current);
      }
      appendEvents([generateEvent('INFO', '디스플레이 정지됨')]);
    } else {
      frozenObjectsRef.current = null;
      setFrozenSnapshotObjects(null);
    }
  }, [appendEvents]);

  const handleMarkEvent = useCallback(() => {
    appendEvents([generateEvent('WARNING', '운영자가 이벤트를 표시함')]);
  }, [appendEvents]);

  const handleExport = useCallback(() => {
    appendEvents([generateEvent('INFO', '로그 내보내기 시작됨')]);
    // In real app, would trigger export
    console.log('Export log:', events);
    console.log('Export objects:', objects);
  }, [events, objects, appendEvents]);

  const handleOpenLogViewer = useCallback(() => {
    const runtime = (window as Window & { radarRuntime?: RadarRuntimeBridge }).radarRuntime;
    if (runtime && typeof runtime.openEventLogViewer === 'function') {
      void runtime.openEventLogViewer();
      return;
    }

    if (typeof window !== 'undefined') {
      window.open('/log-viewer.html', '_blank', 'noopener,noreferrer,width=1280,height=820');
    }
  }, []);

  const handleOpenLayoutDevConsole = useCallback(() => {
    const runtime = (window as Window & { radarRuntime?: RadarRuntimeBridge }).radarRuntime;
    if (runtime && typeof runtime.openLayoutDevConsole === 'function') {
      void runtime.openLayoutDevConsole();
      return;
    }

    if (typeof window !== 'undefined') {
      window.open(
        '/layout-dev-console.html',
        'argus-layout-dev-console',
        'noopener,noreferrer,width=640,height=760'
      );
    }
  }, []);

  const handleLogoSecretTap = useCallback(() => {
    const now = Date.now();
    const tapState = logoSecretTapRef.current;
    if (now - tapState.lastAt > 1800) {
      tapState.count = 0;
    }
    tapState.lastAt = now;
    tapState.count += 1;

    if (tapState.count >= 10) {
      tapState.count = 0;
      setDeveloperAuthError(null);
      setIsDeveloperAuthOpen(true);
    }
  }, []);

  const handleCloseDeveloperAuth = useCallback(() => {
    if (isDeveloperAuthPending) return;
    setDeveloperAuthError(null);
    setIsDeveloperAuthOpen(false);
  }, [isDeveloperAuthPending]);

  const handleDeveloperAuthSubmit = useCallback(
    async ({ id, password }: { id: string; password: string }) => {
      if (!id || !password) {
        setDeveloperAuthError('인증 정보를 입력해 주세요.');
        return;
      }

      try {
        setIsDeveloperAuthPending(true);
        setDeveloperAuthError(null);
        const [idHash, passwordHash] = await Promise.all([sha256Hex(id), sha256Hex(password)]);
        const authenticated =
          idHash === DEV_CREDENTIAL_HASH.id && passwordHash === DEV_CREDENTIAL_HASH.password;

        if (!authenticated) {
          setDeveloperAuthError('인증에 실패했습니다.');
          return;
        }

        setIsDeveloperAuthOpen(false);
        appendEvents([generateEvent('INFO', '개발자 레이아웃 콘솔 열림')]);
        handleOpenLayoutDevConsole();
      } catch {
        setDeveloperAuthError('인증 처리 중 오류가 발생했습니다.');
      } finally {
        setIsDeveloperAuthPending(false);
      }
    },
    [appendEvents, handleOpenLayoutDevConsole]
  );

  const handleClearTimelineView = useCallback(() => {
    // Clear only on-screen timeline events. CSV persistence queue remains untouched.
    setEvents([]);
  }, []);

  const handleSelectObject = useCallback((id: string | null) => {
    setSelectedObjectId(id);
  }, []);

  const handleOpenSettings = useCallback(() => {
    setIsSettingsOpen(true);
  }, []);

  const handleCloseSettings = useCallback(() => {
    setPreviewTheme(null);
    setIsSettingsOpen(false);
  }, []);

  const handleOpenAutoTracking = useCallback(() => {
    setIsAutoTrackingOpen(true);
  }, []);

  const handleCloseAutoTracking = useCallback(() => {
    setIsAutoTrackingOpen(false);
  }, []);

  const handleAutoTrackingEnabledChange = useCallback(
    (next: boolean) => {
      setIsAutoTrackingEnabled(next);
      appendEvents([
        generateEvent(
          'INFO',
          next ? 'AI 자동 추적 활성화됨 (AUTO TRACK ON)' : 'AI 자동 추적 비활성화됨 (AUTO TRACK OFF)'
        ),
      ]);
    },
    [appendEvents]
  );

  const handleSaveSettings = useCallback((nextSettings: ConsoleSettings) => {
    const normalizedCenter = sanitizeCenter(nextSettings.mapCenter.lat, nextSettings.mapCenter.lon);
    setSettings({
      ...nextSettings,
      mapCenter: normalizedCenter,
      mapDataPath: nextSettings.mapDataPath.trim() || '/official',
      mapDataLoadNonce: Math.max(0, Math.floor(nextSettings.mapDataLoadNonce || 0)),
    });
  }, []);

  const selectedObject = visibleObjects.find(obj => obj.id === selectedObjectId) || null;
  const effectiveTheme = previewTheme ?? settings.mapTheme;
  const isLightTheme = effectiveTheme === 'LIGHT';
  const threatCount = visibleObjects.filter(
    (obj) => obj.riskLevel === 'HIGH' || obj.riskLevel === 'CRITICAL'
  ).length;

  return (
    <div
      className={`argus-root h-screen w-screen flex flex-col overflow-hidden relative ${
        isLightTheme ? 'bg-[#eef3f8] text-slate-900' : 'bg-[#0b0f14] text-gray-100'
      }`}
      data-theme={effectiveTheme}
    >
      {/* Status Bar */}
      <StatusBar
        status={systemStatus}
        threatCount={threatCount}
        isLive={isLive}
        isFrozen={isFrozen}
        onToggleLive={handleToggleLive}
        onFreeze={handleFreeze}
        onMarkEvent={handleMarkEvent}
        onExport={handleExport}
        onOpenSettings={handleOpenSettings}
        onOpenAutoTracking={handleOpenAutoTracking}
        onOpenLogViewer={handleOpenLogViewer}
        onLogoSecretTap={handleLogoSecretTap}
        layoutDevConfig={layoutDevConfig}
      />

      {/* Main Content Grid */}
      <div
        className="argus-main-grid flex-1 grid overflow-hidden"
        style={{
          gridTemplateColumns: `minmax(700px, ${layoutDevConfig.leftColumnVw}vw) 1fr`,
          gridTemplateRows: `${layoutDevConfig.topRowPx}px minmax(${layoutDevConfig.trackedRowMinPx}px, 1fr) minmax(${layoutDevConfig.bottomRowPx}px, ${Math.max(
            18,
            Math.round(layoutDevConfig.bottomRowPx / 8.6)
          )}vh)`,
        }}
      >
        {/* Left Panel - LiDAR Spatial View (spans 3 rows) */}
        <div className="row-span-3">
          <LidarSpatialView
            objects={visibleObjects}
            selectedObjectId={selectedObjectId}
            onSelectObject={handleSelectObject}
            mapCenter={settings.mapCenter}
            detectionMode={settings.detectionMode}
            mapTheme={effectiveTheme}
            mapLabelLevel={settings.mapLabelLevel}
            showUtmGrid={settings.showUtmGrid}
            showMgrsLabels={settings.showMgrsLabels}
            mapDataPath={settings.mapDataPath}
            mapDataLoadNonce={settings.mapDataLoadNonce}
            layoutDevConfig={layoutDevConfig}
          />
        </div>

        {/* Right Top - Selected Target Panel */}
        <div className="overflow-hidden">
          <SelectedTargetPanel selectedObject={selectedObject} layoutDevConfig={layoutDevConfig} />
        </div>

        {/* Right Middle - Object List Table */}
        <div className="overflow-hidden">
          <ObjectListTable
            objects={visibleObjects}
            selectedObjectId={selectedObjectId}
            onSelectObject={handleSelectObject}
            layoutDevConfig={layoutDevConfig}
          />
        </div>

        {/* Bottom Panel - Split: Candidate Tracks & Event Timeline */}
        <div className="overflow-hidden flex min-h-0">
          <div
            className={`min-h-0 ${isLightTheme ? 'border-r border-slate-300/80' : 'border-r border-cyan-950/50'}`}
            style={{ width: `${layoutDevConfig.bottomLeftPercent}%` }}
          >
            <CandidateTracksPanel 
              objects={visibleObjects} 
              onSelectObject={handleSelectObject} 
              layoutDevConfig={layoutDevConfig}
            />
          </div>
          <div className="min-h-0" style={{ width: `${100 - layoutDevConfig.bottomLeftPercent}%` }}>
            <EventTimeline
              events={events}
              objects={visibleObjects}
              onClearEvents={handleClearTimelineView}
              layoutDevConfig={layoutDevConfig}
            />
          </div>
        </div>
      </div>

      <DeveloperAccessDialog
        open={isDeveloperAuthOpen}
        pending={isDeveloperAuthPending}
        errorMessage={developerAuthError}
        mapTheme={effectiveTheme}
        onClose={handleCloseDeveloperAuth}
        onSubmit={handleDeveloperAuthSubmit}
      />
      <SettingsDialog
        open={isSettingsOpen}
        settings={settings}
        presets={POSITION_CODE_PRESETS}
        onClose={handleCloseSettings}
        onSave={handleSaveSettings}
        onPreviewThemeChange={setPreviewTheme}
      />
      <AutoTrackingDialog
        open={isAutoTrackingOpen}
        onClose={handleCloseAutoTracking}
        objects={visibleObjects}
        selectedObjectId={selectedObjectId}
        enabled={isAutoTrackingEnabled}
        onEnabledChange={handleAutoTrackingEnabledChange}
      />
    </div>
  );
}

export default App;
