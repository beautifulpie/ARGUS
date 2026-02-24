import { useState, useEffect, useCallback, useRef } from 'react';
import { StatusBar } from './components/StatusBar';
import { LidarSpatialView } from './components/LidarSpatialView';
import { SelectedTargetPanel } from './components/SelectedTargetPanel';
import { ObjectListTable } from './components/ObjectListTable';
import { EventTimeline } from './components/EventTimeline';
import {
  SettingsDialog,
  type ConsoleSettings,
  type PositionCodePreset,
} from './components/SettingsDialog';
import {
  updateObjectTracking,
  generateSystemStatus,
  generateEvent,
  generateObjectEvent,
  generateDetectedObject,
} from './utils/mockData';
import { ARGUS_CONFIG, isArgusConfigured } from './config/argus';
import { fetchArgusFrame } from './services/argusBridge';
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

type RuntimeResourceMetrics = Partial<Pick<SystemStatus, 'cpuUsage' | 'gpuUsage' | 'ramUsage'>>;

interface RuntimeStatusPayload {
  resources?: RuntimeResourceMetrics;
}

interface RadarRuntimeBridge {
  getStatus?: () => Promise<RuntimeStatusPayload>;
  onStatus?: (handler: (payload: RuntimeStatusPayload) => void) => (() => void) | void;
  updateConfig?: (patch: Record<string, unknown>) => Promise<unknown>;
}

const POSITION_CODE_PRESETS: PositionCodePreset[] = [
  { code: 'ARGUS-HQ', name: 'ARGUS 본부 (서울)', lat: 37.5665, lon: 126.978 },
  { code: 'ROK-CP-NORTH', name: '북부 지휘소', lat: 37.7582, lon: 126.7777 },
  { code: 'ROK-CP-SOUTH', name: '남부 지휘소', lat: 35.1796, lon: 129.0756 },
  { code: 'ROK-CP-EAST', name: '동부 지휘소', lat: 37.7519, lon: 128.8761 },
  { code: 'ROK-CP-JEJU', name: '제주 지휘소', lat: 33.4996, lon: 126.5312 },
  { code: 'ROK-CP-WEST', name: '서해 지휘소', lat: 36.4875, lon: 126.2637 },
];

const DEFAULT_CONSOLE_SETTINGS: ConsoleSettings = {
  mapCenter: {
    lat: 37.5665,
    lon: 126.978,
  },
  positionCode: 'ARGUS-HQ',
  modelPath: '',
  detectionMode: 'ACCURACY',
  mapLabelLevel: 'EMD',
  mapTheme: 'DARK',
  mapDataPath: '/official',
  mapDataLoadNonce: 0,
};

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const sanitizeCenter = (lat: number, lon: number) => ({
  lat: clamp(lat, 32.7, 39.9),
  lon: clamp(lon, 123.0, 132.2),
});

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

  return loaded;
};

const adjustStatusForConsoleSettings = (
  status: SystemStatus,
  settings: ConsoleSettings,
  applyPerformanceProfile: boolean
): SystemStatus => {
  const tuned = { ...status };
  const modeScale = settings.detectionMode === 'ACCURACY' ? 1.18 : 0.82;
  const fpsScale = settings.detectionMode === 'ACCURACY' ? 0.86 : 1.18;

  const tuneMetric = (value: number | undefined, scale: number) =>
    typeof value === 'number' ? Math.max(0, value * scale) : value;

  if (applyPerformanceProfile) {
    tuned.latency = clamp(tuned.latency * modeScale, 0, 5000);
    tuned.fps = clamp(tuned.fps * fpsScale, 1, 500);
    if (typeof tuned.measuredFps === 'number') {
      tuned.measuredFps = clamp(tuned.measuredFps * fpsScale, 1, 500);
    }
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

  // In SPEED mode, operator view is intentionally normalized to a fixed 30 FPS.
  if (settings.detectionMode === 'SPEED') {
    tuned.fps = 30;
    tuned.measuredFps = 30;
  }

  return tuned;
};

const buildObjectChangeEvents = (
  previousObjects: DetectedObject[],
  nextObjects: DetectedObject[]
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
      events.push(generateObjectEvent({ ...obj, status: 'LOST' }, 'LOST'));
    }
  });

  return events;
};

