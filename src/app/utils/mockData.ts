import {
  DetectedObject,
  TimelineEvent,
  SystemStatus,
  ObjectClass,
  ObjectStatus,
  RiskLevel,
  ClassProbability,
  GeoPosition,
} from '../types';

const OBJECT_CLASSES: ObjectClass[] = ['HELICOPTER', 'UAV', 'HIGHSPEED', 'BIRD_FLOCK', 'BIRD', 'CIVIL_AIR', 'FIGHTER'];
const DEFAULT_SENSOR_GEO: GeoPosition = { lat: 37.5665, lon: 126.9780 };
const KOREA_BOUNDS = {
  minLat: 32.7,
  maxLat: 39.9,
  minLon: 123.0,
  maxLon: 132.2,
};
const METERS_PER_RADAR_UNIT = 150;
const MAX_DETECTION_RANGE_KM = 35;
const MAX_DETECTION_RANGE_UNITS = (MAX_DETECTION_RANGE_KM * 1000) / METERS_PER_RADAR_UNIT;
const CALIBRATION_STORAGE_KEY = 'argus.map.calibration.v1';

let objectIdCounter = 1;
let existingObjects: DetectedObject[] = [];
type MockLostReason = 'OUT_OF_RANGE' | 'SIGNAL_LOST';
const mockLostReasons = new Map<string, MockLostReason>();

interface SpeedProfile {
  base: number;
  min: number;
  max: number;
  jitter: number;
}

const SPEED_PROFILE_MPS: Record<ObjectClass, SpeedProfile> = {
  HELICOPTER: { base: 68, min: 40, max: 95, jitter: 7 },
  UAV: { base: 32, min: 15, max: 60, jitter: 6 },
  HIGHSPEED: { base: 370, min: 320, max: 430, jitter: 10 },
  BIRD_FLOCK: { base: 18, min: 8, max: 32, jitter: 3 },
  BIRD: { base: 11, min: 4, max: 22, jitter: 2.5 },
  CIVIL_AIR: { base: 272, min: 240, max: 315, jitter: 8 },
  FIGHTER: { base: 240, min: 180, max: 320, jitter: 10 },
};

const SPEED_TO_PLANAR_VELOCITY = 1 / 15;

const clamp = (value: number, min: number, max: number): number => {
  if (value < min) return min;
  if (value > max) return max;
  return value;
};

const normalizeLongitude = (lon: number): number => {
  let normalized = lon;
  while (normalized < -180) normalized += 360;
  while (normalized > 180) normalized -= 360;
  return normalized;
};

const clampGeoToKorea = (point: GeoPosition): GeoPosition => ({
  lat: clamp(point.lat, KOREA_BOUNDS.minLat, KOREA_BOUNDS.maxLat),
  lon: clamp(normalizeLongitude(point.lon), KOREA_BOUNDS.minLon, KOREA_BOUNDS.maxLon),
});

const offsetGeoPosition = (
  origin: GeoPosition,
  eastMeters: number,
  northMeters: number
): GeoPosition => {
  const latDelta = northMeters / 111320;
  const lonScale = Math.max(0.1, Math.cos((origin.lat * Math.PI) / 180));
  const lonDelta = eastMeters / (111320 * lonScale);
  return clampGeoToKorea({
    lat: origin.lat + latDelta,
    lon: origin.lon + lonDelta,
  });
};

const readSensorCalibration = (): GeoPosition => {
  if (typeof window === 'undefined') {
    return DEFAULT_SENSOR_GEO;
  }

  try {
    const raw = window.localStorage.getItem(CALIBRATION_STORAGE_KEY);
    if (!raw) return DEFAULT_SENSOR_GEO;
    const parsed = JSON.parse(raw) as Partial<GeoPosition>;
    if (typeof parsed.lat !== 'number' || typeof parsed.lon !== 'number') {
      return DEFAULT_SENSOR_GEO;
    }
    return clampGeoToKorea({ lat: parsed.lat, lon: parsed.lon });
  } catch {
    return DEFAULT_SENSOR_GEO;
  }
};

const estimateUavProbability = (
  objectClass: ObjectClass,
  speed: number,
  distance: number
): number => {
  let score = 20;
  if (objectClass === 'UAV') score += 45;
  if (objectClass === 'FIGHTER') score += 20;
  if (objectClass === 'BIRD' || objectClass === 'BIRD_FLOCK') score -= 20;
  if (speed > 25 && speed < 220) score += 8;
  if (distance < 40) score += 5;
  score += (Math.random() - 0.5) * 10;
  return clamp(score, 1, 99);
};

