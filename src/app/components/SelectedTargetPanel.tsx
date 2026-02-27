import { Navigation, Target } from 'lucide-react';
import {
  DetectedObject,
  ObjectClass,
  ObjectStatus,
  RiskLevel,
  UavDecision,
} from '../types';
import { type LayoutDevConfig } from '../layoutDevConfig';

interface SelectedTargetPanelProps {
  selectedObject: DetectedObject | null;
  layoutDevConfig: LayoutDevConfig;
  onOpenTodDialog?: () => void;
  isTrackLossGraceActive?: boolean;
  trackLossGraceRemainingMs?: number;
}

const CLASS_NAMES_KR: Record<ObjectClass, string> = {
  HELICOPTER: '헬기',
  UAV: '무인기',
  HIGHSPEED: '고속기',
  BIRD_FLOCK: '새떼',
  BIRD: '새',
  CIVIL_AIR: '민간기',
  FIGHTER: '전투기',
};

const RISK_NAMES_KR: Record<RiskLevel, string> = {
  LOW: '저위험',
  MEDIUM: '중위험',
  HIGH: '고위험',
  CRITICAL: '치명적',
};

const STATUS_NAMES_KR: Record<ObjectStatus, string> = {
  STABLE: '안정',
  NEW: '신규',
  LOST: '손실',
  TRACKING: '추적 중',
  CANDIDATE: '후보 추적',
};

const UAV_DECISION_NAMES: Record<UavDecision, string> = {
  UAV: 'UAV',
  NON_UAV: 'NON-UAV',
  UNKNOWN: 'UNKNOWN',
};

const INFERENCE_SOURCE_NAMES: Record<'RADAR_SIGNAL' | 'TOD_YOLO', string> = {
  RADAR_SIGNAL: 'SIGNAL',
  TOD_YOLO: 'TOD-YOLO',
};

const THREAT_BADGE_CLASS: Record<RiskLevel, string> = {
  LOW: 'argus-threat-low',
  MEDIUM: 'argus-threat-medium',
  HIGH: 'argus-threat-high',
  CRITICAL: 'argus-threat-critical',
};

const THREAT_TEXT_CLASS: Record<RiskLevel, string> = {
  LOW: 'argus-threat-text-low',
  MEDIUM: 'argus-threat-text-medium',
  HIGH: 'argus-threat-text-high',
  CRITICAL: 'argus-threat-text-critical',
};

const UAV_BADGE_CLASS: Record<UavDecision, string> = {
  UAV: 'argus-uav-uav',
  NON_UAV: 'argus-uav-non',
  UNKNOWN: 'argus-uav-unknown',
};

