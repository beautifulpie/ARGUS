import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react';
import { DetectedObject } from '../types';
import { type LayoutDevConfig } from '../layoutDevConfig';

interface ObjectListTableProps {
  objects: DetectedObject[];
  selectedObjectId: string | null;
  onSelectObject: (id: string) => void;
  layoutDevConfig: LayoutDevConfig;
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

const escapeHtml = (value: string) =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');

const getAdaptiveFontClass = (value: string, compactAt = 11, tightAt = 17): string => {
  if (value.length >= tightAt) return 'text-[11px]';
  if (value.length >= compactAt) return 'text-xs';
  return 'text-[13px]';
};

export function ObjectListTable({
  objects,
  selectedObjectId,
  onSelectObject,
  layoutDevConfig,
}: ObjectListTableProps) {
  const [sortField, setSortField] = useState<SortField>('riskLevel');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  const expandedWindowRef = useRef<Window | null>(null);
  const tableScale = layoutDevConfig.tableFontScale;
  const scaledPx = (base: number) => `${(base * tableScale).toFixed(1)}px`;
  const scaledRem = (base: number) => `${(base * tableScale).toFixed(3)}rem`;

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
        return 'argus-non-uav-badge border-sky-700/60 bg-sky-950/30 text-sky-200';
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

  const getExpandedRiskColor = (riskLevel: string) => {
    switch (riskLevel) {
      case 'CRITICAL':
        return '#ef4444';
      case 'HIGH':
        return '#fb7185';
      case 'MEDIUM':
        return '#fb923c';
      case 'LOW':
      default:
        return '#94a3b8';
    }
  };

  const getExpandedRiskClass = (riskLevel: string) => {
    switch (riskLevel) {
      case 'CRITICAL':
        return 'risk-critical';
      case 'HIGH':
        return 'risk-high';
      case 'MEDIUM':
        return 'risk-medium';
      case 'LOW':
      default:
        return 'risk-low';
    }
  };

  const getExpandedUavClass = (decision?: string) => {
    switch (decision) {
      case 'UAV':
        return 'uav-positive';
      case 'NON_UAV':
        return 'uav-negative';
      default:
        return 'uav-unknown';
    }
  };

  const getExpandedStatusClass = (status: string) => {
    switch (status) {
      case 'STABLE':
        return 'status-stable';
      case 'TRACKING':
        return 'status-tracking';
      case 'CANDIDATE':
        return 'status-candidate';
      case 'NEW':
        return 'status-new';
      case 'LOST':
      default:
        return 'status-lost';
    }
  };

  const toCourseDegrees = (velocity: { x: number; y: number }) => {
    const angle = (Math.atan2(velocity.y, velocity.x) * 180) / Math.PI;
    return (angle + 360) % 360;
  };

  const renderExpandedWindowRows = (popup: Window) => {
    const doc = popup.document;
    if (!doc.getElementById('argus-expanded-tracks-root')) {
      doc.open();
      doc.write(`<!doctype html>
<html lang="ko">
  <head>
    <meta charset="utf-8" />
    <title>ARGUS - Tracked Objects Extended View</title>
    <style>
      @font-face {
        font-family: "ARGUS Korean";
        src: url('fonts/NotoSansCJKkr-Regular.otf') format('opentype');
        font-weight: 400;
        font-style: normal;
        font-display: swap;
      }
      @font-face {
        font-family: "ARGUS Korean";
        src: url('fonts/NotoSansCJKkr-Bold.otf') format('opentype');
        font-weight: 700;
        font-style: normal;
        font-display: swap;
      }
      :root { color-scheme: dark; }
      body {
        margin: 0;
        font-family: "ARGUS Korean", "Noto Sans CJK KR", "Malgun Gothic", "Segoe UI", sans-serif;
        background: linear-gradient(180deg, #050b12 0%, #03070e 100%);
        color: #e2e8f0;
      }
      .shell { padding: 14px 16px; }
      .header {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 12px;
        margin-bottom: 10px;
      }
      .title-main {
        font-size: 22px;
        font-weight: 800;
        letter-spacing: 0.04em;
        color: #67e8f9;
      }
      .title-sub {
        margin-top: 2px;
        font-size: 12px;
        color: #64748b;
      }
      .meta { text-align: right; }
      .count {
        font-family: "ARGUS Korean", "Noto Sans CJK KR", "Malgun Gothic", "Segoe UI", sans-serif;
        font-variant-numeric: tabular-nums;
        color: #93c5fd;
        font-size: 13px;
      }
      .updated {
        margin-top: 3px;
        font-size: 11px;
        color: #64748b;
      }
      .kpi-strip {
        display: grid;
        grid-template-columns: repeat(5, minmax(120px, 1fr));
        gap: 8px;
        margin-bottom: 10px;
      }
      .kpi-card {
        border: 1px solid rgba(100, 116, 139, 0.35);
        border-radius: 8px;
        background: rgba(10, 17, 28, 0.78);
        padding: 7px 9px;
      }
      .kpi-card span {
        font-size: 11px;
        color: #94a3b8;
      }
      .kpi-card strong {
        display: block;
        margin-top: 2px;
        font-size: 18px;
        line-height: 1.2;
        font-variant-numeric: tabular-nums;
      }
      .kpi-card.critical strong { color: #ef4444; }
      .kpi-card.high strong { color: #fb7185; }
      .kpi-card.uav strong { color: #f97316; }
      .kpi-card.nearest strong { color: #e2e8f0; }
      .kpi-card.average strong { color: #67e8f9; }
      .table-wrap {
        border: 1px solid rgba(34, 211, 238, 0.22);
        border-radius: 8px;
        overflow: auto;
        max-height: calc(100vh - 170px);
      }
      table {
        width: 100%;
        border-collapse: collapse;
        table-layout: fixed;
        min-width: 1940px;
        font-size: 13px;
        line-height: 1.4;
      }
      thead th {
        position: sticky;
        top: 0;
        background: #0b1725;
        color: #94a3b8;
        text-align: left;
        padding: 10px 12px;
        border-bottom: 1px solid rgba(148, 163, 184, 0.25);
        white-space: nowrap;
      }
      thead th.num-col { text-align: right; }
      tbody td {
        padding: 10px 12px;
        border-bottom: 1px solid rgba(148, 163, 184, 0.12);
        white-space: nowrap;
      }
      tbody tr:nth-child(odd) { background: #07111d; }
      tbody tr:nth-child(even) { background: #050d18; }
      tbody tr.critical-row td:first-child {
        box-shadow: inset 2px 0 0 #ef4444;
      }
      tbody tr.selected {
        outline: 1px solid rgba(34, 211, 238, 0.48);
        background: rgba(8, 47, 73, 0.35);
      }
      .num-val {
        text-align: right;
        font-family: "JetBrains Mono", "Consolas", monospace;
        font-variant-numeric: tabular-nums;
      }
      .risk {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        font-weight: 700;
      }
      .risk.risk-critical { color: #fecaca; }
      .risk.risk-high { color: #fecdd3; }
      .risk.risk-medium { color: #fed7aa; }
      .risk.risk-low { color: #cbd5e1; }
      .risk-dot {
        width: 9px;
        height: 9px;
        border-radius: 999px;
      }
      .badge {
        display: inline-flex;
        align-items: center;
        padding: 3px 8px;
        border-radius: 6px;
        border: 1px solid rgba(148, 163, 184, 0.35);
        font-size: 12px;
        font-weight: 700;
        gap: 6px;
      }
      .badge.uav-positive {
        border-color: rgba(248, 113, 113, 0.62);
        color: #fecaca;
        background: rgba(127, 29, 29, 0.45);
      }
      .badge.uav-negative {
        border-color: rgba(56, 189, 248, 0.62);
        color: #bae6fd;
        background: rgba(12, 74, 110, 0.35);
      }
      .badge.uav-unknown {
        border-color: rgba(251, 191, 36, 0.55);
        color: #fde68a;
        background: rgba(120, 53, 15, 0.32);
      }
      .status {
        display: inline-flex;
        align-items: center;
        padding: 3px 8px;
        border-radius: 6px;
        border: 1px solid rgba(148, 163, 184, 0.35);
        font-size: 12px;
        font-weight: 700;
      }
      .status.status-stable { color: #d1fae5; background: rgba(6, 78, 59, 0.35); border-color: rgba(16, 185, 129, 0.5); }
      .status.status-tracking { color: #bfdbfe; background: rgba(30, 64, 175, 0.3); border-color: rgba(96, 165, 250, 0.45); }
      .status.status-candidate { color: #fde68a; background: rgba(120, 53, 15, 0.3); border-color: rgba(251, 191, 36, 0.4); }
      .status.status-new { color: #e2e8f0; background: rgba(30, 41, 59, 0.44); border-color: rgba(148, 163, 184, 0.42); }
      .status.status-lost { color: #94a3b8; background: rgba(15, 23, 42, 0.45); border-color: rgba(71, 85, 105, 0.45); }
      .geo {
        font-family: "JetBrains Mono", "Consolas", monospace;
        color: #cbd5e1;
      }
      .model {
        max-width: 220px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        color: #94a3b8;
      }
      .truncate-cell {
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .compact {
        font-size: 12px;
      }
      .tight {
        font-size: 11px;
      }
      .empty {
        text-align: center;
        color: #64748b;
        padding: 26px 12px;
      }
    </style>
  </head>
  <body>
    <div class="shell" id="argus-expanded-tracks-root">
      <div class="header">
        <div>
          <div class="title-main">추적된 객체 · 확장 보기</div>
          <div class="title-sub">위협 > UAV 판정 > 이동 정보 > 세부 정보 순으로 확인</div>
        </div>
        <div class="meta">
          <div class="count" id="argus-expanded-count">0 활성</div>
          <div class="updated" id="argus-expanded-updated">업데이트 -</div>
        </div>
      </div>
      <div class="kpi-strip">
        <div class="kpi-card critical"><span>치명 위협</span><strong id="argus-expanded-critical">0</strong></div>
        <div class="kpi-card high"><span>고위험</span><strong id="argus-expanded-high">0</strong></div>
        <div class="kpi-card uav"><span>UAV 판정</span><strong id="argus-expanded-uav">0</strong></div>
        <div class="kpi-card nearest"><span>최근접 거리 (m)</span><strong id="argus-expanded-nearest">-</strong></div>
        <div class="kpi-card average"><span>평균 속도 (m/s)</span><strong id="argus-expanded-avg-speed">-</strong></div>
      </div>
      <div class="table-wrap">
        <table>
          <colgroup>
            <col style="width:7%" />
            <col style="width:10%" />
            <col style="width:7%" />
            <col style="width:8%" />
            <col style="width:7%" />
            <col style="width:7%" />
            <col style="width:7%" />
            <col style="width:7%" />
            <col style="width:7%" />
            <col style="width:9%" />
            <col style="width:7%" />
            <col style="width:10%" />
            <col style="width:7%" />
            <col style="width:7%" />
            <col style="width:10%" />
          </colgroup>
          <thead>
            <tr>
              <th>위험</th>
              <th>UAV 판정</th>
              <th>ID</th>
              <th>클래스</th>
              <th class="num-col">거리 (m)</th>
              <th class="num-col">속도 (m/s)</th>
              <th class="num-col">고도 (m)</th>
              <th class="num-col">추적 (s)</th>
              <th class="num-col">신뢰도 (%)</th>
              <th class="num-col">치수 L×W×H (m)</th>
              <th class="num-col">진행각 (°)</th>
              <th>좌표 (lat, lon)</th>
              <th>상태</th>
              <th class="num-col">추론 (ms)</th>
              <th>모델</th>
            </tr>
          </thead>
          <tbody id="argus-expanded-tracks-body"></tbody>
        </table>
      </div>
    </div>
  </body>
</html>`);
      doc.close();

      // Popup does not inherit the main window's font-face rules by default.
      // Clone runtime stylesheets once so Korean fonts render consistently.
      const parentStyleNodes = Array.from(
        window.document.querySelectorAll('link[rel="stylesheet"], style')
      );
      parentStyleNodes.forEach((node) => {
        if (node instanceof HTMLLinkElement) {
          if (!node.href) return;
          const link = doc.createElement('link');
          link.rel = 'stylesheet';
          link.href = node.href;
          link.setAttribute('data-argus-popup-cloned-style', 'true');
          doc.head.appendChild(link);
          return;
        }

        const style = doc.createElement('style');
        style.textContent = node.textContent;
        style.setAttribute('data-argus-popup-cloned-style', 'true');
        doc.head.appendChild(style);
      });
    }

    const body = doc.getElementById('argus-expanded-tracks-body');
    const count = doc.getElementById('argus-expanded-count');
    const updated = doc.getElementById('argus-expanded-updated');
    const criticalCountNode = doc.getElementById('argus-expanded-critical');
    const highCountNode = doc.getElementById('argus-expanded-high');
    const uavCountNode = doc.getElementById('argus-expanded-uav');
    const nearestNode = doc.getElementById('argus-expanded-nearest');
    const avgSpeedNode = doc.getElementById('argus-expanded-avg-speed');
    if (!body || !count) return;

    const criticalCount = sortedObjects.filter((obj) => obj.riskLevel === 'CRITICAL').length;
    const highCount = sortedObjects.filter((obj) => obj.riskLevel === 'HIGH').length;
    const uavCount = sortedObjects.filter((obj) => obj.uavDecision === 'UAV').length;
    const nearestDistance =
      sortedObjects.length > 0 ? Math.min(...sortedObjects.map((obj) => obj.distance)).toFixed(1) : '-';
    const avgSpeed =
      sortedObjects.length > 0
        ? (sortedObjects.reduce((sum, obj) => sum + obj.speed, 0) / sortedObjects.length).toFixed(1)
        : '-';

    const rows = sortedObjects
      .map((obj) => {
        const riskLabel = RISK_NAMES_KR[obj.riskLevel] ?? obj.riskLevel;
        const riskColor = getExpandedRiskColor(obj.riskLevel);
        const riskClass = getExpandedRiskClass(obj.riskLevel);
        const uavClass = getExpandedUavClass(obj.uavDecision);
        const statusClass = getExpandedStatusClass(obj.status);
        const uavLabel =
          obj.uavDecision === 'UAV' ? 'UAV' : obj.uavDecision === 'NON_UAV' ? 'NON-UAV' : 'UNKNOWN';
        const classLabel = CLASS_NAMES_KR[obj.class] ?? obj.class;
        const statusLabel = STATUS_NAMES_KR[obj.status] ?? obj.status;
        const selectedClass = obj.id === selectedObjectId ? 'selected' : '';
        const criticalClass = obj.riskLevel === 'CRITICAL' ? 'critical-row' : '';
        const rowClass = [selectedClass, criticalClass].filter(Boolean).join(' ');
        const sizeLabel = `${obj.size.length.toFixed(1)} x ${obj.size.width.toFixed(1)} x ${obj.size.height.toFixed(1)}`;
        const course = toCourseDegrees(obj.velocity).toFixed(1);
        const geoLabel = obj.geoPosition
          ? `${obj.geoPosition.lat.toFixed(4)}, ${obj.geoPosition.lon.toFixed(4)}`
          : '-';
        const modelLabel = obj.inferenceModelVersion || '-';
        const classCellClass = classLabel.length >= 10 ? 'tight' : classLabel.length >= 7 ? 'compact' : '';
        const geoCellClass = geoLabel.length >= 18 ? 'tight' : '';
        const modelCellClass = modelLabel.length >= 16 ? 'tight' : modelLabel.length >= 12 ? 'compact' : '';
        return `<tr class="${rowClass}">
  <td><span class="risk ${riskClass}"><span class="risk-dot" style="background:${riskColor}"></span>${escapeHtml(riskLabel)}</span></td>
  <td><span class="badge ${uavClass}">${escapeHtml(uavLabel)} ${(obj.uavProbability ?? 0).toFixed(1)}%</span></td>
  <td class="num-val truncate-cell" style="text-align:left">${escapeHtml(obj.id)}</td>
  <td class="truncate-cell ${classCellClass}">${escapeHtml(classLabel)}</td>
  <td class="num-val">${obj.distance.toFixed(1)}</td>
  <td class="num-val">${obj.speed.toFixed(1)}</td>
  <td class="num-val">${obj.position.z.toFixed(1)}</td>
  <td class="num-val">${obj.trackingDuration.toFixed(1)}</td>
  <td class="num-val">${obj.confidence.toFixed(1)}</td>
  <td class="num-val">${sizeLabel}</td>
  <td class="num-val">${course}</td>
  <td class="geo truncate-cell ${geoCellClass}">${escapeHtml(geoLabel)}</td>
  <td><span class="status ${statusClass}">${escapeHtml(statusLabel)}</span></td>
  <td class="num-val">${(obj.inferenceLatencyMs ?? 0).toFixed(1)}</td>
  <td><span class="model ${modelCellClass}">${escapeHtml(modelLabel)}</span></td>
</tr>`;
      })
      .join('');

    body.innerHTML =
      rows ||
      '<tr><td class="empty" colspan="15">감지된 객체 없음</td></tr>';
    count.textContent = `${objects.length} 활성`;
    if (updated) {
      updated.textContent = `업데이트 ${new Date().toLocaleTimeString('ko-KR', { hour12: false })}`;
    }
    if (criticalCountNode) {
      criticalCountNode.textContent = String(criticalCount);
    }
    if (highCountNode) {
      highCountNode.textContent = String(highCount);
    }
    if (uavCountNode) {
      uavCountNode.textContent = String(uavCount);
    }
    if (nearestNode) {
      nearestNode.textContent = nearestDistance;
    }
    if (avgSpeedNode) {
      avgSpeedNode.textContent = avgSpeed;
    }
    popup.document.title = `ARGUS - Tracked Objects (${objects.length})`;
  };

  const openExpandedWindow = () => {
    let popup = expandedWindowRef.current;
    if (!popup || popup.closed) {
      const desiredWidth = Math.min(1520, Math.max(980, window.screen.availWidth - 120));
      const desiredHeight = Math.min(920, Math.max(620, window.screen.availHeight - 120));
      const popupLeft = Math.max(
        0,
        Math.floor(window.screenX + (window.outerWidth - desiredWidth) / 2 + 28)
      );
      const popupTop = Math.max(
        0,
        Math.floor(window.screenY + Math.max(24, (window.outerHeight - desiredHeight) * 0.12))
      );
      popup = window.open(
        '',
        'argus-tracked-objects-window',
        `width=${desiredWidth},height=${desiredHeight},left=${popupLeft},top=${popupTop},menubar=no,toolbar=no,location=no,status=no,resizable=yes,scrollbars=yes`
      );
      if (!popup) return;
      expandedWindowRef.current = popup;
      popup.onbeforeunload = () => {
        expandedWindowRef.current = null;
      };
    }

    popup.focus();
    renderExpandedWindowRows(popup);
  };

  useEffect(() => {
    const popup = expandedWindowRef.current;
    if (!popup || popup.closed) {
      if (popup?.closed) {
        expandedWindowRef.current = null;
      }
      return;
    }
    renderExpandedWindowRows(popup);
  }, [objects.length, selectedObjectId, sortedObjects]);

  useEffect(() => {
    return () => {
      const popup = expandedWindowRef.current;
      if (popup && !popup.closed) {
        popup.close();
      }
      expandedWindowRef.current = null;
    };
  }, []);

  return (
    <div
      className="argus-object-table argus-surface h-full bg-[#0b1016] border-b border-cyan-950/50 flex flex-col relative overflow-hidden"
      style={{ ['--argus-table-font-scale' as string]: String(layoutDevConfig.tableFontScale) }}
    >
      <div className="argus-section-header px-6 py-4 border-b border-cyan-950/50 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <h2
            className="argus-object-table-title text-2xl font-bold text-cyan-300 uppercase tracking-[0.08em] whitespace-nowrap"
            style={{ fontSize: scaledRem(1.5) }}
          >
            추적된 객체
          </h2>
          <span className="argus-object-table-count inline-flex items-center rounded border border-cyan-700/60 bg-cyan-950/30 px-2.5 py-1 text-sm font-semibold text-cyan-200 tabular-nums whitespace-nowrap" style={{ fontSize: scaledPx(14) }}>
            {objects.length} 활성
          </span>
        </div>
        <button
          type="button"
          onClick={openExpandedWindow}
          className="argus-expand-view-button h-9 shrink-0 rounded border border-cyan-700/70 bg-[#0b1822] px-3 text-sm font-semibold text-cyan-200 hover:bg-[#132537] transition-colors"
          style={{ fontSize: scaledPx(14) }}
        >
          확장 보기
        </button>
      </div>

      <div className="flex-1 overflow-auto">
          <table className="argus-data-table w-full table-fixed text-[13px] leading-[1.35]" style={{ fontSize: scaledPx(13) }}>
          <colgroup>
            <col style={{ width: '10%' }} />
            <col style={{ width: '18%' }} />
            <col style={{ width: '12%' }} />
            <col style={{ width: '12%' }} />
            <col style={{ width: '11%' }} />
            <col style={{ width: '11%' }} />
            <col style={{ width: '10%' }} />
            <col style={{ width: '9%' }} />
            <col style={{ width: '7%' }} />
          </colgroup>
          <thead className="sticky top-0 z-10 bg-[#0f161f]/95 backdrop-blur border-b border-slate-700/70">
            <tr className="text-slate-400 uppercase tracking-[0.08em]" style={{ fontSize: scaledPx(13) }}>
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
              const uavLabel =
                obj.uavDecision === 'UAV'
                  ? 'UAV'
                  : obj.uavDecision === 'NON_UAV'
                    ? 'NON-UAV'
                    : 'UNKNOWN';
              const classLabel = CLASS_NAMES_KR[obj.class] ?? obj.class;
              const statusLabel = STATUS_NAMES_KR[obj.status] ?? obj.status;
              const idClass = getAdaptiveFontClass(obj.id, 9, 13);
              const classLabelClass = getAdaptiveFontClass(classLabel, 8, 12);
              const statusClass = getAdaptiveFontClass(statusLabel, 5, 9);
              const probLabel = `${(obj.uavProbability ?? 0).toFixed(1)}%`;
              const probClass = getAdaptiveFontClass(probLabel, 6, 10);
              const sizeLabel = `${obj.size.length.toFixed(1)} x ${obj.size.width.toFixed(1)}`;
              const sizeClass = getAdaptiveFontClass(sizeLabel, 11, 16);

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
                  <td className="px-4 py-3.5 overflow-hidden">
                    <span
                      className={`inline-flex max-w-full items-center px-2.5 py-1 border rounded-sm text-xs font-semibold whitespace-nowrap truncate ${riskBadge.className}`}
                    >
                      {riskBadge.label}
                    </span>
                  </td>
                  <td className="px-4 py-3.5 overflow-hidden">
                    <div className="flex items-center gap-2 min-w-0">
                      <span
                        className={`inline-flex min-w-0 max-w-[96px] items-center px-2.5 py-1 border rounded-sm text-xs font-semibold whitespace-nowrap truncate ${getUavBadge(obj.uavDecision)}`}
                      >
                        {uavLabel}
                      </span>
                      <span className={`min-w-0 truncate font-mono tabular-nums text-slate-400 ${probClass}`}>
                        {probLabel}
                      </span>
                    </div>
                  </td>
                  <td className="px-4 py-3.5 overflow-hidden">
                    <span className={`block truncate font-mono tabular-nums text-slate-100 ${idClass}`}>
                      {obj.id}
                    </span>
                  </td>
                  <td className="px-4 py-3.5 text-slate-200 overflow-hidden">
                    <span className={`block truncate ${classLabelClass}`}>{classLabel}</span>
                  </td>
                  <td className="px-4 py-3.5 text-right overflow-hidden">
                    <span className="block truncate font-mono tabular-nums text-slate-200 text-xs sm:text-[13px]">
                      {obj.distance.toFixed(1)}
                    </span>
                  </td>
                  <td className="px-4 py-3.5 text-right overflow-hidden">
                    <span className="block truncate font-mono tabular-nums text-slate-200 text-xs sm:text-[13px]">
                      {obj.speed.toFixed(1)}
                    </span>
                  </td>
                  <td className="px-4 py-3.5 text-right overflow-hidden">
                    <span className="block truncate font-mono tabular-nums text-slate-200 text-xs sm:text-[13px]">
                      {obj.confidence.toFixed(1)}
                    </span>
                  </td>
                  <td className="px-4 py-3.5 text-right overflow-hidden">
                    <span className={`block truncate font-mono tabular-nums text-slate-300 text-xs ${sizeClass}`}>
                      {sizeLabel}
                    </span>
                  </td>
                  <td className="px-4 py-3.5 overflow-hidden">
                    <span
                      className={`inline-flex max-w-full items-center px-2.5 py-1 border rounded-sm font-semibold uppercase tracking-[0.06em] whitespace-nowrap truncate ${statusClass} ${getStatusBadge(obj.status)}`}
                    >
                      {statusLabel}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {objects.length === 0 && (
          <div className="flex items-center justify-center h-36">
            <p className="text-base text-slate-500" style={{ fontSize: scaledRem(1) }}>감지된 객체 없음</p>
          </div>
        )}
      </div>
    </div>
  );
}