const computeRadarTrackScore = (
  confidence: number,
  uavProbability: number,
  status: ObjectStatus
): number => {
  const statusBias: Record<ObjectStatus, number> = {
    STABLE: 8,
    TRACKING: 4,
    NEW: 1,
    CANDIDATE: -10,
    LOST: -18,
  };
  return clamp(confidence * 0.62 + uavProbability * 0.38 + statusBias[status], 1, 99);
};

const sampleSpeedForClass = (objectClass: ObjectClass, previousSpeed?: number): number => {
  const profile = SPEED_PROFILE_MPS[objectClass];
  if (previousSpeed === undefined) {
    return clamp(
      profile.base + (Math.random() - 0.5) * profile.jitter * 2,
      profile.min,
      profile.max
    );
  }

  const driftToBase = (profile.base - previousSpeed) * 0.04;
  const noise = (Math.random() - 0.5) * profile.jitter * 0.45;
  return clamp(previousSpeed + driftToBase + noise, profile.min, profile.max);
};

const speedToPlanarVelocity = (speedMps: number): number =>
  Math.max(0.6, speedMps * SPEED_TO_PLANAR_VELOCITY);

const isWithinDetectionRange = (position: { x: number; y: number }): boolean =>
  Math.hypot(position.x, position.y) <= MAX_DETECTION_RANGE_UNITS;

export function consumeMockLostReasons(): Map<string, MockLostReason> {
  const snapshot = new Map(mockLostReasons);
  mockLostReasons.clear();
  return snapshot;
}

const toUavDecision = (probability: number, threshold: number): DetectedObject['uavDecision'] => {
  if (probability >= threshold) return 'UAV';
  if (probability <= threshold - 20) return 'NON_UAV';
  return 'UNKNOWN';
};

// Helper to generate random probabilities
const generateProbabilities = (mainClass: ObjectClass, confidence: number): ClassProbability[] => {
  const others = OBJECT_CLASSES.filter(c => c !== mainClass);
  const remainingConf = 100 - confidence;
  
  // Distribute remaining confidence among 2-3 other classes randomly
  const candidates = others.sort(() => 0.5 - Math.random()).slice(0, 3);
  let sum = 0;
  const probs = candidates.map((c, i) => {
    if (i === candidates.length - 1) return { className: c, probability: remainingConf - sum };
    const p = Math.floor(Math.random() * (remainingConf - sum));
    sum += p;
    return { className: c, probability: p };
  });

  return [
    { className: mainClass, probability: confidence },
    ...probs
  ].sort((a, b) => b.probability - a.probability);
};

// Helper to predict path based on velocity
const predictPath = (pos: { x: number; y: number }, vel: { x: number; y: number }, steps: number): { x: number; y: number }[] => {
  const path = [];
  for (let i = 1; i <= steps; i++) {
    path.push({
      x: pos.x + vel.x * i,
      y: pos.y + vel.y * i
    });
  }
  return path;
};

