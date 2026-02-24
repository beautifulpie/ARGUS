import { useState, useEffect, useCallback, useRef } from 'react';
import { StatusBar } from './components/StatusBar';
import { LidarSpatialView } from './components/LidarSpatialView';
import { SelectedTargetPanel } from './components/SelectedTargetPanel';
import { ObjectListTable } from './components/ObjectListTable';
import { EventTimeline } from './components/EventTimeline';
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
} from './types';

import { CandidateTracksPanel } from './components/CandidateTracksPanel';

const MAX_EVENT_LOGS = 400;

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
          obj.id
        )
      );
    } else if (previous.uavDecision === 'UAV' && obj.uavDecision === 'NON_UAV') {
      events.push(
        generateEvent(
          'INFO',
          `${obj.id} UAV 판정 해제 (${currentProbability.toFixed(1)}%)`,
          obj.id
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
  const [isLive, setIsLive] = useState(false);
  const [isFrozen, setIsFrozen] = useState(false);
  const [objects, setObjects] = useState<DetectedObject[]>([]);
  const [selectedObjectId, setSelectedObjectId] = useState<string | null>(null);
  const [events, setEvents] = useState<TimelineEvent[]>([]);
  const [systemStatus, setSystemStatus] = useState<SystemStatus>(() => 
    generateSystemStatus(false, 0)
  );
  const objectsRef = useRef<DetectedObject[]>([]);
  const argusErrorLoggedRef = useRef(false);

  useEffect(() => {
    objectsRef.current = objects;
  }, [objects]);

  const appendEvents = useCallback((nextEvents: TimelineEvent[]) => {
    if (nextEvents.length === 0) {
      return;
    }

    setEvents((prev) => [...prev, ...nextEvents].slice(-MAX_EVENT_LOGS));
  }, []);

  const runMockTick = useCallback(() => {
    setObjects((prevObjects) => {
      const nextObjects = updateObjectTracking(prevObjects);
      appendEvents(buildObjectChangeEvents(prevObjects, nextObjects));
      return nextObjects;
    });

    setSystemStatus((prev) => generateSystemStatus(true, prev.trackedObjects));
  }, [appendEvents]);

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

        const derivedEvents = buildObjectChangeEvents(objectsRef.current, frame.objects);
        setObjects(frame.objects);
        setSystemStatus(frame.systemStatus);
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
            ...prev,
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
  }, [isLive, isFrozen, useArgusBridge, runMockTick, appendEvents]);

  // Add initial events and objects when going live
  useEffect(() => {
    if (isLive) {
      appendEvents([
        generateEvent('INFO', '시스템 온라인'),
        generateEvent(
          'INFO',
          useArgusBridge
            ? `ARGUS 브리지 연결 모드 (${ARGUS_CONFIG.baseUrl})`
            : 'AESA 레이더 활성화'
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
      setSystemStatus(generateSystemStatus(false, 0));
      argusErrorLoggedRef.current = false;
    }
  }, [isLive, useArgusBridge, appendEvents]);

  // Update system status with current object count
  useEffect(() => {
    setSystemStatus((prev) => ({
      ...prev,
      trackedObjects: objects.length,
      activeTracksCount: objects.filter(obj => obj.status === 'STABLE' || obj.status === 'TRACKING').length,
    }));
  }, [objects]);

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

  const selectedObject = objects.find(obj => obj.id === selectedObjectId) || null;

  return (
    <div className="h-screen w-screen bg-[#0b0f14] text-gray-100 flex flex-col overflow-hidden relative">
      {/* Subtle grid overlay for technical aesthetic */}
      <div 
        className="absolute inset-0 pointer-events-none opacity-[0.015]"
        style={{
          backgroundImage: `
            linear-gradient(rgba(6, 182, 212, 0.5) 1px, transparent 1px),
            linear-gradient(90deg, rgba(6, 182, 212, 0.5) 1px, transparent 1px)
          `,
          backgroundSize: '20px 20px',
        }}
      />

      {/* Status Bar */}
      <StatusBar
        status={systemStatus}
        isLive={isLive}
        isFrozen={isFrozen}
        onToggleLive={handleToggleLive}
        onFreeze={handleFreeze}
        onMarkEvent={handleMarkEvent}
        onExport={handleExport}
      />

      {/* Main Content Grid */}
      <div className="flex-1 grid grid-cols-[600px_1fr] grid-rows-[420px_1fr_250px] overflow-hidden">
        {/* Left Panel - LiDAR Spatial View (spans 3 rows) */}
        <div className="row-span-3">
          <LidarSpatialView
            objects={objects}
            selectedObjectId={selectedObjectId}
            onSelectObject={handleSelectObject}
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
        <div className="overflow-hidden flex">
          <div className="w-1/2 border-r border-cyan-950/50">
            <CandidateTracksPanel 
              objects={objects} 
              onSelectObject={handleSelectObject} 
            />
          </div>
          <div className="w-1/2">
            <EventTimeline events={events} />
          </div>
        </div>
      </div>
    </div>
  );
}

export default App;
