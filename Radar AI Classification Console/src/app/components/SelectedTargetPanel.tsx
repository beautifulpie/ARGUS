import { Target, Navigation, Gauge, Box, Clock, AlertTriangle } from 'lucide-react';
import { DetectedObject, ObjectClass, RiskLevel, ObjectStatus } from '../types';

interface SelectedTargetPanelProps {
  selectedObject: DetectedObject | null;
}

const CLASS_NAMES_KR: Record<ObjectClass, string> = {
  HELICOPTER: '헬기',
  UAV: '무인기',
  HIGHSPEED: '고속기',
  BIRD_FLOCK: '새떼',
  BIRD: '새',
  CIVIL_AIR: '민간기',
  FIGHTER: '전투기',
};

const RISK_NAMES_KR: Record<RiskLevel, string> = {
  LOW: '저위험',
  MEDIUM: '중위험',
  HIGH: '고위험',
  CRITICAL: '치명적',
};

const STATUS_NAMES_KR: Record<ObjectStatus, string> = {
  STABLE: '안정',
  NEW: '신규',
  LOST: '손실',
  TRACKING: '추적 중',
  CANDIDATE: '후보 추적',
};

export function SelectedTargetPanel({ selectedObject }: SelectedTargetPanelProps) {
  if (!selectedObject) {
    return (
      <div className="h-full flex items-center justify-center bg-[#0a0d12] border-b border-cyan-950/50">
        <div className="text-center">
          <Target className="w-16 h-16 text-cyan-900/30 mx-auto mb-4" />
          <p className="text-base text-gray-500 font-mono">선택된 객체 없음</p>
          <p className="text-sm text-gray-600 font-mono mt-2">공간 뷰에서 객체를 클릭하세요</p>
        </div>
      </div>
    );
  }

  const getRiskColor = () => {
    switch (selectedObject.riskLevel) {
      case 'CRITICAL':
        return 'text-red-500 border-red-500/50 bg-red-950/20';
      case 'HIGH':
        return 'text-orange-500 border-orange-500/50 bg-orange-950/20';
      case 'MEDIUM':
        return 'text-yellow-500 border-yellow-500/50 bg-yellow-950/20';
      case 'LOW':
        return 'text-green-500 border-green-500/50 bg-green-950/20';
    }
  };

  const getStatusColor = () => {
    switch (selectedObject.status) {
      case 'NEW':
        return 'text-green-400';
      case 'LOST':
        return 'text-red-400';
      case 'STABLE':
        return 'text-cyan-400';
      case 'TRACKING':
        return 'text-blue-400';
      case 'CANDIDATE':
        return 'text-amber-400';
    }
  };

  return (
    <div className="h-full bg-[#0a0d12] border-b border-cyan-950/50 flex flex-col relative overflow-hidden">
      {/* Corner brackets */}
      <div className="absolute top-4 left-6 w-4 h-4 border-l-2 border-t-2 border-cyan-500/40" />
      <div className="absolute top-4 right-6 w-4 h-4 border-r-2 border-t-2 border-cyan-500/40" />

      <div className="p-6 flex flex-col h-full overflow-auto">
        {/* Header */}
        <div className="flex items-start justify-between mb-6">
          <div>
            <div className="flex items-center gap-3">
              <h2 className="text-3xl font-bold text-cyan-400 font-mono tracking-wide">
                {selectedObject.id}
              </h2>
              <span className={`px-2 py-1 text-sm font-semibold uppercase tracking-wider ${getStatusColor()}`}>
                {STATUS_NAMES_KR[selectedObject.status]}
              </span>
            </div>
            <p className="text-base text-gray-500 mt-1 font-mono">선택된 타겟</p>
          </div>

          <div className={`px-4 py-2 border rounded text-base font-semibold uppercase tracking-wider ${getRiskColor()}`}>
            {RISK_NAMES_KR[selectedObject.riskLevel]}
          </div>
        </div>

          {/* Classification */}
          <div className="mb-6">
            <div className="flex items-baseline gap-4">
              <span className="text-5xl font-bold text-white">{CLASS_NAMES_KR[selectedObject.class]}</span>
              <span className="text-3xl text-cyan-400 font-mono">{selectedObject.confidence.toFixed(1)}%</span>
            </div>
            <div className="mt-3 h-3 bg-gray-900 rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-cyan-500 to-cyan-400"
                style={{ width: `${selectedObject.confidence}%` }}
              />
            </div>

            {/* Candidate Probabilities */}
            {selectedObject.probabilities && selectedObject.probabilities.length > 1 && (
              <div className="mt-4 space-y-2">
                <p className="text-xs text-gray-500 uppercase tracking-wider mb-2">추가 분류 후보</p>
                {selectedObject.probabilities.slice(1, 4).map((prob, idx) => (
                  <div key={idx} className="flex items-center gap-3 text-sm">
                    <span className="w-16 text-gray-400">{CLASS_NAMES_KR[prob.className]}</span>
                    <div className="flex-1 h-1.5 bg-gray-800 rounded-full overflow-hidden">
                      <div 
                        className="h-full bg-gray-600" 
                        style={{ width: `${prob.probability}%` }}
                      />
                    </div>
                    <span className="w-10 text-right font-mono text-gray-500">{prob.probability.toFixed(0)}%</span>
                  </div>
                ))}
              </div>
            )}
          </div>

        {/* Metrics Grid */}
        <div className="grid grid-cols-3 gap-5 flex-1">
          {/* Position */}
          <div className="bg-gray-900/30 border border-cyan-950/50 rounded p-4">
            <div className="flex items-center gap-2 mb-3">
              <Navigation className="w-5 h-5 text-cyan-500" />
              <span className="text-sm font-bold text-gray-500 uppercase tracking-wider">위치</span>
            </div>
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-gray-400">X:</span>
                <span className="text-gray-200 font-mono text-base">{selectedObject.position.x.toFixed(1)} m</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-gray-400">Y:</span>
                <span className="text-gray-200 font-mono text-base">{selectedObject.position.y.toFixed(1)} m</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-gray-400">Z:</span>
                <span className="text-gray-200 font-mono text-base">{selectedObject.position.z.toFixed(1)} m</span>
              </div>
            </div>
          </div>

          {/* Velocity */}
          <div className="bg-gray-900/30 border border-cyan-950/50 rounded p-4">
            <div className="flex items-center gap-2 mb-3">
              <Gauge className="w-5 h-5 text-cyan-500" />
              <span className="text-sm font-bold text-gray-500 uppercase tracking-wider">속도</span>
            </div>
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-gray-400">속력:</span>
                <span className="text-gray-200 font-mono font-semibold text-base">{selectedObject.speed.toFixed(1)} m/s</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-gray-400">Vx:</span>
                <span className="text-gray-200 font-mono text-base">{selectedObject.velocity.x.toFixed(1)}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-gray-400">Vy:</span>
                <span className="text-gray-200 font-mono text-base">{selectedObject.velocity.y.toFixed(1)}</span>
              </div>
            </div>
          </div>

          {/* Size */}
          <div className="bg-gray-900/30 border border-cyan-950/50 rounded p-4">
            <div className="flex items-center gap-2 mb-3">
              <Box className="w-5 h-5 text-cyan-500" />
              <span className="text-sm font-bold text-gray-500 uppercase tracking-wider">치수</span>
            </div>
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-gray-400">길이:</span>
                <span className="text-gray-200 font-mono text-base">{selectedObject.size.length.toFixed(1)} m</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-gray-400">너비:</span>
                <span className="text-gray-200 font-mono text-base">{selectedObject.size.width.toFixed(1)} m</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-gray-400">높이:</span>
                <span className="text-gray-200 font-mono text-base">{selectedObject.size.height.toFixed(1)} m</span>
              </div>
            </div>
          </div>

          {/* Tracking Info */}
          <div className="bg-gray-900/30 border border-cyan-950/50 rounded p-4">
            <div className="flex items-center gap-2 mb-3">
              <Clock className="w-5 h-5 text-cyan-500" />
              <span className="text-sm font-bold text-gray-500 uppercase tracking-wider">추적</span>
            </div>
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-gray-400">지속 시간:</span>
                <span className="text-gray-200 font-mono text-base">{selectedObject.trackingDuration}s</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-gray-400">히스토리:</span>
                <span className="text-gray-200 font-mono text-base">{selectedObject.trackHistory.length} pts</span>
              </div>
            </div>
          </div>

          {/* Distance */}
          <div className="bg-gray-900/30 border border-cyan-950/50 rounded p-4">
            <div className="flex items-center gap-2 mb-3">
              <Target className="w-5 h-5 text-cyan-500" />
              <span className="text-sm font-bold text-gray-500 uppercase tracking-wider">거리</span>
            </div>
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-gray-400">범위:</span>
                <span className="text-gray-200 font-mono font-semibold text-base">{selectedObject.distance.toFixed(1)} m</span>
              </div>
            </div>
          </div>

          {/* Risk Assessment */}
          <div className="bg-gray-900/30 border border-cyan-950/50 rounded p-4">
            <div className="flex items-center gap-2 mb-3">
              <AlertTriangle className="w-5 h-5 text-cyan-500" />
              <span className="text-sm font-bold text-gray-500 uppercase tracking-wider">평가</span>
            </div>
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-gray-400">위협:</span>
                <span className={`font-mono font-semibold text-base ${
                  selectedObject.riskLevel === 'CRITICAL' ? 'text-red-400' :
                  selectedObject.riskLevel === 'HIGH' ? 'text-orange-400' :
                  selectedObject.riskLevel === 'MEDIUM' ? 'text-yellow-400' :
                  'text-green-400'
                }`}>
                  {RISK_NAMES_KR[selectedObject.riskLevel]}
                </span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-gray-400">UAV 판정:</span>
                <span
                  className={`font-mono font-semibold text-base ${
                    selectedObject.uavDecision === 'UAV'
                      ? 'text-red-300'
                      : selectedObject.uavDecision === 'NON_UAV'
                      ? 'text-green-300'
                      : 'text-gray-400'
                  }`}
                >
                  {selectedObject.uavDecision === 'UAV'
                    ? 'UAV'
                    : selectedObject.uavDecision === 'NON_UAV'
                    ? 'NON-UAV'
                    : 'UNKNOWN'}{' '}
                  ({(selectedObject.uavProbability ?? 0).toFixed(1)}%)
                </span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-gray-400">모델:</span>
                <span className="text-gray-300 font-mono text-base">
                  {selectedObject.inferenceModelVersion || '-'}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
