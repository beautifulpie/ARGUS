import { DetectedObject } from '../types';
import { Radio } from 'lucide-react';

interface CandidateTracksPanelProps {
  objects: DetectedObject[];
  onSelectObject: (id: string) => void;
}

const CLASS_NAMES_KR: Record<string, string> = {
  HELICOPTER: '헬기',
  UAV: '무인기',
  HIGHSPEED: '고속기',
  BIRD_FLOCK: '새떼',
  BIRD: '새',
  CIVIL_AIR: '민간기',
  FIGHTER: '전투기',
};

export function CandidateTracksPanel({ objects, onSelectObject }: CandidateTracksPanelProps) {
  const candidates = objects.filter((obj) => obj.status === 'CANDIDATE');

  const getRiskBadge = (riskLevel: string): { label: string; className: string } => {
    switch (riskLevel) {
      case 'CRITICAL':
        return {
          label: '치명',
          className: 'border-2 border-red-500 bg-red-950/45 text-red-100 font-bold',
        };
      case 'HIGH':
        return {
          label: '높음',
          className: 'border border-red-600/70 bg-red-950/30 text-red-200',
        };
      case 'MEDIUM':
        return {
          label: '중간',
          className: 'border border-orange-600/70 bg-orange-950/30 text-orange-200',
        };
      case 'LOW':
      default:
        return {
          label: '낮음',
          className: 'border border-slate-600/70 bg-slate-900/70 text-slate-200',
        };
    }
  };

  const getUavBadge = (decision?: string) => {
    switch (decision) {
      case 'UAV':
        return 'border-red-700/70 bg-red-950/45 text-red-200';
      case 'NON_UAV':
        return 'border-sky-700/60 bg-sky-950/30 text-sky-200';
      default:
        return 'border-amber-700/55 bg-amber-950/30 text-amber-200';
    }
  };

  return (
    <div className="argus-surface flex flex-col h-full bg-[#0b1016] border-t border-cyan-950/50">
      <div className="px-6 py-[18px] border-b border-cyan-950/50 flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-amber-400 uppercase tracking-[0.08em] flex items-center gap-2">
            <Radio className="w-5 h-5" />
            후보 추적군
          </h2>
          <p className="text-xs text-slate-500 mt-1">신호 손실 / 예측 추적 중</p>
        </div>
        <span className="candidate-active-chip inline-flex items-center border border-amber-700/60 bg-amber-950/35 text-amber-200 text-xs px-2.5 py-1 rounded font-semibold tabular-nums">
          {candidates.length} ACTIVE
        </span>
      </div>

      <div className="flex-1 overflow-auto">
        {candidates.length === 0 ? (
          <div className="flex items-center justify-center h-36">
            <p className="text-base text-slate-500">현재 후보 추적군 없음</p>
          </div>
        ) : (
          <table className="w-full text-[13px] leading-[1.35]">
            <thead className="sticky top-0 z-10 bg-[#0f161f]/95 backdrop-blur border-b border-slate-700/70">
              <tr className="text-slate-400 uppercase tracking-[0.08em]">
                <th className="px-4 py-3.5 text-left font-semibold whitespace-nowrap">위험</th>
                <th className="px-4 py-3.5 text-left font-semibold whitespace-nowrap">UAV 판정</th>
                <th className="px-4 py-3.5 text-left font-semibold whitespace-nowrap">ID</th>
                <th className="px-4 py-3.5 text-left font-semibold whitespace-nowrap">클래스</th>
                <th className="px-4 py-3.5 text-right font-semibold whitespace-nowrap">거리 (m)</th>
                <th className="px-4 py-3.5 text-right font-semibold whitespace-nowrap">속도 (m/s)</th>
                <th className="px-4 py-3.5 text-right font-semibold whitespace-nowrap">신뢰도 (%)</th>
                <th className="px-4 py-3.5 text-left font-semibold whitespace-nowrap">상태</th>
              </tr>
            </thead>
            <tbody>
              {candidates.map((obj, index) => {
                const riskBadge = getRiskBadge(obj.riskLevel);
                const zebraClass = index % 2 === 0 ? 'bg-[#0c1219]' : 'bg-[#0a0f15]';

                return (
                  <tr
                    key={obj.id}
                    onClick={() => onSelectObject(obj.id)}
                    className={`argus-object-row border-b border-slate-800/70 cursor-pointer transition-colors duration-150 ${zebraClass} hover:bg-slate-800/60`}
                  >
                    <td className="px-4 py-3.5">
                      <span
                        className={`inline-flex items-center px-2.5 py-1 border rounded-sm text-xs font-semibold whitespace-nowrap ${riskBadge.className}`}
                      >
                        {riskBadge.label}
                      </span>
                    </td>
                    <td className="px-4 py-3.5">
                      <div className="flex items-center gap-2">
                        <span
                          className={`inline-flex items-center px-2.5 py-1 border rounded-sm text-xs font-semibold whitespace-nowrap ${getUavBadge(obj.uavDecision)}`}
                        >
                          {obj.uavDecision === 'UAV'
                            ? 'UAV'
                            : obj.uavDecision === 'NON_UAV'
                              ? 'NON-UAV'
                              : 'UNKNOWN'}
                        </span>
                        <span className="text-xs font-mono tabular-nums text-slate-400">
                          {(obj.uavProbability ?? 0).toFixed(1)}
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-3.5">
                      <span className="font-mono tabular-nums text-slate-100">{obj.id}</span>
                    </td>
                    <td className="px-4 py-3.5 text-slate-200">{CLASS_NAMES_KR[obj.class] ?? obj.class}</td>
                    <td className="px-4 py-3.5 text-right">
                      <span className="font-mono tabular-nums text-slate-200">{obj.distance.toFixed(1)}</span>
                    </td>
                    <td className="px-4 py-3.5 text-right">
                      <span className="font-mono tabular-nums text-slate-200">{obj.speed.toFixed(1)}</span>
                    </td>
                    <td className="px-4 py-3.5 text-right">
                      <span className="font-mono tabular-nums text-slate-200">{obj.confidence.toFixed(1)}</span>
                    </td>
                    <td className="px-4 py-3.5">
                      <span className="inline-flex items-center px-2.5 py-1 border rounded-sm text-xs font-semibold uppercase tracking-[0.06em] whitespace-nowrap border-amber-700/60 bg-amber-950/35 text-amber-200">
                        후보
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
