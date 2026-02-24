import { DetectedObject } from '../types';
import { AlertTriangle, Radio } from 'lucide-react';
import { ScrollArea } from './ui/scroll-area';

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
  const candidates = objects.filter(obj => obj.status === 'CANDIDATE');

  return (
    <div className="flex flex-col h-full bg-[#0a0d12] border-t border-cyan-950/50">
      <div className="px-6 py-4 border-b border-cyan-950/50 flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-amber-500 uppercase tracking-wider flex items-center gap-2">
            <Radio className="w-5 h-5 animate-pulse" />
            후보 추적군
          </h2>
          <p className="text-xs text-gray-500 mt-1 font-mono">신호 손실 / 예측 추적 중</p>
        </div>
        <span className="bg-amber-900/30 text-amber-500 text-xs px-2 py-1 rounded font-mono">
          {candidates.length} ACTIVE
        </span>
      </div>
      
      <ScrollArea className="flex-1 min-h-[150px]">
        <div className="p-4 space-y-3">
          {candidates.length === 0 ? (
            <div className="text-center py-10 text-gray-600">
              <p className="text-sm">현재 후보 추적군 없음</p>
            </div>
          ) : (
            candidates.map(obj => (
              <div 
                key={obj.id}
                onClick={() => onSelectObject(obj.id)}
                className="bg-[#111827] border border-amber-900/30 rounded p-3 cursor-pointer hover:border-amber-500/50 transition-colors group"
              >
                <div className="flex justify-between items-start mb-2">
                  <span className="text-amber-400 font-mono text-sm font-bold group-hover:text-amber-300">
                    {obj.id}
                  </span>
                  <span className="text-xs text-amber-600 flex items-center gap-1">
                    <AlertTriangle className="w-3 h-3" />
                    신호 불안정
                  </span>
                </div>
                
                <div className="grid grid-cols-2 gap-2 text-xs text-gray-400 mb-2">
                  <div>
                    <span className="block text-gray-600 uppercase text-[10px]">분류</span>
                    {CLASS_NAMES_KR[obj.class]}
                  </div>
                  <div>
                    <span className="block text-gray-600 uppercase text-[10px]">신뢰도</span>
                    <span className="text-amber-500">{obj.confidence.toFixed(1)}%</span>
                  </div>
                  <div>
                    <span className="block text-gray-600 uppercase text-[10px]">UAV 확률</span>
                    <span className="text-red-300">{(obj.uavProbability ?? 0).toFixed(1)}%</span>
                  </div>
                  <div>
                    <span className="block text-gray-600 uppercase text-[10px]">UAV 판정</span>
                    <span className="text-amber-300">{obj.uavDecision || 'UNKNOWN'}</span>
                  </div>
                </div>

                <div className="w-full bg-gray-800 h-1 rounded overflow-hidden">
                  <div 
                    className="bg-amber-600 h-full animate-pulse" 
                    style={{ width: `${obj.confidence}%` }}
                  />
                </div>
              </div>
            ))
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
