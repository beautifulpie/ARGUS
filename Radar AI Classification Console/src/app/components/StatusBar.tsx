import {
  Activity,
  Play,
  Pause,
  Camera,
  Download,
  AlertCircle,
  Cpu,
  MemoryStick,
  Layers,
  SlidersHorizontal,
} from 'lucide-react';
import { type ReactNode } from 'react';
import { SystemStatus } from '../types';

interface StatusBarProps {
  status: SystemStatus;
  threatCount: number;
  isLive: boolean;
  isFrozen: boolean;
  onToggleLive: () => void;
  onFreeze: () => void;
  onMarkEvent: () => void;
  onExport: () => void;
  onOpenSettings: () => void;
}

interface MetricItemProps {
  label: string;
  value: string;
  valueClassName?: string;
  icon?: ReactNode;
  strong?: boolean;
  widthClassName?: string;
}

function MetricItem({
  label,
  value,
  valueClassName,
  icon,
  strong = false,
  widthClassName = 'w-[102px]',
}: MetricItemProps) {
  return (
    <div
      className={`flex shrink-0 items-center gap-2 whitespace-nowrap rounded border border-slate-800/90 bg-[#0c131c] px-2.5 py-1.5 ${widthClassName}`}
    >
      {icon}
      <div className="flex min-w-0 flex-1 flex-col items-end leading-tight">
        <span className="text-[10px] text-slate-500 font-semibold uppercase tracking-[0.12em]">{label}</span>
        <span
          className={`font-mono tabular-nums whitespace-nowrap ${strong ? 'text-lg font-bold' : 'text-base font-semibold'} ${valueClassName || 'text-slate-100'}`}
        >
          {value}
        </span>
      </div>
    </div>
  );
}

function StatusChip({ label, className }: { label: string; className: string }) {
  return (
    <span className={`inline-flex h-7 items-center rounded border px-2.5 text-[11px] font-semibold uppercase tracking-[0.12em] ${className}`}>
      {label}
    </span>
  );
}

