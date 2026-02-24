import {
  DetectedObject,
  TimelineEvent,
  SystemStatus,
  ObjectClass,
  ObjectStatus,
  RiskLevel,
  ClassProbability,
} from '../types';

const OBJECT_CLASSES: ObjectClass[] = ['HELICOPTER', 'UAV', 'HIGHSPEED', 'BIRD_FLOCK', 'BIRD', 'CIVIL_AIR', 'FIGHTER'];

let objectIdCounter = 1;
let existingObjects: DetectedObject[] = [];

const clamp = (value: number, min: number, max: number): number => {
  if (value < min) return min;
  if (value > max) return max;
  return value;
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
export function generateDetectedObject(existing?: DetectedObject): DetectedObject {
  const id = existing?.id || `TRK-${String(objectIdCounter++).padStart(4, '0')}`;
  const uavThreshold = existing?.uavThreshold ?? 35;
  
  // If updating existing, maintain some continuity
  if (existing) {
    const position = {
      x: existing.position.x + existing.velocity.x * 0.1,
      y: existing.position.y + existing.velocity.y * 0.1,
      z: existing.position.z + existing.velocity.z * 0.1,
    };

    // Small velocity variations
    const velocity = {
      x: existing.velocity.x + (Math.random() - 0.5) * 0.5,
      y: existing.velocity.y + (Math.random() - 0.5) * 0.5,
      z: existing.velocity.z + (Math.random() - 0.5) * 0.05,
    };

    const speed = Math.sqrt(velocity.x ** 2 + velocity.y ** 2 + velocity.z ** 2);
    const distance = Math.sqrt(position.x ** 2 + position.y ** 2);
    const uavProbability = estimateUavProbability(existing.class, speed, distance);

    // Update track history
    const trackHistory = [...existing.trackHistory.slice(-19), { x: position.x, y: position.y }];
    
    // Update predicted path (project 10 seconds ahead)
    const predictedPath = predictPath({ x: position.x, y: position.y }, { x: velocity.x, y: velocity.y }, 10);

    // Slight confidence variation
    const confidence = Math.max(50, Math.min(99, existing.confidence + (Math.random() - 0.5) * 5));
    const probabilities = generateProbabilities(existing.class, confidence);

    return {
      ...existing,
      confidence,
      probabilities,
      position,
      velocity,
      speed,
      distance,
      trackingDuration: existing.trackingDuration + 1,
      status: existing.status === 'CANDIDATE' ? 'CANDIDATE' : 'TRACKING' as ObjectStatus,
      timestamp: new Date(),
      trackHistory,
      predictedPath,
      uavThreshold,
      uavProbability,
      uavDecision: toUavDecision(uavProbability, uavThreshold),
      featureWindowMs: 2000,
      inferenceModelVersion: 'heuristic-uav-v1',
    };
  }

  // New object
  const objectClass: ObjectClass = OBJECT_CLASSES[Math.floor(Math.random() * OBJECT_CLASSES.length)];
  
  // Random position in detection range (-100 to 100 km scaled down)
  const angle = Math.random() * Math.PI * 2;
  const dist = 20 + Math.random() * 80;
  const position = {
    x: Math.cos(angle) * dist,
    y: Math.sin(angle) * dist,
    z: 100 + Math.random() * 5000, // Altitude
  };

  // Random velocity based on object class
  let maxSpeed = 100; // m/s
  if (objectClass === 'UAV') maxSpeed = 40;
  else if (objectClass === 'HELICOPTER') maxSpeed = 80;
  else if (objectClass === 'HIGHSPEED') maxSpeed = 600;
  else if (objectClass === 'FIGHTER') maxSpeed = 400;
  else if (objectClass === 'CIVIL_AIR') maxSpeed = 250;
  else if (objectClass === 'BIRD') maxSpeed = 15;
  else if (objectClass === 'BIRD_FLOCK') maxSpeed = 20;

  const velocityAngle = Math.random() * Math.PI * 2;
  const velocityMag = Math.random() * maxSpeed * 0.1; // scaled for simulation step
  const velocity = {
    x: Math.cos(velocityAngle) * velocityMag,
    y: Math.sin(velocityAngle) * velocityMag,
    z: (Math.random() - 0.5) * 5,
  };

  const speed = Math.sqrt(velocity.x ** 2 + velocity.y ** 2 + velocity.z ** 2);
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

  return {
    id,
    class: objectClass,
    confidence,
    probabilities,
    position,
    velocity,
    speed,
    size,
    distance,
    trackingDuration: 0,
    status: 'NEW' as ObjectStatus,
    riskLevel,
    timestamp: new Date(),
    trackHistory: [{ x: position.x, y: position.y }],
    predictedPath,
    uavThreshold,
    uavProbability,
    uavDecision: toUavDecision(uavProbability, uavThreshold),
    featureWindowMs: 2000,
    inferenceModelVersion: 'heuristic-uav-v1',
  };
}

// Manage object lifecycle: create, update, remove
export function updateObjectTracking(currentObjects: DetectedObject[]): DetectedObject[] {
  const updated: DetectedObject[] = [];

  // Update existing objects
  for (const obj of currentObjects) {
    let newStatus = obj.status;
    let newConfidence = obj.confidence;

    // State transitions
    if (obj.status === 'CANDIDATE') {
      // 20% chance to re-acquire signal
      if (Math.random() < 0.2) {
        newStatus = 'TRACKING';
        newConfidence = 70 + Math.random() * 20;
      } 
      // 10% chance to fully lose track if it's been a candidate for a while
      else if (Math.random() < 0.1) {
        newStatus = 'LOST';
      }
      // Decay confidence while coasting
      else {
        newConfidence = Math.max(10, obj.confidence - 5);
      }
    } else {
      // 2% chance to lose signal and become a candidate (coast mode)
      if (Math.random() < 0.02 && obj.trackingDuration > 3) {
        newStatus = 'CANDIDATE';
        newConfidence = 40; // Drop confidence immediately
      }
    }

    if (newStatus === 'LOST') {
      // Don't include in next frame
      continue;
    }

    // Update position and physics
    // If CANDIDATE, we predict position but add more uncertainty (handled in generateDetectedObject?)
    // Actually, let's just use generateDetectedObject but override status
    const updatedObj = generateDetectedObject({
      ...obj,
      status: newStatus,
      confidence: newConfidence,
    });
    
    // Mark as STABLE if tracked for >5 seconds and not a candidate
    if (updatedObj.status !== 'CANDIDATE' && updatedObj.trackingDuration > 5) {
      updatedObj.status = 'STABLE';
    }

    updated.push(updatedObj);
  }

  // Remove lost objects (already handled by continue)
  
  // 10% chance to add new object if we have < 12 objects
  if (Math.random() < 0.1 && updated.length < 12) {
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
    fps: 58 + Math.random() * 12,
    trackedObjects: objectCount,
    activeTracksCount,
    totalDetected: objectIdCounter - 1,
    sensorStatus: Math.random() > 0.95 ? 'DEGRADED' : 'ONLINE',
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
  objectId?: string
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

  return generateEvent(type, message, obj.id);
}
