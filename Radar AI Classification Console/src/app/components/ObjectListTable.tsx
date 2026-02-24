import { useState, useMemo } from 'react';
import { ArrowUpDown, ArrowUp, ArrowDown } from 'lucide-react';
import { DetectedObject } from '../types';

interface ObjectListTableProps {
  objects: DetectedObject[];
  selectedObjectId: string | null;
  onSelectObject: (id: string) => void;
}

type SortField = 'id' | 'class' | 'confidence' | 'speed' | 'distance' | 'status';
type ExtendedSortField = SortField | 'uavProbability';
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

export function ObjectListTable({ objects, selectedObjectId, onSelectObject }: ObjectListTableProps) {
  const [sortField, setSortField] = useState<ExtendedSortField>('distance');
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc');

  const handleSort = (field: ExtendedSortField) => {
    if (sortField === field) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
  };

  const sortedObjects = useMemo(() => {
    return [...objects].sort((a, b) => {
      let aVal: string | number;
      let bVal: string | number;

      switch (sortField) {
        case 'id':
          aVal = a.id;
          bVal = b.id;
          break;
        case 'class':
          aVal = a.class;
          bVal = b.class;
          break;
        case 'confidence':
          aVal = a.confidence;
          bVal = b.confidence;
          break;
        case 'speed':
          aVal = a.speed;
          bVal = b.speed;
          break;
        case 'distance':
          aVal = a.distance;
          bVal = b.distance;
          break;
        case 'status':
          aVal = a.status;
          bVal = b.status;
          break;
        case 'uavProbability':
          aVal = a.uavProbability ?? 0;
          bVal = b.uavProbability ?? 0;
          break;
        default:
          aVal = a.id;
          bVal = b.id;
      }

      if (typeof aVal === 'string' && typeof bVal === 'string') {
        return sortDirection === 'asc' 
          ? aVal.localeCompare(bVal)
          : bVal.localeCompare(aVal);
      }

      return sortDirection === 'asc' 
        ? (aVal as number) - (bVal as number)
        : (bVal as number) - (aVal as number);
    });
  }, [objects, sortField, sortDirection]);

  const SortIcon = ({ field }: { field: ExtendedSortField }) => {
    if (sortField !== field) {
      return <ArrowUpDown className="w-3 h-3 text-gray-600" />;
    }
    return sortDirection === 'asc' 
      ? <ArrowUp className="w-3 h-3 text-cyan-400" />
      : <ArrowDown className="w-3 h-3 text-cyan-400" />;
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'NEW':
        return 'bg-green-950/30 text-green-400 border-green-700/30';
      case 'LOST':
        return 'bg-red-950/30 text-red-400 border-red-700/30';
      case 'STABLE':
        return 'bg-cyan-950/30 text-cyan-400 border-cyan-700/30';
      case 'TRACKING':
        return 'bg-blue-950/30 text-blue-400 border-blue-700/30';
      case 'CANDIDATE':
        return 'bg-amber-950/30 text-amber-400 border-amber-700/30';
      default:
        return 'bg-gray-900/30 text-gray-400 border-gray-700/30';
    }
  };

  const getUavBadge = (decision?: string) => {
    switch (decision) {
      case 'UAV':
        return 'bg-red-950/40 text-red-300 border-red-700/40';
      case 'NON_UAV':
        return 'bg-green-950/40 text-green-300 border-green-700/40';
      default:
        return 'bg-gray-900/40 text-gray-400 border-gray-700/40';
    }
  };

  const getRiskIndicator = (riskLevel: string) => {
    switch (riskLevel) {
      case 'CRITICAL':
        return '🔴';
      case 'HIGH':
        return '🟠';
      case 'MEDIUM':
        return '🟡';
      case 'LOW':
        return '🟢';
      default:
        return '⚪';
    }
  };

  return (
    <div className="h-full bg-[#0a0d12] border-b border-cyan-950/50 flex flex-col relative overflow-hidden">
      {/* Corner brackets */}
      <div className="absolute top-4 left-6 w-4 h-4 border-l-2 border-t-2 border-cyan-500/40 z-10" />
      <div className="absolute top-4 right-6 w-4 h-4 border-r-2 border-t-2 border-cyan-500/40 z-10" />

      {/* Header */}
      <div className="px-6 py-4 border-b border-cyan-950/50">
        <h2 className="text-base font-semibold text-cyan-400 uppercase tracking-wider">
          추적된 객체
        </h2>
        <p className="text-sm text-gray-500 mt-1 font-mono">{objects.length} 활성</p>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-[#0a0d12] border-b border-cyan-950/50">
            <tr className="text-gray-500 uppercase tracking-wider">
              <th className="px-4 py-3 text-left font-semibold">
                <button
                  onClick={() => handleSort('id')}
                  className="flex items-center gap-1 hover:text-cyan-400 transition-colors"
                >
                  ID
                  <SortIcon field="id" />
                </button>
              </th>
              <th className="px-4 py-3 text-left font-semibold">
                <button
                  onClick={() => handleSort('class')}
                  className="flex items-center gap-1 hover:text-cyan-400 transition-colors"
                >
                  클래스
                  <SortIcon field="class" />
                </button>
              </th>
              <th className="px-4 py-3 text-right font-semibold">
                <button
                  onClick={() => handleSort('confidence')}
                  className="flex items-center gap-1 hover:text-cyan-400 transition-colors ml-auto"
                >
                  신뢰도
                  <SortIcon field="confidence" />
                </button>
              </th>
              <th className="px-4 py-3 text-right font-semibold">
                <button
                  onClick={() => handleSort('speed')}
                  className="flex items-center gap-1 hover:text-cyan-400 transition-colors ml-auto"
                >
                  속도
                  <SortIcon field="speed" />
                </button>
              </th>
              <th className="px-4 py-3 text-right font-semibold">
                <button
                  onClick={() => handleSort('distance')}
                  className="flex items-center gap-1 hover:text-cyan-400 transition-colors ml-auto"
                >
                  거리
                  <SortIcon field="distance" />
                </button>
              </th>
              <th className="px-4 py-3 text-left font-semibold">크기</th>
              <th className="px-4 py-3 text-left font-semibold">
                <button
                  onClick={() => handleSort('status')}
                  className="flex items-center gap-1 hover:text-cyan-400 transition-colors"
                >
                  상태
                  <SortIcon field="status" />
                </button>
              </th>
              <th className="px-4 py-3 text-right font-semibold">
                <button
                  onClick={() => handleSort('uavProbability')}
                  className="flex items-center gap-1 hover:text-cyan-400 transition-colors ml-auto"
                >
                  UAV 판정
                  <SortIcon field="uavProbability" />
                </button>
              </th>
              <th className="px-4 py-3 text-center font-semibold">위험</th>
            </tr>
          </thead>
          <tbody>
            {sortedObjects.map(obj => (
              <tr
                key={obj.id}
                onClick={() => onSelectObject(obj.id)}
                className={`border-b border-cyan-950/20 hover:bg-cyan-950/10 cursor-pointer transition-colors ${
                  obj.id === selectedObjectId ? 'bg-cyan-950/20' : ''
                } ${
                  obj.status === 'NEW' ? 'animate-pulse' : ''
                }`}
              >
                <td className="px-4 py-3">
                  <span className="font-mono text-gray-300">{obj.id}</span>
                </td>
                <td className="px-4 py-3">
                  <span className="text-gray-300">{CLASS_NAMES_KR[obj.class]}</span>
                </td>
                <td className="px-4 py-3 text-right">
                  <span className={`font-mono ${
                    obj.confidence > 90 ? 'text-green-400' :
                    obj.confidence > 75 ? 'text-cyan-400' :
                    obj.confidence > 60 ? 'text-yellow-400' :
                    'text-orange-400'
                  }`}>
                    {obj.confidence.toFixed(0)}%
                  </span>
                </td>
                <td className="px-4 py-3 text-right">
                  <span className="font-mono text-gray-300">{obj.speed.toFixed(1)}</span>
                  <span className="text-gray-600 ml-1">m/s</span>
                </td>
                <td className="px-4 py-3 text-right">
                  <span className="font-mono text-gray-300">{obj.distance.toFixed(1)}</span>
                  <span className="text-gray-600 ml-1">m</span>
                </td>
                <td className="px-4 py-3">
                  <span className="font-mono text-gray-400 text-xs">
                    {obj.size.length.toFixed(1)}×{obj.size.width.toFixed(1)}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <span className={`px-2 py-0.5 border rounded-sm text-xs font-semibold uppercase ${getStatusColor(obj.status)}`}>
                    {STATUS_NAMES_KR[obj.status]}
                  </span>
                </td>
                <td className="px-4 py-3 text-right">
                  <div className="flex flex-col items-end gap-1">
                    <span className={`px-2 py-0.5 border rounded-sm text-xs font-semibold ${getUavBadge(obj.uavDecision)}`}>
                      {obj.uavDecision === 'UAV'
                        ? 'UAV'
                        : obj.uavDecision === 'NON_UAV'
                        ? 'NON-UAV'
                        : 'UNKNOWN'}
                    </span>
                    <span className="text-xs font-mono text-gray-500">
                      {(obj.uavProbability ?? 0).toFixed(1)}%
                    </span>
                  </div>
                </td>
                <td className="px-4 py-3 text-center">
                  <span className="text-base">{getRiskIndicator(obj.riskLevel)}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {objects.length === 0 && (
          <div className="flex items-center justify-center h-32">
            <p className="text-base text-gray-600 font-mono">감지된 객체 없음</p>
          </div>
        )}
      </div>
    </div>
  );
}