// Generate a new detected object with realistic physics
export function generateDetectedObject(existing?: DetectedObject, deltaSeconds = 1): DetectedObject {
  const id = existing?.id || `TRK-${String(objectIdCounter++).padStart(4, '0')}`;
  const uavThreshold = existing?.uavThreshold ?? 35;
  const timeScale = clamp(deltaSeconds, 0.02, 2);
  const enforceMinPlanarVelocity = (velocity: { x: number; y: number; z: number }) => {
    const planar = Math.hypot(velocity.x, velocity.y);
    const minPlanar = 0.6;
    if (planar >= minPlanar) return velocity;
    const angle = planar > 0.0001 ? Math.atan2(velocity.y, velocity.x) : Math.random() * Math.PI * 2;
    return {
      x: Math.cos(angle) * minPlanar,
      y: Math.sin(angle) * minPlanar,
      z: velocity.z,
    };
  };
  
  // If updating existing, maintain some continuity
  if (existing) {
    const speed = sampleSpeedForClass(existing.class, existing.speed);
    const previousPlanar = Math.hypot(existing.velocity.x, existing.velocity.y);
    const previousHeading =
      previousPlanar > 0.0001 ? Math.atan2(existing.velocity.y, existing.velocity.x) : Math.random() * Math.PI * 2;
    const heading = previousHeading + (Math.random() - 0.5) * 0.08 * timeScale;
    const planarVelocityMag = speedToPlanarVelocity(speed);

    // Map movement is now directly tied to class speed profile.
    const velocity = enforceMinPlanarVelocity({
      x: Math.cos(heading) * planarVelocityMag,
      y: Math.sin(heading) * planarVelocityMag,
      z: existing.velocity.z + (Math.random() - 0.5) * 0.05 * timeScale,
    });

    const position = {
      // Use freshly sampled velocity so class speed changes are reflected immediately on map motion.
      x: existing.position.x + velocity.x * 0.1 * timeScale,
      y: existing.position.y + velocity.y * 0.1 * timeScale,
      z: existing.position.z + velocity.z * 0.1 * timeScale,
    };
    const distance = Math.sqrt(position.x ** 2 + position.y ** 2);
    const uavProbability = estimateUavProbability(existing.class, speed, distance);
    const fallbackSensorGeo = readSensorCalibration();
    const previousGeo =
      existing.geoPosition ??
      offsetGeoPosition(
        fallbackSensorGeo,
        existing.position.x * METERS_PER_RADAR_UNIT,
        existing.position.y * METERS_PER_RADAR_UNIT
      );
    const geoPosition = offsetGeoPosition(
      previousGeo,
      (position.x - existing.position.x) * METERS_PER_RADAR_UNIT,
      (position.y - existing.position.y) * METERS_PER_RADAR_UNIT
    );

    // Update track history
    const trackHistory = [...existing.trackHistory.slice(-19), { x: position.x, y: position.y }];
    const geoTrackHistory = [...(existing.geoTrackHistory ?? [previousGeo]).slice(-19), geoPosition];
    
    // Update predicted path (project 10 seconds ahead)
    const predictedPath = predictPath({ x: position.x, y: position.y }, { x: velocity.x, y: velocity.y }, 10);
    const geoPredictedPath = predictedPath.map((point) =>
      offsetGeoPosition(
        geoPosition,
        (point.x - position.x) * METERS_PER_RADAR_UNIT,
        (point.y - position.y) * METERS_PER_RADAR_UNIT
      )
    );

    // Slight confidence variation
    const confidence = Math.max(50, Math.min(99, existing.confidence + (Math.random() - 0.5) * 5));
    const probabilities = generateProbabilities(existing.class, confidence);

    const nextStatus = existing.status === 'CANDIDATE' ? ('CANDIDATE' as ObjectStatus) : ('TRACKING' as ObjectStatus);
    const score = computeRadarTrackScore(confidence, uavProbability, nextStatus);

    return {
      ...existing,
      confidence,
      score,
      probabilities,
      position,
      velocity,
      speed,
      distance,
      trackingDuration: existing.trackingDuration + timeScale,
      status: nextStatus,
      timestamp: new Date(),
      trackHistory,
      predictedPath,
      geoPosition,
      geoTrackHistory,
      geoPredictedPath,
      uavThreshold,
      uavProbability,
      uavDecision: toUavDecision(uavProbability, uavThreshold),
      featureWindowMs: 2000,
      inferenceModelVersion: 'heuristic-uav-v1',
    };
  }

  // New object
  const objectClass: ObjectClass = OBJECT_CLASSES[Math.floor(Math.random() * OBJECT_CLASSES.length)];
  
  // Keep initial mock tracks inside radar observability range (35km).
  const angle = Math.random() * Math.PI * 2;
  const maxSpawnDistance = Math.min(80, MAX_DETECTION_RANGE_UNITS * 0.9);
  const minSpawnDistance = Math.min(20, maxSpawnDistance);
  const dist = minSpawnDistance + Math.random() * Math.max(1, maxSpawnDistance - minSpawnDistance);
  const position = {
    x: Math.cos(angle) * dist,
    y: Math.sin(angle) * dist,
    z: 100 + Math.random() * 5000, // Altitude
  };

  const speed = sampleSpeedForClass(objectClass);
  const velocityAngle = Math.random() * Math.PI * 2;
  const planarVelocityMag = speedToPlanarVelocity(speed) * (0.94 + Math.random() * 0.12);
  const velocity = enforceMinPlanarVelocity({
    x: Math.cos(velocityAngle) * planarVelocityMag,
    y: Math.sin(velocityAngle) * planarVelocityMag,
    z: (Math.random() - 0.5) * 5,
  });

  const uavProbability = estimateUavProbability(objectClass, speed, Math.sqrt(position.x ** 2 + position.y ** 2));

  // Size based on class
  let size = { width: 10, height: 4, length: 15 };
  if (objectClass === 'UAV') size = { width: 2, height: 0.5, length: 2 };
  else if (objectClass === 'HELICOPTER') size = { width: 12, height: 4, length: 15 };
  else if (objectClass === 'FIGHTER') size = { width: 12, height: 4, length: 18 };
  else if (objectClass === 'CIVIL_AIR') size = { width: 35, height: 12, length: 40 };
  else if (objectClass === 'BIRD') size = { width: 0.5, height: 0.2, length: 0.5 };
  else if (objectClass === 'BIRD_FLOCK') size = { width: 5, height: 2, length: 5 };

  const distance = Math.sqrt(position.x ** 2 + position.y ** 2);
  const confidence = 60 + Math.random() * 35;
  const probabilities = generateProbabilities(objectClass, confidence);

  let riskLevel: RiskLevel = 'LOW';
  if ((objectClass === 'UAV' || objectClass === 'FIGHTER') && distance < 40) riskLevel = 'HIGH';
  else if (objectClass === 'HIGHSPEED') riskLevel = 'CRITICAL';
  else if (objectClass === 'UAV') riskLevel = 'MEDIUM';
  else if (objectClass === 'BIRD' || objectClass === 'BIRD_FLOCK') riskLevel = 'LOW';
  
  const predictedPath = predictPath({ x: position.x, y: position.y }, { x: velocity.x, y: velocity.y }, 10);
  const sensorGeo = readSensorCalibration();
  const geoPosition = offsetGeoPosition(
    sensorGeo,
    position.x * METERS_PER_RADAR_UNIT,
    position.y * METERS_PER_RADAR_UNIT
  );
  const geoPredictedPath = predictedPath.map((point) =>
    offsetGeoPosition(
      geoPosition,
      (point.x - position.x) * METERS_PER_RADAR_UNIT,
      (point.y - position.y) * METERS_PER_RADAR_UNIT
    )
  );

  const status: ObjectStatus = 'NEW';
  const score = computeRadarTrackScore(confidence, uavProbability, status);

  return {
    id,
    class: objectClass,
    confidence,
    score,
    probabilities,
    position,
    velocity,
    speed,
    size,
    distance,
    trackingDuration: 0,
    status,
    riskLevel,
    timestamp: new Date(),
    trackHistory: [{ x: position.x, y: position.y }],
    predictedPath,
    geoPosition,
    geoTrackHistory: [geoPosition],
    geoPredictedPath,
    uavThreshold,
    uavProbability,
    uavDecision: toUavDecision(uavProbability, uavThreshold),
    featureWindowMs: 2000,
    inferenceModelVersion: 'heuristic-uav-v1',
  };
}

