export type ConnectionStatus = 'DISCONNECTED' | 'LIVE' | 'REPLAY';

export type RiskLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export type StabilityLevel = 'STABLE' | 'MODERATE' | 'UNSTABLE';

export type EventType = 'INFO' | 'WARNING' | 'ALERT';

export type ObjectStatus = 'STABLE' | 'NEW' | 'LOST' | 'TRACKING' | 'CANDIDATE';

export type ObjectClass = 'HELICOPTER' | 'UAV' | 'HIGHSPEED' | 'BIRD_FLOCK' | 'BIRD' | 'CIVIL_AIR' | 'FIGHTER';
export type UavDecision = 'UAV' | 'NON_UAV' | 'UNKNOWN';

export interface ClassProbability {
  className: ObjectClass;
  probability: number;
}

// LiDAR detected object
export interface DetectedObject {
  id: string;
  class: ObjectClass;
  confidence: number;
  probabilities: ClassProbability[]; // Other candidate probabilities
  position: { x: number; y: number; z: number };
  velocity: { x: number; y: number; z: number };
  speed: number; // Magnitude of velocity
  size: { width: number; height: number; length: number };
  distance: number; // Distance from sensor
  trackingDuration: number; // How long has this been tracked (seconds)
  status: ObjectStatus;
  riskLevel: RiskLevel;
  timestamp: Date;
  trackHistory: { x: number; y: number }[]; // For trail visualization
  predictedPath: { x: number; y: number }[]; // Future path prediction
  // UAV binary classification from Python inference service
  uavDecision?: UavDecision;
  uavProbability?: number; // 0-100
  uavThreshold?: number; // 0-100
  featureWindowMs?: number;
  inferenceModelVersion?: string;
}

export interface ClassificationResult {
  className: string;
  confidence: number;
  stability: StabilityLevel;
  riskLevel: RiskLevel;
  timestamp: Date;
}

export interface TimelineEvent {
  id: string;
  timestamp: Date;
  type: EventType;
  message: string;
  objectId?: string; // Optional reference to object
}

export interface SystemStatus {
  connectionStatus: ConnectionStatus;
  modelName: string;
  modelVersion: string;
  device: string;
  latency: number;
  fps: number;
  trackedObjects: number;
  activeTracksCount: number;
  totalDetected: number;
  sensorStatus: 'ONLINE' | 'DEGRADED' | 'OFFLINE';
  cpuUsage: number; // 0-100
  gpuUsage: number; // 0-100
  ramUsage: number; // 0-100
  inferenceLatencyP50?: number;
  inferenceLatencyP95?: number;
  pipelineLatencyP95?: number;
}

export interface SignalData {
  channels: number[][];
  timestamps: number[];
  inferenceWindow: { start: number; end: number };
  missingRanges: { start: number; end: number }[];
}
