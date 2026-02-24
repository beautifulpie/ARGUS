import { ARGUS_CONFIG, buildArgusUrl } from '../config/argus';
import {
  DetectedObject,
  ObjectClass,
  ObjectStatus,
  RiskLevel,
  SystemStatus,
  TimelineEvent,
  UavDecision,
} from '../types';

type AnyRecord = Record<string, unknown>;

export interface ArgusFrame {
  objects: DetectedObject[];
  events: TimelineEvent[];
  systemStatus: SystemStatus;
}

const OBJECT_CLASSES: ObjectClass[] = [
  'HELICOPTER',
  'UAV',
  'HIGHSPEED',
  'BIRD_FLOCK',
  'BIRD',
  'CIVIL_AIR',
  'FIGHTER',
];

const CLASS_ALIASES: Record<string, ObjectClass> = {
  HELICOPTER: 'HELICOPTER',
  HELI: 'HELICOPTER',
  ROTORCRAFT: 'HELICOPTER',
  UAV: 'UAV',
  DRONE: 'UAV',
  UAS: 'UAV',
  HIGHSPEED: 'HIGHSPEED',
  HYPERSONIC: 'HIGHSPEED',
  MISSILE: 'HIGHSPEED',
  BIRD: 'BIRD',
  BIRDS: 'BIRD_FLOCK',
  BIRD_FLOCK: 'BIRD_FLOCK',
  FLOCK: 'BIRD_FLOCK',
  CIVIL_AIR: 'CIVIL_AIR',
  COMMERCIAL_AIRCRAFT: 'CIVIL_AIR',
  AIRLINER: 'CIVIL_AIR',
  FIGHTER: 'FIGHTER',
  MILITARY_JET: 'FIGHTER',
};

const STATUS_ALIASES: Record<string, ObjectStatus> = {
  NEW: 'NEW',
  DETECTED: 'NEW',
  TRACKING: 'TRACKING',
  ACTIVE: 'TRACKING',
  STABLE: 'STABLE',
  LOST: 'LOST',
  CANDIDATE: 'CANDIDATE',
  COASTING: 'CANDIDATE',
};

const RISK_ALIASES: Record<string, RiskLevel> = {
  LOW: 'LOW',
  MEDIUM: 'MEDIUM',
  MODERATE: 'MEDIUM',
  HIGH: 'HIGH',
  CRITICAL: 'CRITICAL',
};

const EVENT_TYPE_ALIASES: Record<string, TimelineEvent['type']> = {
  INFO: 'INFO',
  WARNING: 'WARNING',
  WARN: 'WARNING',
  ALERT: 'ALERT',
  ERROR: 'ALERT',
  CRITICAL: 'ALERT',
};

const SENSOR_STATUS_ALIASES: Record<string, SystemStatus['sensorStatus']> = {
  ONLINE: 'ONLINE',
  DEGRADED: 'DEGRADED',
  OFFLINE: 'OFFLINE',
};

const UAV_DECISION_ALIASES: Record<string, UavDecision> = {
  UAV: 'UAV',
  DRONE: 'UAV',
  NON_UAV: 'NON_UAV',
  NONDRONE: 'NON_UAV',
  UNKNOWN: 'UNKNOWN',
  UNK: 'UNKNOWN',
};

const DEFAULT_SIZE = { width: 10, height: 4, length: 15 };

const toRecord = (value: unknown): AnyRecord => {
  if (typeof value === 'object' && value !== null) {
    return value as AnyRecord;
  }
  return {};
};

const toStringOrEmpty = (value: unknown): string => {
  if (typeof value === 'string') {
    return value.trim();
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }
  return '';
};

const toNumber = (value: unknown, fallback: number): number => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return parsed;
};

const clamp = (value: number, min: number, max: number): number => {
  if (value < min) return min;
  if (value > max) return max;
  return value;
};

const toDate = (value: unknown, fallback: Date): Date => {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value;
  }
  if (typeof value === 'number' || typeof value === 'string') {
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) {
      return date;
    }
  }
  return fallback;
};

const normalizeClass = (value: unknown, fallback: ObjectClass): ObjectClass => {
  const normalized = toStringOrEmpty(value).replace(/\s+/g, '_').toUpperCase();
  return CLASS_ALIASES[normalized] || fallback;
};