const probabilityForDelta = (probabilityPerSecond: number, deltaSeconds: number): number => {
  const bounded = clamp(probabilityPerSecond, 0, 1);
  if (bounded <= 0) return 0;
  if (bounded >= 1) return 1;
  return 1 - Math.pow(1 - bounded, Math.max(0.001, deltaSeconds));
};

// Manage object lifecycle: create, update, remove
export function updateObjectTracking(currentObjects: DetectedObject[], deltaSeconds = 1): DetectedObject[] {
  const updated: DetectedObject[] = [];
  mockLostReasons.clear();
  const timeScale = clamp(deltaSeconds, 0.02, 2);
  const reacquireChance = probabilityForDelta(0.2, timeScale);
  const dropChance = probabilityForDelta(0.1, timeScale);
  const coastChance = probabilityForDelta(0.02, timeScale);
  const spawnChance = probabilityForDelta(0.1, timeScale);

  // Update existing objects
  for (const obj of currentObjects) {
    let newStatus = obj.status;
    let newConfidence = obj.confidence;

    // State transitions
    if (obj.status === 'CANDIDATE') {
      // 20% chance to re-acquire signal
      if (Math.random() < reacquireChance) {
        newStatus = 'TRACKING';
        newConfidence = 70 + Math.random() * 20;
      } 
      // 10% chance to fully lose track if it's been a candidate for a while
      else if (Math.random() < dropChance) {
        newStatus = 'LOST';
      }
      // Decay confidence while coasting
      else {
        newConfidence = Math.max(10, obj.confidence - 5);
      }
    } else {
      // 2% chance to lose signal and become a candidate (coast mode)
      if (Math.random() < coastChance && obj.trackingDuration > 3) {
        newStatus = 'CANDIDATE';
        newConfidence = 40; // Drop confidence immediately
      }
    }

    if (newStatus === 'LOST') {
      // Don't include in next frame
      mockLostReasons.set(obj.id, 'SIGNAL_LOST');
      continue;
    }

    // Update position and physics
    // If CANDIDATE, we predict position but add more uncertainty (handled in generateDetectedObject?)
    // Actually, let's just use generateDetectedObject but override status
    const updatedObj = generateDetectedObject({
      ...obj,
      status: newStatus,
      confidence: newConfidence,
    }, timeScale);

    // Tracks outside radar observable range are dropped from mock feed.
    if (!isWithinDetectionRange(updatedObj.position)) {
      mockLostReasons.set(updatedObj.id, 'OUT_OF_RANGE');
      continue;
    }
    
    // Mark as STABLE if tracked for >5 seconds and not a candidate
    if (updatedObj.status !== 'CANDIDATE' && updatedObj.trackingDuration > 5) {
      updatedObj.status = 'STABLE';
    }

    updated.push(updatedObj);
  }

  // Remove lost objects (already handled by continue)
  
  // 10% chance to add new object if we have < 12 objects
  if (Math.random() < spawnChance && updated.length < 12) {
    updated.push(generateDetectedObject());
  }

  return updated;
}

