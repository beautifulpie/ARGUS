import { useMemo, useState } from 'react';
import { Clock, Info, AlertTriangle, AlertOctagon } from 'lucide-react';
import { ScrollArea } from './ui/scroll-area';
import { DetectedObject, ObjectClass, TimelineEvent } from '../types';

interface EventTimelineProps {
  events: TimelineEvent[];
  objects: DetectedObject[];
}

type EventFilter = 'ALL' | ObjectClass | 'UNKNOWN';

const CLASS_NAMES_KR: Record<ObjectClass, string> = {
  HELICOPTER: '헬기',
  UAV: '무인기',
  HIGHSPEED: '고속기',
  BIRD_FLOCK: '새떼',
  BIRD: '새',
  CIVIL_AIR: '민간기',
  FIGHTER: '전투기',
};

const FILTER_ORDER: EventFilter[] = [
  'ALL',
  'UAV',
  'BIRD',
  'BIRD_FLOCK',
  'HELICOPTER',
  'CIVIL_AIR',
  'FIGHTER',
  'HIGHSPEED',
  'UNKNOWN',
];

const EVENT_PRIORITY: Record<TimelineEvent['type'], number> = {
  ALERT: 0,
  WARNING: 1,
  INFO: 2,
};

const RECENT_CRITICAL_WINDOW_MS = 3 * 60 * 1000;

const getFilterLabel = (filter: EventFilter): string => {
  if (filter === 'ALL') return '전체';
  if (filter === 'UNKNOWN') return '미분류';
  return CLASS_NAMES_KR[filter];
};

export function EventTimeline({ events, objects }: EventTimelineProps) {
  const [selectedFilter, setSelectedFilter] = useState<EventFilter>('ALL');

  const classByObjectId = useMemo(() => {
    const table = new Map<string, ObjectClass>();
    for (const obj of objects) {
      table.set(obj.id, obj.class);
    }
    return table;
  }, [objects]);

  const normalizedEvents = useMemo(
    () =>
      events.map((event) => ({
        ...event,
        objectClass:
          event.objectClass ??
          (event.objectId ? classByObjectId.get(event.objectId) : undefined) ??
          'UNKNOWN',
      })),
    [events, classByObjectId]
  );

  const availableFilters = useMemo(() => {
    const used = new Set<EventFilter>();
    used.add('ALL');
    for (const event of normalizedEvents) {
      const cls = event.objectClass ?? 'UNKNOWN';
      if (cls in CLASS_NAMES_KR) {
        used.add(cls as EventFilter);
      } else {
        used.add('UNKNOWN');
      }
    }
    return FILTER_ORDER.filter((item) => used.has(item));
  }, [normalizedEvents]);

  const filteredEvents = useMemo(() => {
    const base =
      selectedFilter === 'ALL'
        ? normalizedEvents
        : normalizedEvents.filter((event) => (event.objectClass ?? 'UNKNOWN') === selectedFilter);

    return [...base].sort((a, b) => {
      const priorityDiff = EVENT_PRIORITY[a.type] - EVENT_PRIORITY[b.type];
      if (priorityDiff !== 0) return priorityDiff;
      return b.timestamp.getTime() - a.timestamp.getTime();
    });
  }, [normalizedEvents, selectedFilter]);

  const visibleCount = filteredEvents.length;
  const now = Date.now();

  const getEventIcon = (type: TimelineEvent['type']) => {
    switch (type) {
      case 'INFO':
        return <Info className="w-4 h-4 text-cyan-300" />;
      case 'WARNING':
        return <AlertTriangle className="w-4 h-4 text-orange-300" />;
      case 'ALERT':
        return <AlertOctagon className="w-4 h-4 text-red-300" />;
    }
  };

  const getEventCard = (type: TimelineEvent['type'], isRecentCritical: boolean) => {
    if (type === 'ALERT') {
      return isRecentCritical
        ? 'border-red-500/65 bg-red-950/35 shadow-[inset_0_0_0_1px_rgba(239,68,68,0.22)]'
        : 'border-red-900/70 bg-red-950/22';
    }
    if (type === 'WARNING') {
      return 'border-orange-900/70 bg-orange-950/18';
    }
    return 'border-cyan-950/70 bg-cyan-950/12';
  };

  const getEventTypeClass = (type: TimelineEvent['type']) => {
    switch (type) {
      case 'INFO':
        return 'text-cyan-300';
      case 'WARNING':
        return 'text-orange-300';
      case 'ALERT':
        return 'text-red-300';
    }
  };

  const getEventTypeText = (type: TimelineEvent['type']) => {
    switch (type) {
      case 'INFO':
        return '정보';
      case 'WARNING':
        return '경고';
      case 'ALERT':
        return '중요';
      default:
        return type;
    }
  };

  return (
    <div className="argus-surface h-full min-h-0 bg-[#0b1016] border-t border-cyan-950/50 flex flex-col overflow-hidden">
      <div className="px-6 py-[18px] border-b border-cyan-950/50 flex items-center justify-between gap-4 shrink-0">
        <div className="flex items-center gap-2.5">
          <Clock className="w-5 h-5 text-cyan-300" />
          <h2 className="text-2xl font-bold text-slate-100 uppercase tracking-[0.08em]">이벤트 타임라인</h2>
        </div>
        <div className="flex items-center gap-3">
          <label className="text-xs text-slate-500 uppercase tracking-[0.1em] whitespace-nowrap">
            기체 필터
          </label>
          <select
            value={selectedFilter}
            onChange={(event) => setSelectedFilter(event.target.value as EventFilter)}
            className="h-8 px-2.5 bg-[#0f1520] border border-slate-700/70 text-slate-100 text-sm rounded focus:outline-none focus:border-cyan-400/70"
          >
            {availableFilters.map((filter) => (
              <option key={filter} value={filter}>
                {getFilterLabel(filter)}
              </option>
            ))}
          </select>
          <div className="text-sm font-mono text-slate-400 whitespace-nowrap tabular-nums">
            {visibleCount}/{events.length}
          </div>
        </div>
      </div>

      <ScrollArea className="flex-1 min-h-0">
        <div className="px-6 py-[18px] space-y-3">
          {filteredEvents.map((event) => {
            const isRecentCritical =
              event.type === 'ALERT' && now - event.timestamp.getTime() <= RECENT_CRITICAL_WINDOW_MS;
            return (
              <div
                key={event.id}
                className={`argus-event-card flex items-start gap-3 p-3.5 border transition-colors duration-200 ${getEventCard(event.type, isRecentCritical)}`}
              >
                <div className="mt-0.5">{getEventIcon(event.type)}</div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-baseline justify-between gap-2 mb-1">
                    <span
                      className={`text-sm font-semibold uppercase tracking-[0.1em] ${getEventTypeClass(event.type)}`}
                    >
                      {getEventTypeText(event.type)}
                    </span>
                    <span className="text-sm text-slate-400 font-mono tabular-nums tracking-[0.04em]">
                      {event.timestamp.toLocaleTimeString('en-US', { hour12: false })}
                    </span>
                  </div>
                  <p className="text-[15px] text-slate-100 leading-snug">{event.message}</p>
                  <p className="text-xs text-slate-500 mt-1">
                    기체: {getFilterLabel((event.objectClass as EventFilter) || 'UNKNOWN')}
                  </p>
                </div>
              </div>
            );
          })}

          {filteredEvents.length === 0 && (
            <div className="text-center py-12 text-slate-500">
              <Clock className="w-10 h-10 mx-auto mb-3 opacity-50" />
              <p className="text-base">표시할 이벤트 없음</p>
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