const normalizeStatus = (value: unknown, fallback: ObjectStatus): ObjectStatus => {
  const normalized = toStringOrEmpty(value).replace(/\s+/g, '_').toUpperCase();
  return STATUS_ALIASES[normalized] || fallback;
};

const normalizeRiskLevel = (value: unknown, fallback: RiskLevel): RiskLevel => {
  const normalized = toStringOrEmpty(value).replace(/\s+/g, '_').toUpperCase();
  return RISK_ALIASES[normalized] || fallback;
};

const normalizeEventType = (value: unknown, fallback: TimelineEvent['type']): TimelineEvent['type'] => {
  const normalized = toStringOrEmpty(value).replace(/\s+/g, '_').toUpperCase();
  return EVENT_TYPE_ALIASES[normalized] || fallback;
};

const normalizeSensorStatus = (value: unknown, fallback: SystemStatus['sensorStatus']): SystemStatus['sensorStatus'] => {
  const normalized = toStringOrEmpty(value).replace(/\s+/g, '_').toUpperCase();
  return SENSOR_STATUS_ALIASES[normalized] || fallback;
};

const normalizeUavDecision = (value: unknown, fallback: UavDecision): UavDecision => {
  const normalized = toStringOrEmpty(value).replace(/\s+/g, '_').toUpperCase();
  return UAV_DECISION_ALIASES[normalized] || fallback;
};

const toConfidencePercent = (value: unknown, fallback: number): number => {
  const numeric = toNumber(value, fallback);
  const scaled = numeric <= 1 ? numeric * 100 : numeric;
  return clamp(scaled, 0, 100);
};

const estimateRiskLevel = (objectClass: ObjectClass, distance: number): RiskLevel => {
  if ((objectClass === 'UAV' || objectClass === 'FIGHTER') && distance < 40) {
    return 'HIGH';
  }
  if (objectClass === 'HIGHSPEED') {
    return 'CRITICAL';
  }
  if (objectClass === 'UAV') {
    return 'MEDIUM';
  }
  return 'LOW';
};

const toPoint = (value: unknown): { x: number; y: number } | null => {
  if (Array.isArray(value) && value.length >= 2) {
    const x = Number(value[0]);
    const y = Number(value[1]);
    if (Number.isFinite(x) && Number.isFinite(y)) {
      return { x, y };
    }
    return null;
  }

  const record = toRecord(value);
  const x = Number(record.x);
  const y = Number(record.y);
  if (Number.isFinite(x) && Number.isFinite(y)) {
    return { x, y };
  }
  return null;
};

const buildPredictedPath = (
  currentX: number,
  currentY: number,
  velocityX: number,
  velocityY: number,
  steps: number
): { x: number; y: number }[] => {
  const path: { x: number; y: number }[] = [];
  for (let i = 1; i <= steps; i += 1) {
    path.push({
      x: currentX + velocityX * i,
      y: currentY + velocityY * i,
    });
  }
  return path;
};

const buildProbabilities = (
  rawProbabilities: unknown,
  objectClass: ObjectClass,
  confidence: number
): { className: ObjectClass; probability: number }[] => {
  const probabilities: { className: ObjectClass; probability: number }[] = [];

  if (Array.isArray(rawProbabilities)) {
    for (const entry of rawProbabilities) {
      const record = toRecord(entry);
      const mappedClass = normalizeClass(
        record.className ?? record.class ?? record.label ?? record.type,
        objectClass
      );
      const probability = toConfidencePercent(
        record.probability ?? record.score ?? record.confidence,
        0
      );
      probabilities.push({ className: mappedClass, probability });
    }
  } else {
    const probabilityMap = toRecord(rawProbabilities);
    for (const [className, probability] of Object.entries(probabilityMap)) {
      const mappedClass = normalizeClass(className, objectClass);
      probabilities.push({
        className: mappedClass,
        probability: toConfidencePercent(probability, 0),
      });
    }
  }

  const hasPrimary = probabilities.some((item) => item.className === objectClass);
  if (!hasPrimary) {
    probabilities.push({ className: objectClass, probability: confidence });
  }

  // Ensure unique classes and descending confidence for UI rendering.
  const deduped = new Map<ObjectClass, number>();
  probabilities.forEach((item) => {
    const existing = deduped.get(item.className);
    if (existing === undefined || item.probability > existing) {
      deduped.set(item.className, item.probability);
    }
  });

  return Array.from(deduped.entries())
    .map(([className, probability]) => ({ className, probability }))
    .sort((a, b) => b.probability - a.probability)
    .slice(0, OBJECT_CLASSES.length);
};