export function generateSystemStatus(isLive: boolean, objectCount: number): SystemStatus {
  const activeTracksCount = Math.max(0, objectCount - Math.floor(Math.random() * 2));
  
  return {
    connectionStatus: isLive ? 'LIVE' : 'DISCONNECTED',
    modelName: 'RadarNet-Fusion',
    modelVersion: 'v4.1.0',
    device: 'AESA-Array-X1',
    latency: 2.5 + Math.random() * 4,
    fps: 0,
    trackedObjects: objectCount,
    activeTracksCount,
    totalDetected: objectIdCounter - 1,
    // Keep mock status stable; DEGRADED should come from actual track-feed condition.
    sensorStatus: 'ONLINE',
    cpuUsage: 35 + Math.random() * 25, // 35-60%
    gpuUsage: 70 + Math.random() * 20, // 70-90%
    ramUsage: 45 + Math.random() * 20, // 45-65%
    inferenceLatencyP50: 30 + Math.random() * 25,
    inferenceLatencyP95: 55 + Math.random() * 35,
    pipelineLatencyP95: 90 + Math.random() * 40,
  };
}

let eventIdCounter = 1;

export function generateEvent(
  type: TimelineEvent['type'],
  customMessage?: string,
  objectId?: string,
  objectClass?: ObjectClass
): TimelineEvent {
  const messages = {
    INFO: [
      '객체 감지됨',
      '추적 안정적',
      '분류 완료',
      '트랙 설정됨',
    ],
    WARNING: [
      '신뢰도 저하 감지됨',
      '객체 속도 변경됨',
      '근접한 다중 객체',
      '트랙 불안정',
    ],
    ALERT: [
      '고위험 객체 감지됨',
      '객체가 경계에 접근 중',
      '비정상적인 행동 감지됨',
      '치명적인 근접 경고',
    ],
  };

  const message = customMessage || messages[type][Math.floor(Math.random() * messages[type].length)];

  return {
    id: `evt-${eventIdCounter++}`,
    timestamp: new Date(),
    type,
    message,
    objectId,
    objectClass: objectClass ?? 'UNKNOWN',
  };
}

// Generate object-specific events
export function generateObjectEvent(obj: DetectedObject, eventType: 'DETECTED' | 'LOST' | 'SPEED_CHANGE' | 'RISK_CHANGE'): TimelineEvent {
  let message = '';
  let type: TimelineEvent['type'] = 'INFO';

  switch (eventType) {
    case 'DETECTED':
      message = `${obj.class} 감지됨 (${obj.id})`;
      type = 'INFO';
      break;
    case 'LOST':
      message = `트랙 손실됨 (${obj.id})`;
      type = 'WARNING';
      break;
    case 'SPEED_CHANGE':
      message = `${obj.id} 속도 변경됨: ${obj.speed.toFixed(1)} m/s`;
      type = 'WARNING';
      break;
    case 'RISK_CHANGE':
      message = `${obj.id} 위험 수준: ${obj.riskLevel}`;
      type = obj.riskLevel === 'HIGH' || obj.riskLevel === 'CRITICAL' ? 'ALERT' : 'WARNING';
      break;
  }

  return generateEvent(type, message, obj.id, obj.class);
}