function App() {
  const useArgusBridge = isArgusConfigured();
  const [settings, setSettings] = useState<ConsoleSettings>(() => readInitialSettings());
  const [previewTheme, setPreviewTheme] = useState<ConsoleSettings['mapTheme'] | null>(null);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isLive, setIsLive] = useState(false);
  const [isFrozen, setIsFrozen] = useState(false);
  const [objects, setObjects] = useState<DetectedObject[]>([]);
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

  useEffect(() => {
    objectsRef.current = objects;
    for (const obj of objects) {
      trackClassByIdRef.current.set(obj.id, obj.class);
    }
  }, [objects]);

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

    const runtime = (window as Window & { radarRuntime?: RadarRuntimeBridge }).radarRuntime;
    if (!runtime) return;

    let disposed = false;

    const applyRuntimeResources = (payload?: RuntimeStatusPayload | null) => {
      const resources = payload?.resources;
      if (!resources) return;
      runtimeResourcesRef.current = resources;
      setSystemStatus((prev) => mergeRuntimeResources(prev, prev));
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
  }, [mergeRuntimeResources]);

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

    setEvents((prev) => [...prev, ...normalizedEvents].slice(-MAX_EVENT_LOGS));
  }, []);

  const runMockTick = useCallback(() => {
    setObjects((prevObjects) => {
      const nextObjects = updateObjectTracking(prevObjects);
      appendEvents(buildObjectChangeEvents(prevObjects, nextObjects));
      return nextObjects;
    });

    setSystemStatus((prev) =>
      mergeRuntimeResources(
        adjustStatusForConsoleSettings(
          generateSystemStatus(true, prev.trackedObjects),
          settings,
          true
        ),
        prev
      )
    );
  }, [appendEvents, settings, mergeRuntimeResources]);

  useEffect(() => {
    const runtime = (window as Window & { radarRuntime?: RadarRuntimeBridge }).radarRuntime;
    if (runtime && typeof runtime.updateConfig === 'function') {
      void runtime.updateConfig({
        detectionMode: settings.detectionMode,
        resourceMonitorIntervalMs: settings.detectionMode === 'SPEED' ? 5000 : 1000,
      });
    }
  }, [settings.detectionMode]);

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
        if (isDisposed) {
          return;
        }

        for (const obj of frame.objects) {
          trackClassByIdRef.current.set(obj.id, obj.class);
        }

        const derivedEvents = buildObjectChangeEvents(objectsRef.current, frame.objects);
        setObjects(frame.objects);
        setSystemStatus((prev) =>
          mergeRuntimeResources(adjustStatusForConsoleSettings(frame.systemStatus, settings, false), prev)
        );
        appendEvents([...derivedEvents, ...frame.events]);
        argusErrorLoggedRef.current = false;
      } catch (error) {
        if (isDisposed) {
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
          setSystemStatus((prev) => ({
            ...mergeRuntimeResources(prev, prev),
            connectionStatus: 'DISCONNECTED',
            sensorStatus: 'DEGRADED',
          }));
        }
      } finally {
        isTickRunning = false;
      }
    };

    const intervalMs = useArgusBridge ? ARGUS_CONFIG.pollIntervalMs : 1000;
    void tick();
    const interval = setInterval(() => {
      void tick();
    }, intervalMs);

    return () => {
      isDisposed = true;
      clearInterval(interval);
    };
  }, [isLive, isFrozen, useArgusBridge, runMockTick, appendEvents, mergeRuntimeResources]);

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

        setTimeout(() => {
          appendEvents(
            initialObjects.map((obj) => generateObjectEvent(obj, 'DETECTED'))
          );
        }, 500);
      }
    } else {
      // Clear objects when stopping
      setObjects([]);
      setSelectedObjectId(null);
      setSystemStatus((prev) => mergeRuntimeResources(generateSystemStatus(false, 0), prev));
      argusErrorLoggedRef.current = false;
    }
  }, [isLive, useArgusBridge, appendEvents, mergeRuntimeResources]);

  // Update system status with current object count
  useEffect(() => {
    setSystemStatus((prev) => ({
      ...mergeRuntimeResources(prev, prev),
      trackedObjects: objects.length,
      activeTracksCount: objects.filter(obj => obj.status === 'STABLE' || obj.status === 'TRACKING').length,
    }));
  }, [objects, mergeRuntimeResources]);

  useEffect(() => {
    if (!selectedObjectId) {
      return;
    }

    const stillExists = objects.some((obj) => obj.id === selectedObjectId);
    if (!stillExists) {
      setSelectedObjectId(null);
    }
  }, [objects, selectedObjectId]);

  const handleToggleLive = useCallback(() => {
    setIsLive((prev) => !prev);
    setIsFrozen(false);
  }, []);

  const handleFreeze = useCallback(() => {
    setIsFrozen((prev) => !prev);
    if (!isFrozen) {
      appendEvents([generateEvent('INFO', '디스플레이 정지됨')]);
    }
  }, [isFrozen, appendEvents]);

  const handleMarkEvent = useCallback(() => {
    appendEvents([generateEvent('WARNING', '운영자가 이벤트를 표시함')]);
  }, [appendEvents]);

  const handleExport = useCallback(() => {
    appendEvents([generateEvent('INFO', '로그 내보내기 시작됨')]);
    // In real app, would trigger export
    console.log('Export log:', events);
    console.log('Export objects:', objects);
  }, [events, objects, appendEvents]);

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

  const handleSaveSettings = useCallback((nextSettings: ConsoleSettings) => {
    const normalizedCenter = sanitizeCenter(nextSettings.mapCenter.lat, nextSettings.mapCenter.lon);
    setSettings({
      ...nextSettings,
      mapCenter: normalizedCenter,
      mapDataPath: nextSettings.mapDataPath.trim() || '/official',
      mapDataLoadNonce: Math.max(0, Math.floor(nextSettings.mapDataLoadNonce || 0)),
    });
  }, []);

  const selectedObject = objects.find(obj => obj.id === selectedObjectId) || null;
  const effectiveTheme = previewTheme ?? settings.mapTheme;
  const isLightTheme = effectiveTheme === 'LIGHT';
  const threatCount = objects.filter(
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
      />

      {/* Main Content Grid */}
      <div className="flex-1 grid grid-cols-[minmax(720px,44vw)_1fr] grid-rows-[500px_1fr_minmax(260px,30vh)] overflow-hidden">
        {/* Left Panel - LiDAR Spatial View (spans 3 rows) */}
        <div className="row-span-3">
          <LidarSpatialView
            objects={objects}
            selectedObjectId={selectedObjectId}
            onSelectObject={handleSelectObject}
            mapCenter={settings.mapCenter}
            onMapCenterChange={(nextCenter) =>
              setSettings((prev) => ({
                ...prev,
                mapCenter: sanitizeCenter(nextCenter.lat, nextCenter.lon),
                positionCode: '',
              }))
            }
            mapTheme={effectiveTheme}
            mapLabelLevel={settings.mapLabelLevel}
            mapDataPath={settings.mapDataPath}
            mapDataLoadNonce={settings.mapDataLoadNonce}
          />
        </div>

        {/* Right Top - Selected Target Panel */}
        <div className="overflow-hidden">
          <SelectedTargetPanel selectedObject={selectedObject} />
        </div>

        {/* Right Middle - Object List Table */}
        <div className="overflow-hidden">
          <ObjectListTable
            objects={objects}
            selectedObjectId={selectedObjectId}
            onSelectObject={handleSelectObject}
          />
        </div>

        {/* Bottom Panel - Split: Candidate Tracks & Event Timeline */}
        <div className="overflow-hidden flex min-h-0">
          <div
            className={`w-1/2 min-h-0 ${isLightTheme ? 'border-r border-slate-300/80' : 'border-r border-cyan-950/50'}`}
          >
            <CandidateTracksPanel 
              objects={objects} 
              onSelectObject={handleSelectObject} 
            />
          </div>
          <div className="w-1/2 min-h-0">
            <EventTimeline events={events} objects={objects} />
          </div>
        </div>
      </div>

      <SettingsDialog
        open={isSettingsOpen}
        settings={settings}
        presets={POSITION_CODE_PRESETS}
        onClose={handleCloseSettings}
        onSave={handleSaveSettings}
        onPreviewThemeChange={setPreviewTheme}
      />
    </div>
  );
}

export default App;