const mapObject = (
  rawObject: unknown,
  fallbackId: string,
  previousObject: DetectedObject | undefined
): DetectedObject => {
  const record = toRecord(rawObject);
  const id = toStringOrEmpty(record.id ?? record.trackId ?? record.objectId) || fallbackId;

  const positionRecord = toRecord(record.position ?? record.coordinates ?? record.location);
  const x = toNumber(
    positionRecord.x ?? positionRecord.east ?? record.x,
    previousObject?.position.x ?? 0
  );
  const y = toNumber(
    positionRecord.y ?? positionRecord.north ?? record.y,
    previousObject?.position.y ?? 0
  );
  const z = toNumber(
    positionRecord.z ?? positionRecord.altitude ?? record.altitude,
    previousObject?.position.z ?? 0
  );

  const velocityRecord = toRecord(record.velocity ?? record.velocityVector ?? record.vector);
  const velocityX = toNumber(
    velocityRecord.x ?? velocityRecord.vx ?? record.vx,
    previousObject?.velocity.x ?? 0
  );
  const velocityY = toNumber(
    velocityRecord.y ?? velocityRecord.vy ?? record.vy,
    previousObject?.velocity.y ?? 0
  );
  const velocityZ = toNumber(
    velocityRecord.z ?? velocityRecord.vz ?? record.vz,
    previousObject?.velocity.z ?? 0
  );
  const velocityMagnitude = Math.sqrt(velocityX ** 2 + velocityY ** 2 + velocityZ ** 2);
  const speed = toNumber(record.speed ?? velocityRecord.speed, velocityMagnitude);

  const distance = toNumber(record.distance ?? record.range, Math.sqrt(x ** 2 + y ** 2));
  const fallbackClass = previousObject?.class || 'UAV';
  const objectClass = normalizeClass(
    record.class ??
      record.className ??
      record.type ??
      record.category ??
      toRecord(record.classification).label,
    fallbackClass
  );
  const confidence = toConfidencePercent(
    record.confidence ??
      record.score ??
      toRecord(record.classification).confidence,
    previousObject?.confidence ?? 60
  );
  const probabilities = buildProbabilities(
    record.probabilities ?? toRecord(record.classification).probabilities,
    objectClass,
    confidence
  );

  const sizeRecord = toRecord(record.size ?? record.dimensions);
  const size = {
    width: clamp(
      toNumber(sizeRecord.width, previousObject?.size.width ?? DEFAULT_SIZE.width),
      0.1,
      200
    ),
    height: clamp(
      toNumber(sizeRecord.height, previousObject?.size.height ?? DEFAULT_SIZE.height),
      0.1,
      200
    ),
    length: clamp(
      toNumber(sizeRecord.length, previousObject?.size.length ?? DEFAULT_SIZE.length),
      0.1,
      200
    ),
  };

  const fallbackStatus: ObjectStatus = previousObject ? 'TRACKING' : 'NEW';
  const status = normalizeStatus(record.status ?? record.trackStatus, fallbackStatus);
  const inferredRisk = estimateRiskLevel(objectClass, distance);
  const riskLevel = normalizeRiskLevel(
    record.riskLevel ?? record.risk ?? record.threatLevel,
    inferredRisk
  );
  const uavInference = toRecord(record.uavInference ?? record.inference);
  const uavThreshold = clamp(
    toConfidencePercent(
      record.uavThreshold ?? uavInference.threshold ?? uavInference.decisionThreshold,
      previousObject?.uavThreshold ?? 35
    ),
    1,
    99
  );
  const uavProbability = toConfidencePercent(
    record.uavProbability ?? uavInference.probability ?? uavInference.score,
    previousObject?.uavProbability ?? 0
  );
  const uavDecision = normalizeUavDecision(
    record.uavDecision ?? uavInference.decision ?? uavInference.label,
    uavProbability >= uavThreshold ? 'UAV' : 'NON_UAV'
  );
  const inferenceModelVersion =
    toStringOrEmpty(
      record.inferenceModelVersion ??
        uavInference.modelVersion ??
        toRecord(record.model).version
    ) || previousObject?.inferenceModelVersion;
  const featureWindowMs = Math.max(
    0,
    Math.floor(
      toNumber(
        record.featureWindowMs ?? uavInference.featureWindowMs,
        previousObject?.featureWindowMs ?? 0
      )
    )
  );
  const timestamp = toDate(
    record.timestamp ?? record.updatedAt ?? record.time,
    new Date()
  );

  const rawHistory = Array.isArray(record.trackHistory) ? record.trackHistory : [];
  const parsedHistory = rawHistory
    .map((entry) => toPoint(entry))
    .filter((point): point is { x: number; y: number } => point !== null);
  const trackHistory =
    parsedHistory.length > 0
      ? parsedHistory
      : [
          ...(previousObject?.trackHistory || []).slice(-19),
          { x, y },
        ];

  const rawPredictedPath = Array.isArray(record.predictedPath) ? record.predictedPath : [];
  const parsedPredictedPath = rawPredictedPath
    .map((entry) => toPoint(entry))
    .filter((point): point is { x: number; y: number } => point !== null);
  const predictedPath =
    parsedPredictedPath.length > 0
      ? parsedPredictedPath
      : buildPredictedPath(x, y, velocityX, velocityY, 10);

  const trackingDuration = Math.max(
    0,
    Math.floor(
      toNumber(
        record.trackingDuration ?? record.trackAge ?? record.ageSec,
        (previousObject?.trackingDuration ?? 0) + 1
      )
    )
  );

  return {
    id,
    class: objectClass,
    confidence,
    probabilities,
    position: { x, y, z },
    velocity: { x: velocityX, y: velocityY, z: velocityZ },
    speed,
    size,
    distance,
    trackingDuration,
    status,
    riskLevel,
    timestamp,
    trackHistory: trackHistory.slice(-20),
    predictedPath,
    uavThreshold,
    uavProbability,
    uavDecision,
    inferenceModelVersion,
    featureWindowMs,
  };
};

