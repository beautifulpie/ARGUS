import { Activity, Circle, Play, Pause, Camera, Download, AlertCircle, Cpu, MemoryStick, Layers } from 'lucide-react';
import { SystemStatus } from '../types';

interface StatusBarProps {
  status: SystemStatus;
  isLive: boolean;
  isFrozen: boolean;
  onToggleLive: () => void;
  onFreeze: () => void;
  onMarkEvent: () => void;
  onExport: () => void;
}

export function StatusBar({
  status,
  isLive,
  isFrozen,
  onToggleLive,
  onFreeze,
  onMarkEvent,
  onExport,
}: StatusBarProps) {
  const getStatusColor = () => {
    switch (status.connectionStatus) {
      case 'LIVE':
        return 'text-cyan-400';
      case 'REPLAY':
        return 'text-yellow-500';
      case 'DISCONNECTED':
        return 'text-red-500';
    }
  };

  const getConnectionStatusText = (status: string) => {
    switch (status) {
      case 'LIVE': return '실시간';
      case 'REPLAY': return '재생';
      case 'DISCONNECTED': return '연결 끊김';
      default: return status;
    }
  };

  const getSensorStatusText = (status: string) => {
    switch (status) {
      case 'ONLINE': return '온라인';
      case 'DEGRADED': return '성능 저하';
      case 'OFFLINE': return '오프라인';
      default: return status;
    }
  };

  const getUsageColor = (usage: number) => {
    if (usage < 50) return 'text-green-400';
    if (usage < 70) return 'text-yellow-400';
    if (usage < 85) return 'text-orange-400';
    return 'text-red-400';
  };

  const formatMetric = (value?: number, unit = '') => {
    if (typeof value !== 'number' || Number.isNaN(value) || value <= 0) {
      return '-';
    }
    return `${value.toFixed(1)}${unit}`;
  };

  return (
    <div className="h-16 bg-[#0a0d12] border-b border-cyan-950/50 flex items-center justify-between px-6 shadow-lg shadow-black/50">
      {/* Left: Title and Status */}
      <div className="flex items-center gap-6">
        <div className="flex items-center gap-3">
          <Activity className="w-8 h-8 text-cyan-400" strokeWidth={2.5} />
          <h1 className="text-xl font-bold tracking-wide text-gray-100 uppercase">
            AESA 레이더 탐지 콘솔
          </h1>
        </div>

        <div className="h-10 w-px bg-cyan-950/50" />

        <div className="flex items-center gap-2">
          <Circle
            className={`w-4 h-4 ${getStatusColor()} ${
              status.connectionStatus === 'LIVE' ? 'animate-pulse' : ''
            }`}
            fill="currentColor"
          />
          <span className={`text-lg font-bold ${getStatusColor()}`}>
            {getConnectionStatusText(status.connectionStatus)}
          </span>
        </div>
      </div>

      {/* Center: System Info */}
      <div className="flex items-center gap-8 text-base">
        <div className="flex flex-col items-end">
          <span className="text-gray-500 text-xs font-bold uppercase tracking-wider">모델</span>
          <span className="text-gray-200 font-mono text-lg">
            {status.modelName} <span className="text-cyan-400">{status.modelVersion}</span>
          </span>
        </div>

        <div className="h-10 w-px bg-cyan-950/50" />

        <div className="flex gap-6">
          <div className="flex flex-col items-end">
            <span className="text-gray-500 text-xs font-bold uppercase tracking-wider">추적 중</span>
            <span className="text-gray-200 font-mono text-lg">{status.trackedObjects}</span>
          </div>

          <div className="flex flex-col items-end">
            <span className="text-gray-500 text-xs font-bold uppercase tracking-wider">활성</span>
            <span className="text-gray-200 font-mono text-lg">{status.activeTracksCount}</span>
          </div>

          <div className="flex flex-col items-end">
            <span className="text-gray-500 text-xs font-bold uppercase tracking-wider">지연 시간</span>
            <span className="text-gray-200 font-mono text-lg">{status.latency.toFixed(1)} ms</span>
          </div>

          <div className="flex flex-col items-end">
            <span className="text-gray-500 text-xs font-bold uppercase tracking-wider">FPS</span>
            <span className="text-gray-200 font-mono text-lg">{status.fps.toFixed(1)}</span>
          </div>

          <div className="flex flex-col items-end">
            <span className="text-gray-500 text-xs font-bold uppercase tracking-wider">추론 p95</span>
            <span className="text-cyan-300 font-mono text-lg">
              {formatMetric(status.inferenceLatencyP95, 'ms')}
            </span>
          </div>

          <div className="flex flex-col items-end">
            <span className="text-gray-500 text-xs font-bold uppercase tracking-wider">파이프라인 p95</span>
            <span className="text-cyan-300 font-mono text-lg">
              {formatMetric(status.pipelineLatencyP95, 'ms')}
            </span>
          </div>

          <div className="flex flex-col items-end">
            <span className="text-gray-500 text-xs font-bold uppercase tracking-wider">센서</span>
            <span
              className={`font-mono text-lg font-bold ${
                status.sensorStatus === 'ONLINE'
                  ? 'text-green-400'
                  : status.sensorStatus === 'DEGRADED'
                  ? 'text-yellow-400'
                  : 'text-red-400'
              }`}
            >
              {getSensorStatusText(status.sensorStatus)}
            </span>
          </div>
        </div>

        <div className="h-10 w-px bg-cyan-950/50" />

        {/* Hardware Monitoring */}
        <div className="flex gap-4">
          <div className="flex items-center gap-2">
            <Cpu className="w-4 h-4 text-cyan-500" />
            <div className="flex flex-col items-end">
              <span className="text-gray-500 text-xs font-bold uppercase tracking-wider">CPU</span>
              <span className={`font-mono text-lg font-bold ${getUsageColor(status.cpuUsage)}`}>
                {status.cpuUsage.toFixed(0)}%
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Layers className="w-4 h-4 text-cyan-500" />
            <div className="flex flex-col items-end">
              <span className="text-gray-500 text-xs font-bold uppercase tracking-wider">GPU</span>
              <span className={`font-mono text-lg font-bold ${getUsageColor(status.gpuUsage)}`}>
                {status.gpuUsage.toFixed(0)}%
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <MemoryStick className="w-4 h-4 text-cyan-500" />
            <div className="flex flex-col items-end">
              <span className="text-gray-500 text-xs font-bold uppercase tracking-wider">RAM</span>
              <span className={`font-mono text-lg font-bold ${getUsageColor(status.ramUsage)}`}>
                {status.ramUsage.toFixed(0)}%
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Right: Controls */}
      <div className="flex items-center gap-3">
        <button
          onClick={onToggleLive}
          className={`px-6 py-2.5 flex items-center gap-2 border transition-all duration-200 ${
            isLive
              ? 'bg-cyan-950/30 border-cyan-700 text-cyan-300 hover:bg-cyan-900/40 shadow-cyan-900/20 shadow-md'
              : 'bg-gray-800 border-gray-700 text-gray-300 hover:bg-gray-700'
          }`}
        >
          {isLive ? (
            <>
              <Pause className="w-5 h-5" />
              <span className="text-base font-bold">정지</span>
            </>
          ) : (
            <>
              <Play className="w-5 h-5" />
              <span className="text-base font-bold">시작</span>
            </>
          )}
        </button>

        <button
          onClick={onFreeze}
          disabled={!isLive}
          className={`px-6 py-2.5 flex items-center gap-2 border transition-all duration-200 ${
            isFrozen
              ? 'bg-yellow-950/30 border-yellow-700 text-yellow-300 shadow-yellow-900/20 shadow-md'
              : 'bg-gray-800 border-gray-700 text-gray-400 hover:bg-gray-700 hover:text-gray-300 disabled:opacity-50 disabled:cursor-not-allowed'
          }`}
        >
          <Camera className="w-5 h-5" />
          <span className="text-base font-bold">화면 정지</span>
        </button>

        <button
          onClick={onMarkEvent}
          disabled={!isLive}
          className="px-6 py-2.5 flex items-center gap-2 bg-gray-800 border border-gray-700 text-gray-400 hover:bg-gray-700 hover:text-gray-300 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <AlertCircle className="w-5 h-5" />
          <span className="text-base font-bold">마크</span>
        </button>

        <button
          onClick={onExport}
          className="px-6 py-2.5 flex items-center gap-2 bg-gray-800 border border-gray-700 text-gray-400 hover:bg-gray-700 hover:text-gray-300 transition-all duration-200"
        >
          <Download className="w-5 h-5" />
          <span className="text-base font-bold">내보내기</span>
        </button>
      </div>
    </div>
  );
}
