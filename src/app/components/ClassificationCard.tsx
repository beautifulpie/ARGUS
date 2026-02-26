import { Shield, Activity, AlertTriangle } from 'lucide-react';
import { ClassificationResult } from '../types';
import { useEffect, useState } from 'react';

interface ClassificationCardProps {
  result: ClassificationResult;
}

export function ClassificationCard({ result }: ClassificationCardProps) {
  const [isUpdating, setIsUpdating] = useState(false);

  useEffect(() => {
    setIsUpdating(true);
    const timer = setTimeout(() => setIsUpdating(false), 300);
    return () => clearTimeout(timer);
  }, [result.className]);

  const getBorderColor = () => {
    switch (result.stability) {
      case 'STABLE':
        return 'border-cyan-500';
      case 'MODERATE':
        return 'border-orange-500';
      case 'UNSTABLE':
        return 'border-red-500';
    }
  };

  const getStabilityColor = () => {
    switch (result.stability) {
      case 'STABLE':
        return 'text-cyan-400';
      case 'MODERATE':
        return 'text-orange-400';
      case 'UNSTABLE':
        return 'text-red-400';
    }
  };

  const getRiskColor = () => {
    switch (result.riskLevel) {
      case 'LOW':
        return 'text-green-400';
      case 'MEDIUM':
        return 'text-yellow-400';
      case 'HIGH':
        return 'text-orange-400';
      case 'CRITICAL':
        return 'text-red-400';
    }
  };

  const getRiskBgColor = () => {
    switch (result.riskLevel) {
      case 'LOW':
        return 'bg-green-950/30';
      case 'MEDIUM':
        return 'bg-yellow-950/30';
      case 'HIGH':
        return 'bg-orange-950/30';
      case 'CRITICAL':
        return 'bg-red-950/30';
    }
  };

  return (
    <div
      className={`bg-[#0a0d12] border-2 ${getBorderColor()} p-6 transition-all duration-300 relative ${
        isUpdating ? 'shadow-lg' : ''
      }`}
      style={
        isUpdating && result.stability === 'STABLE'
          ? { boxShadow: '0 0 20px rgba(6, 182, 212, 0.3)' }
          : undefined
      }
    >
      {/* Corner accents */}
      <div className={`absolute top-0 left-0 w-3 h-3 border-l-2 border-t-2 ${getBorderColor()} opacity-50`} />
      <div className={`absolute top-0 right-0 w-3 h-3 border-r-2 border-t-2 ${getBorderColor()} opacity-50`} />
      <div className={`absolute bottom-0 left-0 w-3 h-3 border-l-2 border-b-2 ${getBorderColor()} opacity-50`} />
      <div className={`absolute bottom-0 right-0 w-3 h-3 border-r-2 border-b-2 ${getBorderColor()} opacity-50`} />

      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-2">
          <Shield className="w-5 h-5 text-cyan-400" />
          <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wider">
            Classification
          </h2>
        </div>
        <div className="text-xs text-gray-500 font-mono">
          {result.timestamp.toLocaleTimeString('en-US', { hour12: false })}
        </div>
      </div>

      {/* Main Classification */}
      <div className="mb-6">
        <div className="text-xs text-gray-500 uppercase tracking-wider mb-2">TARGET</div>
        <div className="text-5xl font-bold text-gray-100 tracking-tight mb-1">
          {result.className}
        </div>
      </div>

      {/* Confidence */}
      <div className="mb-6">
        <div className="flex items-baseline gap-2 mb-2">
          <span className="text-xs text-gray-500 uppercase tracking-wider">Confidence</span>
          <span className="text-3xl font-bold text-cyan-400 tabular-nums">
            {result.confidence.toFixed(1)}%
          </span>
        </div>
        <div className="h-2 bg-gray-800 overflow-hidden">
          <div
            className={`h-full transition-all duration-300 ${
              result.confidence > 90
                ? 'bg-cyan-400'
                : result.confidence > 75
                ? 'bg-orange-400'
                : 'bg-red-400'
            }`}
            style={{ width: `${result.confidence}%` }}
          />
        </div>
      </div>

      {/* Status Grid */}
      <div className="grid grid-cols-2 gap-4">
        {/* Stability */}
        <div className="bg-gray-900/50 border border-gray-800 p-4">
          <div className="flex items-center gap-2 mb-2">
            <Activity className="w-4 h-4 text-gray-500" />
            <span className="text-xs text-gray-500 uppercase tracking-wider">Stability</span>
          </div>
          <div className={`text-xl font-semibold ${getStabilityColor()}`}>
            {result.stability}
          </div>
        </div>

        {/* Risk Level */}
        <div className={`${getRiskBgColor()} border border-gray-800 p-4`}>
          <div className="flex items-center gap-2 mb-2">
            <AlertTriangle className="w-4 h-4 text-gray-500" />
            <span className="text-xs text-gray-500 uppercase tracking-wider">Risk</span>
          </div>
          <div className={`text-xl font-semibold ${getRiskColor()}`}>
            {result.riskLevel}
          </div>
        </div>
      </div>
    </div>
  );
}