const mapEvent = (rawEvent: unknown, index: number): TimelineEvent | null => {
  const record = toRecord(rawEvent);
  const message = toStringOrEmpty(record.message ?? record.text ?? record.description);
  if (!message) {
    return null;
  }

  const timestamp = toDate(record.timestamp ?? record.time ?? record.createdAt, new Date());
  const id =
    toStringOrEmpty(record.id) ||
    `argus-event-${timestamp.getTime()}-${String(index + 1).padStart(3, '0')}`;
  const type = normalizeEventType(record.type ?? record.level ?? record.severity, 'INFO');
  const objectId = toStringOrEmpty(record.objectId ?? record.trackId ?? record.targetId) || undefined;

  return {
    id,
    timestamp,
    type,
    message,
    objectId,
  };
};

const extractObjects = (payload: AnyRecord): unknown[] => {
  if (Array.isArray(payload.objects)) {
    return payload.objects;
  }
  if (Array.isArray(payload.tracks)) {
    return payload.tracks;
  }
  if (Array.isArray(payload.targets)) {
    return payload.targets;
  }
  const dataRecord = toRecord(payload.data);
  if (Array.isArray(dataRecord.objects)) {
    return dataRecord.objects;
  }
  if (Array.isArray(dataRecord.tracks)) {
    return dataRecord.tracks;
  }
  return [];
};

const extractEvents = (payload: AnyRecord): unknown[] => {
  if (Array.isArray(payload.events)) {
    return payload.events;
  }
  if (Array.isArray(payload.alerts)) {
    return payload.alerts;
  }
  const dataRecord = toRecord(payload.data);
  if (Array.isArray(dataRecord.events)) {
    return dataRecord.events;
  }
  if (Array.isArray(dataRecord.alerts)) {
    return dataRecord.alerts;
  }
  return [];
};

