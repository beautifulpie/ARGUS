import { useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react';
import { DetectedObject } from '../types';

interface ObjectListTableProps {
  objects: DetectedObject[];
  selectedObjectId: string | null;
  onSelectObject: (id: string) => void;
}

type SortField =
  | 'riskLevel'
  | 'uavProbability'
  | 'id'
  | 'class'
  | 'distance'
  | 'speed'
  | 'confidence'
  | 'status';
type SortDirection = 'asc' | 'desc';

const CLASS_NAMES_KR: Record<string, string> = {
  HELICOPTER: '헬기',
  UAV: '무인기',
  HIGHSPEED: '고속기',
  BIRD_FLOCK: '새떼',
  BIRD: '새',
  CIVIL_AIR: '민간기',
  FIGHTER: '전투기',
};

const STATUS_NAMES_KR: Record<string, string> = {
  STABLE: '안정',
  NEW: '신규',
  LOST: '손실',
  TRACKING: '추적',
  CANDIDATE: '후보',
};

const RISK_NAMES_KR: Record<string, string> = {
  LOW: '낮음',
  MEDIUM: '중간',
  HIGH: '높음',
  CRITICAL: '치명',
};

const RISK_ORDER: Record<string, number> = {
  LOW: 1,
  MEDIUM: 2,
  HIGH: 3,
  CRITICAL: 4,
};

const STATUS_ORDER: Record<string, number> = {
  LOST: 0,
  CANDIDATE: 1,
  NEW: 2,
  TRACKING: 3,
  STABLE: 4,
};

export function ObjectListTable({ objects, selectedObjectId, onSelectObject }: ObjectListTableProps) {
  const [sortField, setSortField] = useState<SortField>('riskLevel');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection(field === 'riskLevel' ? 'desc' : 'asc');
    }
  };

  const sortedObjects = useMemo(() => {
    return [...objects].sort((a, b) => {
      let aVal: string | number;
      let bVal: string | number;

      switch (sortField) {
        case 'riskLevel':
          aVal = RISK_ORDER[a.riskLevel] ?? 0;
          bVal = RISK_ORDER[b.riskLevel] ?? 0;
          break;
        case 'uavProbability':
          aVal = a.uavProbability ?? 0;
          bVal = b.uavProbability ?? 0;
          break;
        case 'id':
          aVal = a.id;
          bVal = b.id;
          break;
        case 'class':
          aVal = a.class;
          bVal = b.class;
          break;
        case 'distance':
          aVal = a.distance;
          bVal = b.distance;
          break;
        case 'speed':
          aVal = a.speed;
          bVal = b.speed;
          break;
        case 'confidence':
          aVal = a.confidence;
          bVal = b.confidence;
          break;
        case 'status':
          aVal = STATUS_ORDER[a.status] ?? 0;
          bVal = STATUS_ORDER[b.status] ?? 0;
          break;
        default:
          aVal = a.id;
          bVal = b.id;
      }

      if (typeof aVal === 'string' && typeof bVal === 'string') {
        return sortDirection === 'asc' ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
      }

      return sortDirection === 'asc'
        ? (aVal as number) - (bVal as number)
        : (bVal as number) - (aVal as number);
    });
  }, [objects, sortField, sortDirection]);

  const SortIcon = ({ field }: { field: SortField }) => {
    if (sortField !== field) {
      return <ArrowUpDown className="w-3 h-3 text-slate-500" />;
    }
    return sortDirection === 'asc' ? (
      <ArrowUp className="w-3 h-3 text-cyan-300" />
    ) : (
      <ArrowDown className="w-3 h-3 text-cyan-300" />
    );
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'NEW':
        return 'border-slate-500/70 bg-slate-800/70 text-slate-100';
      case 'LOST':
        return 'border-slate-600/70 bg-slate-900/70 text-slate-300';
      case 'TRACKING':
        return 'border-slate-600/70 bg-slate-900/65 text-slate-200';
      case 'CANDIDATE':
        return 'border-slate-600/70 bg-slate-900/65 text-slate-200';
      case 'STABLE':
      default:
        return 'border-slate-600/70 bg-slate-900/60 text-slate-200';
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

  const getRiskBadge = (riskLevel: string): { label: string; className: string } => {
    switch (riskLevel) {
      case 'CRITICAL':
        return {
          label: RISK_NAMES_KR.CRITICAL,
          className: 'border-2 border-red-500 bg-red-950/45 text-red-100 font-bold',
        };
      case 'HIGH':
        return {
          label: RISK_NAMES_KR.HIGH,
          className: 'border border-red-600/70 bg-red-950/30 text-red-200',
        };
      case 'MEDIUM':
        return {
          label: RISK_NAMES_KR.MEDIUM,
          className: 'border border-orange-600/70 bg-orange-950/30 text-orange-200',
        };
      case 'LOW':
      default:
        return {
          label: RISK_NAMES_KR.LOW,
          className: 'border border-slate-600/70 bg-slate-900/70 text-slate-200',
        };
    }
  };

  return (
    <div className="argus-surface h-full bg-[#0b1016] border-b border-cyan-950/50 flex flex-col relative overflow-hidden">
      <div className="absolute top-4 left-6 w-4 h-4 border-l-2 border-t-2 border-cyan-500/35 z-10" />
      <div className="absolute top-4 right-6 w-4 h-4 border-r-2 border-t-2 border-cyan-500/35 z-10" />

      <div className="px-6 py-4 border-b border-cyan-950/50">
        <h2 className="text-2xl font-bold text-cyan-300 uppercase tracking-[0.08em]">추적된 객체</h2>
        <p className="text-sm text-slate-500 mt-1">{objects.length} 활성</p>
      </div>

      <div className="flex-1 overflow-auto">
        <table className="w-full text-[13px] leading-[1.35]">
          <thead className="sticky top-0 z-10 bg-[#0f161f]/95 backdrop-blur border-b border-slate-700/70">
            <tr className="text-slate-400 uppercase tracking-[0.08em]">
              <th className="px-4 py-3.5 text-left font-semibold whitespace-nowrap">
                <button
                  onClick={() => handleSort('riskLevel')}
                  className="flex items-center gap-1.5 hover:text-cyan-300 transition-colors"
                >
                  위험
                  <SortIcon field="riskLevel" />
                </button>
              </th>
              <th className="px-4 py-3.5 text-left font-semibold whitespace-nowrap">
                <button
                  onClick={() => handleSort('uavProbability')}
                  className="flex items-center gap-1.5 hover:text-cyan-300 transition-colors"
                >
                  UAV 판정
                  <SortIcon field="uavProbability" />
                </button>
              </th>
              <th className="px-4 py-3.5 text-left font-semibold whitespace-nowrap">
                <button
                  onClick={() => handleSort('id')}
                  className="flex items-center gap-1.5 hover:text-cyan-300 transition-colors"
                >
                  ID
                  <SortIcon field="id" />
                </button>
              </th>
              <th className="px-4 py-3.5 text-left font-semibold whitespace-nowrap">
                <button
                  onClick={() => handleSort('class')}
                  className="flex items-center gap-1.5 hover:text-cyan-300 transition-colors"
                >
                  클래스
                  <SortIcon field="class" />
                </button>
              </th>
              <th className="px-4 py-3.5 text-right font-semibold whitespace-nowrap">
                <button
                  onClick={() => handleSort('distance')}
                  className="flex items-center gap-1.5 hover:text-cyan-300 transition-colors ml-auto"
                >
                  거리 (m)
                  <SortIcon field="distance" />
                </button>
              </th>
              <th className="px-4 py-3.5 text-right font-semibold whitespace-nowrap">
                <button
                  onClick={() => handleSort('speed')}
                  className="flex items-center gap-1.5 hover:text-cyan-300 transition-colors ml-auto"
                >
                  속도 (m/s)
                  <SortIcon field="speed" />
                </button>
              </th>
              <th className="px-4 py-3.5 text-right font-semibold whitespace-nowrap">
                <button
                  onClick={() => handleSort('confidence')}
                  className="flex items-center gap-1.5 hover:text-cyan-300 transition-colors ml-auto"
                >
                  신뢰도 (%)
                  <SortIcon field="confidence" />
                </button>
              </th>
              <th className="px-4 py-3.5 text-right font-semibold whitespace-nowrap">크기 (m)</th>
              <th className="px-4 py-3.5 text-left font-semibold whitespace-nowrap">
                <button
                  onClick={() => handleSort('status')}
                  className="flex items-center gap-1.5 hover:text-cyan-300 transition-colors"
                >
                  상태
                  <SortIcon field="status" />
                </button>
              </th>
            </tr>
          </thead>
          <tbody>
            {sortedObjects.map((obj, index) => {
              const riskBadge = getRiskBadge(obj.riskLevel);
              const zebraClass = index % 2 === 0 ? 'bg-[#0c1219]' : 'bg-[#0a0f15]';

              return (
                <tr
                  key={obj.id}
                  onClick={() => onSelectObject(obj.id)}
                  className={`argus-object-row border-b border-slate-800/70 cursor-pointer transition-colors duration-150 ${zebraClass} ${
                    obj.id === selectedObjectId
                      ? 'bg-cyan-950/30 ring-1 ring-inset ring-cyan-500/45'
                      : 'hover:bg-slate-800/60'
                  }`}
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
                  <td className="px-4 py-3.5 text-right">
                    <span className="font-mono tabular-nums text-slate-300 text-xs">
                      {obj.size.length.toFixed(1)} x {obj.size.width.toFixed(1)}
                    </span>
                  </td>
                  <td className="px-4 py-3.5">
                    <span
                      className={`inline-flex items-center px-2.5 py-1 border rounded-sm text-xs font-semibold uppercase tracking-[0.06em] whitespace-nowrap ${getStatusBadge(obj.status)}`}
                    >
                      {STATUS_NAMES_KR[obj.status] ?? obj.status}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {objects.length === 0 && (
          <div className="flex items-center justify-center h-36">
            <p className="text-base text-slate-500">감지된 객체 없음</p>
          </div>
        )}
      </div>
    </div>
  );
}