export function SelectedTargetPanel({
  selectedObject,
  layoutDevConfig,
  onOpenTodDialog,
  isTrackLossGraceActive = false,
  trackLossGraceRemainingMs = 0,
}: SelectedTargetPanelProps) {
  if (!selectedObject) {
    return (
      <div
        className="argus-aircraft-panel argus-surface h-full border-b border-cyan-950/50 flex items-center justify-center"
        style={{ ['--argus-selected-font-scale' as string]: String(layoutDevConfig.selectedPanelFontScale) }}
      >
        <div className="text-center px-6">
          <Target className="w-14 h-14 text-cyan-900/40 mx-auto mb-3" />
          <p className="text-lg font-semibold text-slate-300">선택된 객체 없음</p>
          <p className="text-sm text-slate-500 mt-2">공간 뷰에서 객체를 클릭하세요</p>
        </div>
      </div>
    );
  }

  const candidates = (selectedObject.probabilities ?? [])
    .filter((candidate) => candidate.className !== selectedObject.class)
    .sort((a, b) => b.probability - a.probability)
    .slice(0, 3);

  const uavDecision = selectedObject.uavDecision ?? 'UNKNOWN';
  const uavProbability = selectedObject.uavProbability ?? 0;
  const confidence = Math.max(0, Math.min(100, selectedObject.confidence));
  const radarScore = Math.max(0, Math.min(100, selectedObject.score ?? confidence));
  const todInference = selectedObject.todInference;
  const combinedInference = selectedObject.combinedInference;
  const todClassLabel =
    todInference && todInference.className !== 'UNKNOWN'
      ? (CLASS_NAMES_KR[todInference.className] ?? todInference.className)
      : 'UNKNOWN';
  const combinedClassLabel =
    combinedInference && combinedInference.className !== 'UNKNOWN'
      ? (CLASS_NAMES_KR[combinedInference.className] ?? combinedInference.className)
      : (combinedInference?.className ?? 'UNKNOWN');
  const combinedSourceLabel =
    combinedInference ? INFERENCE_SOURCE_NAMES[combinedInference.selectedSource] : 'SIGNAL';
  const trackLossGraceSeconds = Math.max(0, trackLossGraceRemainingMs) / 1000;
  const isTodSelected = combinedInference?.selectedSource === 'TOD_YOLO';
  const todUsageLabel = isTodSelected ? '사용' : todInference?.available ? '미채택' : '미사용';
  const todUsageClass = isTodSelected
    ? 'border-sky-700/65 bg-sky-950/35 text-sky-200'
    : todInference?.available
      ? 'border-amber-700/65 bg-amber-950/30 text-amber-200'
      : 'border-slate-600/70 bg-slate-900/65 text-slate-300';

  return (
    <section
      className="argus-aircraft-panel argus-surface h-full border-b border-cyan-950/50 overflow-hidden"
      style={{ ['--argus-selected-font-scale' as string]: String(layoutDevConfig.selectedPanelFontScale) }}
    >
      <div className="argus-aircraft-body">
        {/* Hierarchy: threat > class/confidence > motion > details */}
        <header className="argus-aircraft-header">
          <div>
            <div className="argus-track-line">
              <span className="argus-track-id">{selectedObject.id}</span>
              <span className="argus-track-divider">|</span>
              <span className="argus-track-status">추적 안정성 {STATUS_NAMES_KR[selectedObject.status]}</span>
            </div>
            <p className="argus-header-caption">선택 비행체 상태</p>
            {isTrackLossGraceActive && (
              <p className="mt-1 inline-flex items-center rounded border border-amber-700/60 bg-amber-950/30 px-2 py-0.5 text-[11px] font-semibold text-amber-200 tabular-nums">
                추적 신호 유실 유예 {trackLossGraceSeconds.toFixed(1)}s
              </p>
            )}
          </div>

          <div className={`argus-threat-badge ${THREAT_BADGE_CLASS[selectedObject.riskLevel]}`}>
            <span className="argus-threat-label">THREAT</span>
            <span className="argus-threat-value">{RISK_NAMES_KR[selectedObject.riskLevel]}</span>
          </div>
        </header>

        <div className="argus-aircraft-grid">
          <article className="argus-aircraft-card argus-primary-card">
            <div className="argus-primary-head">
              <h3 className="argus-card-title">비행체 분류</h3>
              <button
                type="button"
                onClick={onOpenTodDialog}
                className="argus-tod-button"
              >
                TOD 데이터 사용
              </button>
            </div>

            <div className="argus-primary-metrics">
              <div>
                <p className="argus-metric-label">PRIMARY CLASS</p>
                <p className="argus-primary-class">{CLASS_NAMES_KR[selectedObject.class]}</p>
              </div>
              <div className="text-right">
                <p className="argus-metric-label">CONFIDENCE</p>
                <p className="argus-primary-number">{confidence.toFixed(1)}%</p>
              </div>
            </div>

            <div className="argus-confidence-track" aria-hidden="true">
              <div className="argus-confidence-fill" style={{ width: `${confidence}%` }} />
            </div>

            <div className="argus-subsection mt-5">
              <p className="argus-metric-label">ALTERNATIVE CANDIDATES (TOP-3)</p>
              <ul className="argus-candidate-list mt-2">
                {candidates.length === 0 && (
                  <li className="argus-candidate-item argus-candidate-empty">추가 후보 없음</li>
                )}
                {candidates.map((candidate, index) => {
                  const dimmed = candidate.probability < 10;
                  return (
                    <li
                      key={candidate.className}
                      className={`argus-candidate-item ${dimmed ? 'argus-candidate-dim' : ''}`}
                    >
                      <span className="argus-candidate-rank">#{index + 1}</span>
                      <span className="argus-candidate-name">{CLASS_NAMES_KR[candidate.className]}</span>
                      <span className="argus-candidate-prob">{candidate.probability.toFixed(1)}%</span>
                    </li>
                  );
                })}
              </ul>
            </div>
          </article>

          <div className="argus-right-stack">
            <article className="argus-aircraft-card">
              <h3 className="argus-card-title">평가</h3>
              <div className="argus-eval-head">
                <div className="argus-eval-main">
                  <p className="argus-metric-label">위험 (THREAT LEVEL)</p>
                  <span className={`argus-status-badge ${THREAT_BADGE_CLASS[selectedObject.riskLevel]}`}>
                    {selectedObject.riskLevel}
                  </span>
                </div>
                <p className={`argus-eval-threat-right ${THREAT_TEXT_CLASS[selectedObject.riskLevel]}`}>
                  {RISK_NAMES_KR[selectedObject.riskLevel]}
                </p>
              </div>

              <div className="argus-detail-list mt-2">
                <div className="argus-detail-row">
                  <span className="argus-detail-label">UAV 판정</span>
                  <span className={`argus-status-badge ${UAV_BADGE_CLASS[uavDecision]}`}>
                    {UAV_DECISION_NAMES[uavDecision]} {uavProbability.toFixed(1)}%
                  </span>
                </div>
                <div className="argus-detail-row">
                  <span className="argus-detail-label">신호 모델</span>
                  <span className="argus-detail-value">{selectedObject.inferenceModelVersion || '-'}</span>
                </div>
                <div className="argus-detail-row">
                  <span className="argus-detail-label">TOD YOLO</span>
                  <span className="argus-detail-value">
                    {todInference?.available
                      ? `${todClassLabel} ${todInference.confidence.toFixed(1)}%`
                      : '미입력/비활성'}
                  </span>
                </div>
                <div className="argus-detail-row">
                  <span className="argus-detail-label">TOD 모델</span>
                  <span className="argus-detail-value">{todInference?.modelVersion || '-'}</span>
                </div>
                <div className="argus-detail-row">
                  <span className="argus-detail-label">TOD 적용</span>
                  <span className={`argus-status-badge ${todUsageClass}`}>{todUsageLabel}</span>
                </div>
                <div className="argus-detail-row">
                  <span className="argus-detail-label">종합 출력</span>
                  <span className="argus-detail-value">
                    {combinedClassLabel} {combinedInference?.confidence?.toFixed(1) ?? confidence.toFixed(1)}%
                    {' · '}
                    {combinedSourceLabel}
                  </span>
                </div>
              </div>
            </article>

            <article className="argus-aircraft-card">
              <h3 className="argus-card-title">이동 정보</h3>
              <div className="argus-kpi-grid">
                <div className="argus-kpi-item">
                  <p className="argus-metric-label">거리 (m)</p>
                  <p className="argus-kpi-number">{selectedObject.distance.toFixed(1)}</p>
                </div>
                <div className="argus-kpi-item">
                  <p className="argus-metric-label">속력 (m/s)</p>
                  <p className="argus-kpi-number">{selectedObject.speed.toFixed(1)}</p>
                </div>
              </div>

              <div className="argus-detail-row mt-2">
                <span className="argus-detail-label flex items-center gap-1">
                  <Navigation className="w-3.5 h-3.5" />
                  좌표 (x, y, z)
                </span>
                <span className="argus-detail-value argus-mono">
                  ({selectedObject.position.x.toFixed(1)}, {selectedObject.position.y.toFixed(1)},{' '}
                  {selectedObject.position.z.toFixed(1)})
                </span>
              </div>
            </article>

            <article className="argus-aircraft-card">
              <h3 className="argus-card-title">레이더 점수</h3>
              <div className="argus-kpi-grid">
                <div className="argus-kpi-item">
                  <p className="argus-metric-label">score (%)</p>
                  <p className="argus-kpi-number">{radarScore.toFixed(1)}</p>
                </div>
                <div className="argus-kpi-item">
                  <p className="argus-metric-label">신뢰도 (%)</p>
                  <p className="argus-kpi-number">{confidence.toFixed(1)}</p>
                </div>
              </div>
              <div className="argus-detail-row mt-2">
                <span className="argus-detail-label">의미</span>
                <span className="argus-detail-value">표적 가능성 + 추적 신뢰도</span>
              </div>
            </article>
          </div>
        </div>
      </div>
    </section>
  );
}