const extractSystemStatus = (payload: AnyRecord): AnyRecord => {
  if (typeof payload.systemStatus === 'object' && payload.systemStatus !== null) {
    return payload.systemStatus as AnyRecord;
  }
  if (typeof payload.status === 'object' && payload.status !== null) {
    return payload.status as AnyRecord;
  }
  const dataRecord = toRecord(payload.data);
  if (typeof dataRecord.systemStatus === 'object' && dataRecord.systemStatus !== null) {
    return dataRecord.systemStatus as AnyRecord;
  }
  if (typeof dataRecord.status === 'object' && dataRecord.status !== null) {
    return dataRecord.status as AnyRecord;
  }
  return {};
};

const mapSystemStatus = (rawStatus: AnyRecord, objects: DetectedObject[]): SystemStatus => {
  const trackedObjects = objects.length;
  const activeTracksCount = objects.filter(
    (obj) => obj.status === 'STABLE' || obj.status === 'TRACKING'
  ).length;

  return {
    connectionStatus: 'LIVE',
    modelName: toStringOrEmpty(rawStatus.modelName ?? rawStatus.model) || 'ARGUS-Bridge',
    modelVersion: toStringOrEmpty(rawStatus.modelVersion ?? rawStatus.version) || 'v1',
    device: toStringOrEmpty(rawStatus.device ?? rawStatus.sensorName) || 'ARGUS',
    latency: clamp(toNumber(rawStatus.latency ?? rawStatus.latencyMs, 0), 0, 5000),
    fps: clamp(toNumber(rawStatus.fps ?? rawStatus.frameRate, 0), 0, 500),
    trackedObjects,
    activeTracksCount,
    totalDetected: Math.max(
      trackedObjects,
      Math.floor(toNumber(rawStatus.totalDetected ?? rawStatus.totalTracks, trackedObjects))
    ),
    sensorStatus: normalizeSensorStatus(
      rawStatus.sensorStatus ?? rawStatus.sensorState,
      'ONLINE'
    ),
    cpuUsage: clamp(toNumber(rawStatus.cpuUsage, 0), 0, 100),
    gpuUsage: clamp(toNumber(rawStatus.gpuUsage, 0), 0, 100),
    ramUsage: clamp(toNumber(rawStatus.ramUsage, 0), 0, 100),
    inferenceLatencyP50: clamp(toNumber(rawStatus.inferenceLatencyP50 ?? rawStatus.mlLatencyP50, 0), 0, 10000),
    inferenceLatencyP95: clamp(toNumber(rawStatus.inferenceLatencyP95 ?? rawStatus.mlLatencyP95, 0), 0, 10000),
    pipelineLatencyP95: clamp(toNumber(rawStatus.pipelineLatencyP95 ?? rawStatus.totalLatencyP95, 0), 0, 10000),
  };
};

const buildRequestHeaders = (): HeadersInit => {
  if (!ARGUS_CONFIG.authToken) {
    return {
      Accept: 'application/json',
    };
  }

  return {
    Accept: 'application/json',
    Authorization: `Bearer ${ARGUS_CONFIG.authToken}`,
  };
};

export const fetchArgusFrame = async (previousObjects: DetectedObject[]): Promise<ArgusFrame> => {
  if (!ARGUS_CONFIG.baseUrl) {
    throw new Error('ARGUS base URL is not configured');
  }

  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), ARGUS_CONFIG.requestTimeoutMs);

  try {
    const response = await fetch(buildArgusUrl(ARGUS_CONFIG.framePath), {
      method: 'GET',
      headers: buildRequestHeaders(),
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`ARGUS request failed: ${response.status}`);
    }

    const payload = toRecord(await response.json());
    const previousById = new Map(previousObjects.map((obj) => [obj.id, obj]));

    const objects = extractObjects(payload).map((entry, index) => {
      const entryRecord = toRecord(entry);
      const fallbackId = `ARGUS-${String(index + 1).padStart(4, '0')}`;
      const mappedId =
        toStringOrEmpty(entryRecord.id ?? entryRecord.trackId ?? entryRecord.objectId) || fallbackId;
      return mapObject(entryRecord, mappedId, previousById.get(mappedId));
    });

    const events = extractEvents(payload)
      .map((entry, index) => mapEvent(entry, index))
      .filter((event): event is TimelineEvent => event !== null);
    const systemStatus = mapSystemStatus(extractSystemStatus(payload), objects);

    return {
      objects,
      events,
      systemStatus,
    };
  } finally {
    clearTimeout(timeout);
  }
};
