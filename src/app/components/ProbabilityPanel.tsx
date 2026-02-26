import { BarChart3, TrendingUp } from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, ResponsiveContainer, CartesianGrid } from 'recharts';
import { ClassProbability } from '../types';

interface ProbabilityPanelProps {
  probabilities: ClassProbability[];
  confidenceHistory: number[];
}

export function ProbabilityPanel({ probabilities, confidenceHistory }: ProbabilityPanelProps) {
  const historyData = confidenceHistory.map((value, index) => ({
    time: index,
    confidence: value,
  }));

  // Safety check for empty probabilities
  if (!probabilities || probabilities.length === 0) {
    return (
      <div className="bg-[#0a0d12] border-y border-cyan-950/50 p-6">
        <div className="text-center text-gray-500 text-sm">Loading probabilities...</div>
      </div>
    );
  }

  return (
    <div className="bg-[#0a0d12] border-y border-cyan-950/50 p-6 space-y-6">
      {/* Class Probabilities */}
      <div>
        <div className="flex items-center gap-2 mb-4">
          <BarChart3 className="w-4 h-4 text-cyan-400" />
          <h3 className="text-xs font-semibold text-gray-300 uppercase tracking-wider">
            Class Probabilities
          </h3>
        </div>

        <div className="space-y-3">
          {probabilities.map((prob, index) => (
            <div key={prob.className}>
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-sm font-medium text-gray-400">{prob.className}</span>
                <span className="text-sm font-mono text-gray-300 tabular-nums">
                  {prob.probability.toFixed(1)}%
                </span>
              </div>
              <div className="h-2 bg-gray-800 overflow-hidden">
                <div
                  className={`h-full transition-all duration-300 ${
                    index === 0
                      ? 'bg-cyan-400'
                      : index === 1
                      ? 'bg-cyan-600'
                      : 'bg-cyan-800'
                  }`}
                  style={{ width: `${prob.probability}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Confidence Trend */}
      <div>
        <div className="flex items-center gap-2 mb-4">
          <TrendingUp className="w-4 h-4 text-cyan-400" />
          <h3 className="text-xs font-semibold text-gray-300 uppercase tracking-wider">
            Confidence Trend
          </h3>
        </div>

        <div className="h-24 bg-gray-900/50 border border-gray-800 p-2">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={historyData} margin={{ top: 5, right: 5, left: 0, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e3a4a" opacity={0.2} />
              <XAxis
                dataKey="time"
                hide
              />
              <YAxis
                domain={[0, 100]}
                hide
              />
              <Line
                type="monotone"
                dataKey="confidence"
                stroke="#06b6d4"
                strokeWidth={2}
                dot={false}
                isAnimationActive={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>

        <div className="flex items-center justify-between mt-2 text-xs text-gray-500">
          <span>Last 20 seconds</span>
          <div className="flex items-center gap-4">
            <span>Min: {Math.min(...confidenceHistory).toFixed(1)}%</span>
            <span>Max: {Math.max(...confidenceHistory).toFixed(1)}%</span>
          </div>
        </div>
      </div>

      {/* Uncertainty Meter */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-semibold text-gray-300 uppercase tracking-wider">
            Uncertainty
          </span>
          <span className="text-sm font-mono text-gray-400 tabular-nums">
            {(100 - probabilities[0].probability).toFixed(1)}%
          </span>
        </div>
        <div className="h-1.5 bg-gray-800 overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-orange-600 to-red-500 transition-all duration-300"
            style={{ width: `${100 - probabilities[0].probability}%` }}
          />
        </div>
      </div>
    </div>
  );
}