export function StatusBar({
  status,
  threatCount,
  isLive,
  isFrozen,
  onToggleLive,
  onFreeze,
  onMarkEvent,
  onExport,
  onOpenSettings,
}: StatusBarProps) {
  const getStatusChipClass = () => {
    switch (status.connectionStatus) {
      case 'LIVE':
        return 'border-cyan-500/40 bg-cyan-950/40 text-cyan-200';
      case 'REPLAY':
        return 'border-amber-500/40 bg-amber-950/40 text-amber-200';
      case 'DISCONNECTED':
        return 'border-red-500/50 bg-red-950/45 text-red-200';
    }
  };

  const getConnectionStatusText = (connectionStatus: string) => {
    switch (connectionStatus) {
      case 'LIVE':
        return '실시간';
      case 'REPLAY':
        return '재생';
      case 'DISCONNECTED':
        return '연결 끊김';
      default:
        return connectionStatus;
    }
  };

  const getSensorStatusText = (sensorStatus: string) => {
    switch (sensorStatus) {
      case 'ONLINE':
        return '온라인';
      case 'DEGRADED':
        return '성능 저하';
      case 'OFFLINE':
        return '오프라인';
      default:
        return sensorStatus;
    }
  };

  const getSensorChipClass = (sensorStatus: string) => {
    switch (sensorStatus) {
      case 'ONLINE':
        return 'border-emerald-500/40 bg-emerald-950/35 text-emerald-200';
      case 'DEGRADED':
        return 'border-amber-500/45 bg-amber-950/35 text-amber-200';
      case 'OFFLINE':
        return 'border-red-500/50 bg-red-950/45 text-red-200';
      default:
        return 'border-slate-600 bg-slate-900 text-slate-200';
    }
  };

  const getUsageColor = (usage: number) => {
    if (usage < 45) return 'text-slate-200';
    if (usage < 70) return 'text-slate-100';
    if (usage < 85) return 'text-sky-300';
    return 'text-cyan-300';
  };

  const formatMetric = (value?: number, unit = '') => {
    if (typeof value !== 'number' || Number.isNaN(value) || value <= 0) {
      return '-';
    }
    return `${value.toFixed(1)}${unit ? ` ${unit}` : ''}`;
  };

  const buttonBase =
    'h-10 shrink-0 px-3 flex items-center gap-2 border text-sm font-semibold whitespace-nowrap transition-all duration-200';

  return (
    <div className="argus-surface bg-[#0a0d12] border-b border-cyan-950/50 px-4 py-3 shadow-lg shadow-black/40">
      <div className="grid gap-3 xl:grid-cols-[minmax(300px,1fr)_minmax(0,1.35fr)_minmax(430px,auto)]">
        <section className="rounded border border-cyan-950/60 bg-[#0c1219] px-4 py-3">
          <p className="text-[10px] uppercase tracking-[0.14em] text-slate-500 mb-2">System Status</p>
          <div className="flex items-start gap-3">
            <Activity className="w-6 h-6 text-cyan-300 shrink-0 mt-1" strokeWidth={2.3} />
            <div className="min-w-0 flex-1 flex items-start gap-4">
              <h1 className="text-[3.2rem] leading-[0.88] font-black tracking-[0.08em] text-slate-100 uppercase whitespace-nowrap">
                ARGUS
              </h1>
              <div className="min-w-0 flex-1 space-y-1 pt-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <StatusChip
                    label={getConnectionStatusText(status.connectionStatus)}
                    className={getStatusChipClass()}
                  />
                  <StatusChip
                    label={getSensorStatusText(status.sensorStatus)}
                    className={getSensorChipClass(status.sensorStatus)}
                  />
                </div>
                <p className="text-xs text-slate-300/85 truncate">
                  무인 항공기 감시 공중 레이더 기반 경비 시스템
                </p>
                <p className="text-xs text-slate-500 truncate">
                  모델 {status.modelName} {status.modelVersion}
                </p>
              </div>
            </div>
          </div>
        </section>

        <section className="rounded border border-cyan-950/60 bg-[#0c1219] px-3 py-3 min-w-0">
          <p className="text-[10px] uppercase tracking-[0.14em] text-slate-500 mb-2 px-1">Performance</p>
          <div className="overflow-x-auto">
            <div className="flex min-w-max items-center gap-2 pr-2">
              <MetricItem label="추적" value={String(status.trackedObjects)} widthClassName="w-[84px]" />
              <MetricItem
                label="위협"
                value={String(threatCount)}
                valueClassName={threatCount > 0 ? 'text-red-300' : 'text-slate-100'}
                strong
                widthClassName="w-[84px]"
              />
              <MetricItem
                label="지연 (ms)"
                value={formatMetric(status.latency, '')}
                valueClassName="text-cyan-200"
                strong
                widthClassName="w-[96px]"
              />
              <MetricItem
                label="FPS"
                value={(status.measuredFps ?? status.fps).toFixed(1)}
                valueClassName="text-cyan-200"
                strong
                widthClassName="w-[90px]"
              />
              <MetricItem
                label="모델 응답"
                value={formatMetric(status.modelLatencyP95 ?? status.inferenceLatencyP95, 'ms')}
                valueClassName="text-slate-100"
                widthClassName="w-[122px]"
              />
              <MetricItem
                label="파이프 응답"
                value={formatMetric(status.pipelineLatencyP95, 'ms')}
                valueClassName="text-slate-100"
                widthClassName="w-[122px]"
              />
              <MetricItem
                label="CPU"
                value={`${status.cpuUsage.toFixed(0)}%`}
                valueClassName={getUsageColor(status.cpuUsage)}
                icon={<Cpu className="w-4 h-4 text-slate-500" />}
                widthClassName="w-[92px]"
              />
              <MetricItem
                label="GPU"
                value={`${status.gpuUsage.toFixed(0)}%`}
                valueClassName={getUsageColor(status.gpuUsage)}
                icon={<Layers className="w-4 h-4 text-slate-500" />}
                widthClassName="w-[92px]"
              />
              <MetricItem
                label="RAM"
                value={`${status.ramUsage.toFixed(0)}%`}
                valueClassName={getUsageColor(status.ramUsage)}
                icon={<MemoryStick className="w-4 h-4 text-slate-500" />}
                widthClassName="w-[92px]"
              />
            </div>
          </div>
        </section>

        <section className="rounded border border-cyan-950/60 bg-[#0c1219] px-3 py-3 min-w-[430px]">
          <p className="text-[10px] uppercase tracking-[0.14em] text-slate-500 mb-2">Controls</p>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <button
              onClick={onOpenSettings}
              className={`${buttonBase} bg-[#111a24] border-slate-700 text-slate-200 hover:bg-[#1a2836] hover:text-white`}
            >
              <SlidersHorizontal className="w-4 h-4" />
              <span>설정</span>
            </button>

            <button
              onClick={onToggleLive}
              className={`${buttonBase} ${
                isLive
                  ? 'bg-cyan-900/35 border-cyan-600/70 text-cyan-100 hover:bg-cyan-800/45'
                  : 'bg-[#111a24] border-slate-700 text-slate-200 hover:bg-[#1a2836] hover:text-white'
              }`}
            >
              {isLive ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
              <span>{isLive ? '정지' : '시작'}</span>
            </button>

            <button
              onClick={onFreeze}
              disabled={!isLive}
              className={`${buttonBase} ${
                isFrozen
                  ? 'bg-slate-700/50 border-slate-500 text-slate-50'
                  : 'bg-[#111a24] border-slate-700 text-slate-300 hover:bg-[#1a2836] hover:text-white disabled:opacity-50 disabled:cursor-not-allowed'
              }`}
            >
              <Camera className="w-4 h-4" />
              <span>화면 정지</span>
            </button>

            <button
              onClick={onMarkEvent}
              disabled={!isLive}
              className={`${buttonBase} bg-[#111a24] border-slate-700 text-slate-300 hover:bg-[#1a2836] hover:text-white disabled:opacity-50 disabled:cursor-not-allowed`}
            >
              <AlertCircle className="w-4 h-4" />
              <span>마크</span>
            </button>

            <button
              onClick={onExport}
              className={`${buttonBase} bg-[#111a24] border-slate-700 text-slate-300 hover:bg-[#1a2836] hover:text-white`}
            >
              <Download className="w-4 h-4" />
              <span>내보내기</span>
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}
