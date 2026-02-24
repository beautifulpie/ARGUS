import { ScrollArea } from './ui/scroll-area';
import { Clock, Info, AlertTriangle, AlertOctagon } from 'lucide-react';
import { TimelineEvent } from '../types';

interface EventTimelineProps {
  events: TimelineEvent[];
}

export function EventTimeline({ events }: EventTimelineProps) {
  const getEventIcon = (type: TimelineEvent['type']) => {
    switch (type) {
      case 'INFO':
        return <Info className="w-4 h-4 text-cyan-400" />;
      case 'WARNING':
        return <AlertTriangle className="w-4 h-4 text-orange-400" />;
      case 'ALERT':
        return <AlertOctagon className="w-4 h-4 text-red-400" />;
    }
  };

  const getEventBgColor = (type: TimelineEvent['type']) => {
    switch (type) {
      case 'INFO':
        return 'bg-cyan-950/20 border-cyan-900/50';
      case 'WARNING':
        return 'bg-orange-950/20 border-orange-900/50';
      case 'ALERT':
        return 'bg-red-950/30 border-red-900/50';
    }
  };

  const getEventTextColor = (type: TimelineEvent['type']) => {
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
      case 'INFO': return '정보';
      case 'WARNING': return '경고';
      case 'ALERT': return '알림';
      default: return type;
    }
  };

  // Reverse to show most recent first
  const sortedEvents = [...events].reverse();

  return (
    <div className="h-full bg-[#0a0d12] border-t border-cyan-950/50 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="px-6 py-3 border-b border-cyan-950/50 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2">
          <Clock className="w-5 h-5 text-cyan-400" />
          <h2 className="text-base font-semibold text-gray-300 uppercase tracking-wider">
            이벤트 타임라인
          </h2>
        </div>
        <div className="text-sm text-gray-500">
          {events.length} 이벤트 기록됨
        </div>
      </div>

      {/* Timeline */}
      <ScrollArea className="flex-1">
        <div className="px-6 py-4 space-y-2">
          {sortedEvents.map((event, index) => (
            <div
              key={event.id}
              className={`flex items-start gap-3 p-3 border ${getEventBgColor(event.type)} transition-all duration-200 ${
                index === 0 ? 'animate-in fade-in slide-in-from-top-2 duration-300' : ''
              }`}
            >
              <div className="mt-0.5">{getEventIcon(event.type)}</div>
              <div className="flex-1 min-w-0">
                <div className="flex items-baseline justify-between gap-2 mb-1">
                  <span className={`text-sm font-semibold uppercase tracking-wider ${getEventTextColor(event.type)}`}>
                    {getEventTypeText(event.type)}
                  </span>
                  <span className="text-sm text-gray-500 font-mono tabular-nums">
                    {event.timestamp.toLocaleTimeString('en-US', { hour12: false })}
                  </span>
                </div>
                <p className="text-base text-gray-300">{event.message}</p>
              </div>
            </div>
          ))}

          {events.length === 0 && (
            <div className="text-center py-12 text-gray-600">
              <Clock className="w-10 h-10 mx-auto mb-3 opacity-50" />
              <p className="text-base">기록된 이벤트 없음</p>
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}