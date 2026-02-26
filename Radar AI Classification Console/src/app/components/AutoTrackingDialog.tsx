import { useEffect, useMemo, useState } from 'react';
import { Target, X } from 'lucide-react';
import { DetectedObject } from '../types';

type PriorityMode = 'THREAT_FIRST' | 'UAV_FIRST' | 'NEAREST_FIRST';

interface AutoTrackingDraft {
  priorityMode: PriorityMode;
  updateIntervalMs: number;
  minConfidence: number;
  reacquireSeconds: number;
  pinSelectedTrack: boolean;
}

interface AutoTrackingDialogProps {
  open: boolean;
  onClose: () => void;
  objects: DetectedObject[];
  selectedObjectId: string | null;
  enabled: boolean;
  onEnabledChange: (next: boolean) => void;
}

const DEFAULT_DRAFT: AutoTrackingDraft = {
  priorityMode: 'THREAT_FIRST',
  updateIntervalMs: 250,
  minConfidence: 60,
  reacquireSeconds: 8,
  pinSelectedTrack: true,
};

const PRIORITY_LABELS: Record<PriorityMode, string> = {
  THREAT_FIRST: '위협 우선',
  UAV_FIRST: 'UAV 우선',
  NEAREST_FIRST: '근접 우선',
};

export function AutoTrackingDialog({
  open,
  onClose,
  objects,
  selectedObjectId,
  enabled,
  onEnabledChange,
}: AutoTrackingDialogProps) {
  const [draft, setDraft] = useState<AutoTrackingDraft>(DEFAULT_DRAFT);

  useEffect(() => {
    if (!open) return;
    setDraft(DEFAULT_DRAFT);
  }, [open]);

  const selectedTrack = useMemo(
    () => objects.find((obj) => obj.id === selectedObjectId) ?? null,
    [objects, selectedObjectId]
  );

  const metrics = useMemo(() => {
    const tracking = objects.filter((obj) => obj.status === 'TRACKING' || obj.status === 'STABLE').length;
    const candidate = objects.filter((obj) => obj.status === 'CANDIDATE').length;
    const critical = objects.filter((obj) => obj.riskLevel === 'CRITICAL').length;
    const high = objects.filter((obj) => obj.riskLevel === 'HIGH').length;
    const uav = objects.filter((obj) => obj.uavDecision === 'UAV').length;
    const nearest =
      objects.length > 0 ? Math.min(...objects.map((obj) => obj.distance)).toFixed(1) : '-';
    return { tracking, candidate, critical, high, uav, nearest };
  }, [objects]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[130] flex items-center justify-center p-4">
      <button
        type="button"
        aria-label="AI 자동 추적 창 닫기 배경"
        className="absolute inset-0 bg-[#05080d]/80 backdrop-blur-[2px]"
        onClick={onClose}
      />
      <div className="argus-surface relative w-full max-w-3xl max-h-[92vh] overflow-auto rounded-lg border border-cyan-900/70 bg-[#0a1118] shadow-2xl shadow-black/70">
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-cyan-950/60 bg-[#0b141d] px-5 py-3">
          <div className="flex items-center gap-2">
            <Target className="w-4 h-4 text-cyan-300" />
            <h2 className="text-cyan-200 font-semibold tracking-wide">AI 자동 추적</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="h-8 w-8 rounded border border-cyan-900/60 text-gray-300 hover:bg-[#122131]"
          >
            <X className="w-4 h-4 mx-auto" />
          </button>
        </div>

        <div className="p-5 space-y-5">
          <section className="rounded border border-cyan-900/60 bg-[#0d1721] p-4">
            <h3 className="text-sm font-semibold text-cyan-300">자동 추적 옵션</h3>

            <div className="mt-3 flex items-center justify-between rounded border border-cyan-900/60 bg-[#09121a] px-3 py-2.5">
              <div>
                <p className="text-xs text-slate-400">AI 자동 추적 상태</p>
                <p className={`text-sm font-semibold ${enabled ? 'text-cyan-200' : 'text-slate-300'}`}>
                  {enabled ? 'ON' : 'OFF'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => onEnabledChange(!enabled)}
                className={`h-9 min-w-[92px] rounded border px-3 text-sm font-semibold transition-colors ${
                  enabled
                    ? 'border-cyan-500/70 bg-cyan-900/35 text-cyan-100 hover:bg-cyan-800/45'
                    : 'border-slate-600 bg-[#111a24] text-slate-200 hover:bg-[#1a2836]'
                }`}
              >
                {enabled ? '끄기' : '켜기'}
              </button>
            </div>

            <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3">
              <label className="text-xs text-gray-300">
                우선 순위
                <select
                  value={draft.priorityMode}
                  onChange={(event) =>
                    setDraft((prev) => ({
                      ...prev,
                      priorityMode: event.target.value as PriorityMode,
                    }))
                  }
                  className="mt-1 h-9 w-full rounded border border-cyan-900/70 bg-[#09121a] px-2 text-sm text-gray-100 focus:outline-none focus:ring-1 focus:ring-cyan-500"
                >
                  {Object.entries(PRIORITY_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="text-xs text-gray-300">
                갱신 주기 (ms)
                <select
                  value={draft.updateIntervalMs}
                  onChange={(event) =>
                    setDraft((prev) => ({
                      ...prev,
                      updateIntervalMs: Number(event.target.value),
                    }))
                  }
                  className="mt-1 h-9 w-full rounded border border-cyan-900/70 bg-[#09121a] px-2 text-sm text-gray-100 focus:outline-none focus:ring-1 focus:ring-cyan-500"
                >
                  {[100, 250, 500, 1000].map((ms) => (
                    <option key={ms} value={ms}>
                      {ms}
                    </option>
                  ))}
                </select>
              </label>

              <label className="text-xs text-gray-300">
                최소 신뢰도 (%)
                <input
                  type="number"
                  min={0}
                  max={100}
                  step={1}
                  value={draft.minConfidence}
                  onChange={(event) =>
                    setDraft((prev) => ({
                      ...prev,
                      minConfidence: Math.max(0, Math.min(100, Number(event.target.value) || 0)),
                    }))
                  }
                  className="mt-1 h-9 w-full rounded border border-cyan-900/70 bg-[#09121a] px-2 text-sm text-gray-100 focus:outline-none focus:ring-1 focus:ring-cyan-500"
                />
              </label>

              <label className="text-xs text-gray-300">
                재획득 대기 (초)
                <input
                  type="number"
                  min={1}
                  max={60}
                  step={1}
                  value={draft.reacquireSeconds}
                  onChange={(event) =>
                    setDraft((prev) => ({
                      ...prev,
                      reacquireSeconds: Math.max(1, Math.min(60, Number(event.target.value) || 1)),
                    }))
                  }
                  className="mt-1 h-9 w-full rounded border border-cyan-900/70 bg-[#09121a] px-2 text-sm text-gray-100 focus:outline-none focus:ring-1 focus:ring-cyan-500"
                />
              </label>
            </div>

            <label className="mt-3 inline-flex items-center gap-2 text-xs text-gray-300">
              <input
                type="checkbox"
                checked={draft.pinSelectedTrack}
                onChange={(event) =>
                  setDraft((prev) => ({
                    ...prev,
                    pinSelectedTrack: event.target.checked,
                  }))
                }
                className="h-4 w-4 accent-cyan-500"
              />
              선택된 트랙 우선 유지
            </label>
          </section>

          <section className="rounded border border-cyan-900/60 bg-[#0d1721] p-4">
            <h3 className="text-sm font-semibold text-cyan-300">추적 정보</h3>
            <div className="mt-3 grid grid-cols-2 md:grid-cols-3 gap-2">
              <div className="rounded border border-cyan-900/60 bg-[#09121a] px-3 py-2">
                <p className="text-[11px] text-slate-500">활성 추적</p>
                <p className="text-lg font-semibold text-slate-100 tabular-nums">{metrics.tracking}</p>
              </div>
              <div className="rounded border border-cyan-900/60 bg-[#09121a] px-3 py-2">
                <p className="text-[11px] text-slate-500">후보 추적군</p>
                <p className="text-lg font-semibold text-slate-100 tabular-nums">{metrics.candidate}</p>
              </div>
              <div className="rounded border border-red-900/60 bg-red-950/20 px-3 py-2">
                <p className="text-[11px] text-red-200/70">치명/고위험</p>
                <p className="text-lg font-semibold text-red-200 tabular-nums">
                  {metrics.critical}/{metrics.high}
                </p>
              </div>
              <div className="rounded border border-amber-900/60 bg-amber-950/20 px-3 py-2">
                <p className="text-[11px] text-amber-200/70">UAV 판정</p>
                <p className="text-lg font-semibold text-amber-100 tabular-nums">{metrics.uav}</p>
              </div>
              <div className="rounded border border-cyan-900/60 bg-[#09121a] px-3 py-2">
                <p className="text-[11px] text-slate-500">최근접 거리 (m)</p>
                <p className="text-lg font-semibold text-slate-100 tabular-nums">{metrics.nearest}</p>
              </div>
              <div className="rounded border border-cyan-900/60 bg-[#09121a] px-3 py-2">
                <p className="text-[11px] text-slate-500">현재 선택 트랙</p>
                <p className="text-sm font-semibold text-cyan-200 truncate">
                  {selectedTrack?.id ?? '선택 없음'}
                </p>
              </div>
            </div>
          </section>
        </div>

        <div className="sticky bottom-0 z-10 flex items-center justify-end gap-2 border-t border-cyan-950/60 bg-[#0b141d] px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            className="h-9 px-3 rounded border border-gray-700 bg-[#111a24] text-gray-200 text-sm font-semibold hover:bg-[#182838]"
          >
            닫기
          </button>
        </div>
      </div>
    </div>
  );
}
