import { LineChart, Line, XAxis, YAxis, CartesianGrid, ResponsiveContainer, ReferenceArea } from 'recharts';
import { SignalData } from '../types';

interface SignalVisualizationProps {
  data: SignalData;
}

const CHANNEL_COLORS = [
  '#06b6d4', // cyan-500
  '#0ea5e9', // sky-500
  '#3b82f6', // blue-500
  '#6366f1', // indigo-500
  '#8b5cf6', // violet-500
  '#06b6d4', // cyan-500
  '#0ea5e9', // sky-500
  '#3b82f6', // blue-500
];

export function SignalVisualization({ data }: SignalVisualizationProps) {
  // Transform data for recharts
  const chartData = data.timestamps.map((timestamp, idx) => {
    const point: any = { timestamp };
    data.channels.forEach((channel, chIdx) => {
      point[`ch${chIdx}`] = channel[idx];
    });
    return point;
  });

  return (
    <div className="h-full bg-[#0a0d12] border-r border-cyan-950/50 flex flex-col relative">
      {/* Corner accents - top left */}
      <div className="absolute top-0 left-0 w-4 h-4 border-l-2 border-t-2 border-cyan-500/30" />
      <div className="absolute top-0 right-0 w-4 h-4 border-r-2 border-t-2 border-cyan-500/30" />
      <div className="absolute bottom-0 left-0 w-4 h-4 border-l-2 border-b-2 border-cyan-500/30" />
      <div className="absolute bottom-0 right-0 w-4 h-4 border-r-2 border-b-2 border-cyan-500/30" />

      {/* Header */}
      <div className="px-4 py-3 border-b border-cyan-950/50">
        <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wider">
          Multi-Channel Signal
        </h2>
        <p className="text-xs text-gray-500 mt-0.5">8-Channel Radar Input • Sliding Window</p>
      </div>

      {/* Chart */}
      <div className="flex-1 p-4">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={chartData} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#1e3a4a" opacity={0.3} />
            <XAxis
              dataKey="timestamp"
              stroke="#4b5563"
              tick={{ fill: '#6b7280', fontSize: 10 }}
              tickLine={{ stroke: '#374151' }}
            />
            <YAxis
              stroke="#4b5563"
              tick={{ fill: '#6b7280', fontSize: 10 }}
              tickLine={{ stroke: '#374151' }}
              domain={[-1.5, 1.5]}
            />
            
            {/* Highlight inference window */}
            <ReferenceArea
              x1={data.inferenceWindow.start}
              x2={data.inferenceWindow.end}
              fill="#06b6d4"
              fillOpacity={0.08}
              stroke="#06b6d4"
              strokeOpacity={0.3}
              strokeWidth={1}
            />

            {/* Missing data regions */}
            {data.missingRanges.map((range, idx) => (
              <ReferenceArea
                key={`missing-${idx}`}
                x1={range.start}
                x2={range.end}
                fill="#6b7280"
                fillOpacity={0.15}
              />
            ))}

            {/* Draw all channels */}
            {data.channels.map((_, chIdx) => (
              <Line
                key={`ch${chIdx}`}
                type="monotone"
                dataKey={`ch${chIdx}`}
                stroke={CHANNEL_COLORS[chIdx]}
                strokeWidth={1.2}
                dot={false}
                isAnimationActive={false}
                connectNulls={false}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* Legend */}
      <div className="px-4 py-3 border-t border-cyan-950/50">
        <div className="grid grid-cols-4 gap-2">
          {data.channels.map((_, chIdx) => (
            <div key={chIdx} className="flex items-center gap-2">
              <div
                className="w-3 h-0.5"
                style={{ backgroundColor: CHANNEL_COLORS[chIdx] }}
              />
              <span className="text-xs text-gray-500 font-mono">CH{chIdx + 1}</span>
            </div>
          ))}
        </div>
        <div className="mt-2 flex items-center gap-4 text-xs text-gray-500">
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 bg-cyan-400/10 border border-cyan-400/30" />
            <span>Inference Window</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 bg-gray-600/20" />
            <span>Missing Data</span>
          </div>
        </div>
      </div>
    </div>
  );
}