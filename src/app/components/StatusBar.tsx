import {
  Play,
  Pause,
  Camera,
  Download,
  FileText,
  AlertCircle,
  Cpu,
  MemoryStick,
  Layers,
  SlidersHorizontal,
  Target,
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
  onOpenAutoTracking: () => void;
  onOpenLogViewer: () => void;
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
      className={`argus-metric-item h-[54px] flex shrink-0 items-center gap-2 whitespace-nowrap rounded border border-slate-800/90 bg-[#0c131c] px-2.5 py-1.5 ${widthClassName}`}
    >
      {icon}
      <div className="flex h-full min-w-0 flex-1 flex-col items-end justify-between">
        <span className="text-[10px] text-slate-500 font-semibold uppercase tracking-[0.12em]">{label}</span>
        <span
          className={`argus-metric-value font-mono tabular-nums whitespace-nowrap leading-none ${strong ? 'argus-metric-value-strong text-lg font-bold' : 'text-base font-semibold'} ${valueClassName || 'text-slate-100'}`}
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
  onOpenAutoTracking,
  onOpenLogViewer,
}: StatusBarProps) {
  const displayedFps = Math.max(0, (status.measuredFps ?? status.fps) * 10);

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
    'argus-control-button h-10 shrink-0 px-3 w-full flex items-center justify-center gap-2 border text-sm font-semibold whitespace-nowrap transition-all duration-200';

  return (
    <div className="argus-surface argus-statusbar bg-[#0a0d12] border-b border-cyan-950/50 px-4 py-2 shadow-lg shadow-black/40">
      <div className="grid gap-3 xl:grid-cols-[minmax(280px,0.95fr)_minmax(0,1.55fr)_minmax(360px,1.05fr)]">
        <section className="argus-status-card rounded border border-cyan-950/60 bg-[#0c1219] px-4 py-2.5">
          <p className="text-[10px] uppercase tracking-[0.14em] text-slate-500 mb-1.5">System Status</p>
          <div className="flex items-start gap-3">
            <div className="argus-brand-logo-frame h-[76px] w-[92px] shrink-0 overflow-hidden rounded border border-cyan-900/60 bg-[#08111a] shadow-[0_0_18px_rgba(34,211,238,0.15)]">
              <img
                src="/argus-logo.png"
                alt="ARGUS 로고"
                className="h-full w-full object-cover"
                draggable={false}
              />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h1 className="argus-brand-title text-[2.92rem] leading-[0.9] font-black tracking-[0.08em] text-slate-100 uppercase whitespace-nowrap">
                    ARGUS
                  </h1>
                  <p className="mt-0.5 text-[11px] leading-4 text-slate-300/85 break-keep">
                    무인항공기 감시 공중 레이더 기반 경비 시스템
                  </p>
                </div>
                <div className="mt-0.5 flex shrink-0 items-center gap-2">
                  <StatusChip
                    label={getConnectionStatusText(status.connectionStatus)}
                    className={getStatusChipClass()}
                  />
                  <StatusChip
                    label={getSensorStatusText(status.sensorStatus)}
                    className={getSensorChipClass(status.sensorStatus)}
                  />
                </div>
              </div>
              <p className="mt-1 text-[11px] text-slate-500 truncate">
                모델 {status.modelName} {status.modelVersion}
              </p>
            </div>
          </div>
        </section>

        <section className="argus-status-card rounded border border-cyan-950/60 bg-[#0c1219] px-3 py-2.5 min-w-0">
          <p className="text-[10px] uppercase tracking-[0.14em] text-slate-500 mb-1.5 px-1">Performance</p>
          <div className="overflow-hidden">
            <div className="argus-performance-layout">
              <div className="argus-performance-primary">
                <MetricItem label="추적" value={String(status.trackedObjects)} widthClassName="w-[78px]" />
                <MetricItem
                  label="위협"
                  value={String(threatCount)}
                  valueClassName={threatCount > 0 ? 'text-red-300' : 'text-slate-100'}
                  strong
                  widthClassName="w-[78px]"
                />
                <MetricItem
                  label="지연 (ms)"
                  value={formatMetric(status.latency, '')}
                  valueClassName="text-cyan-200"
                  strong
                  widthClassName="w-[90px]"
                />
                <MetricItem
                  label="FPS"
                  value={displayedFps.toFixed(1)}
                  valueClassName="text-cyan-200"
                  strong
                  widthClassName="w-[82px]"
                />
                <MetricItem
                  label="모델 응답"
                  value={formatMetric(status.modelLatencyP95 ?? status.inferenceLatencyP95, 'ms')}
                  valueClassName="text-slate-100"
                  widthClassName="w-[108px]"
                />
              </div>
              <div className="argus-performance-resources">
                <MetricItem
                  label="CPU"
                  value={`${status.cpuUsage.toFixed(0)}%`}
                  valueClassName={getUsageColor(status.cpuUsage)}
                  icon={<Cpu className="w-4 h-4 text-slate-500" />}
                  widthClassName="w-[82px]"
                />
                <MetricItem
                  label="GPU"
                  value={`${status.gpuUsage.toFixed(0)}%`}
                  valueClassName={getUsageColor(status.gpuUsage)}
                  icon={<Layers className="w-4 h-4 text-slate-500" />}
                  widthClassName="w-[82px]"
                />
                <MetricItem
                  label="RAM"
                  value={`${status.ramUsage.toFixed(0)}%`}
                  valueClassName={getUsageColor(status.ramUsage)}
                  icon={<MemoryStick className="w-4 h-4 text-slate-500" />}
                  widthClassName="w-[82px]"
                />
              </div>
            </div>
          </div>
        </section>

        <section className="argus-status-card rounded border border-cyan-950/60 bg-[#0c1219] px-3 py-2.5 min-w-[360px]">
          <p className="text-[10px] uppercase tracking-[0.14em] text-slate-500 mb-1.5">Controls</p>
          <div className="argus-controls-grid grid grid-cols-4 gap-2">
            <button
              onClick={onOpenSettings}
              className={`${buttonBase} bg-[#111a24] border-slate-700 text-slate-200 hover:bg-[#1a2836] hover:text-white`}
            >
              <SlidersHorizontal className="w-4 h-4" />
              <span>설정</span>
            </button>

            <button
              onClick={onOpenAutoTracking}
              className={`${buttonBase} argus-auto-track-button bg-cyan-900/20 border-cyan-700/55 text-cyan-100 hover:bg-cyan-800/35`}
            >
              <Target className="w-4 h-4" />
              <span>AI 자동 추적</span>
            </button>

            <button
              onClick={onOpenLogViewer}
              className={`${buttonBase} bg-[#111a24] border-slate-700 text-slate-200 hover:bg-[#1a2836] hover:text-white`}
            >
              <FileText className="w-4 h-4" />
              <span>로그 분석</span>
            </button>

            <button
              onClick={onToggleLive}
              className={`${buttonBase} argus-live-toggle-button ${
                isLive
                  ? 'argus-live-toggle-button-active bg-cyan-900/35 border-cyan-600/70 text-cyan-100 hover:bg-cyan-800/45'
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
