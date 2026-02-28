import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, Clock3, FolderOpen, Image as ImageIcon, Loader2, X } from 'lucide-react';
import {
  CombinedInferenceResult,
  DetectedObject,
  ObjectClass,
  TodClassProbability,
  TodInferenceResult,
} from '../types';

interface TodDataDialogProps {
  open: boolean;
  selectedObject: DetectedObject;
  onClose: () => void;
  onApplyResult: (payload: {
    trackId: string;
    todInference: TodInferenceResult;
    combinedInference: CombinedInferenceResult;
  }) => void;
}

interface TodMediaEntry {
  entryId: string;
  todId: string;
  observedAt: Date;
  observedCode: string;
  fileName: string;
  mediaPath?: string;
  previewUrl: string;
  status: 'READY' | 'ANALYZING' | 'DONE' | 'ERROR';
  inference?: TodInferenceResult;
  combinedInference?: CombinedInferenceResult;
  errorMessage?: string;
}

interface TodDirectoryEntry {
  id?: string;
  fileName?: string;
  mediaPath?: string;
  todId?: string;
  observedCode?: string;
  observedAt?: string;
  modifiedAtMs?: number;
}

interface TodDirectoryListResult {
  ok?: boolean;
  directory?: string;
  entries?: TodDirectoryEntry[] | null;
  error?: string;
}

interface TodInferPayload {
  mediaPath?: string;
  trackId?: string;
  timeoutMs?: number;
}

interface TodInferResult {
  ok?: boolean;
  status?: number;
  error?: string;
  result?: unknown;
}

interface RadarRuntimeBridge {
  listTodEntries?: (
    payload?: { directory?: string }
  ) => Promise<TodDirectoryListResult | null | undefined>;
  inferTodPath?: (payload: TodInferPayload) => Promise<TodInferResult | null | undefined>;
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

const toRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;

const toConfidencePercent = (value: unknown, fallback = 0): number => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  const normalized = numeric <= 1 ? numeric * 100 : numeric;
  return Math.min(100, Math.max(0, normalized));
};

const normalizeObjectClass = (value: unknown): ObjectClass | 'UNKNOWN' => {
  const raw = String(value ?? '')
    .trim()
    .toUpperCase()
    .replaceAll('-', '_')
    .replaceAll(' ', '_');
  if (!raw) return 'UNKNOWN';

  const aliasMap: Record<string, ObjectClass | 'UNKNOWN'> = {
    UAV: 'UAV',
    DRONE: 'UAV',
    HELICOPTER: 'HELICOPTER',
    HELI: 'HELICOPTER',
    HIGHSPEED: 'HIGHSPEED',
    HIGH_SPEED: 'HIGHSPEED',
    BIRD: 'BIRD',
    BIRD_FLOCK: 'BIRD_FLOCK',
    BIRDFLOCK: 'BIRD_FLOCK',
    CIVIL_AIR: 'CIVIL_AIR',
    CIVILAIR: 'CIVIL_AIR',
    CIVIL: 'CIVIL_AIR',
    FIGHTER: 'FIGHTER',
    JET: 'FIGHTER',
    UNKNOWN: 'UNKNOWN',
  };

  return aliasMap[raw] ?? 'UNKNOWN';
};

const toFileUrl = (rawPath: string): string => {
  if (!rawPath) return '';
  const normalized = rawPath.replace(/\\/g, '/');
  if (/^file:\/\//i.test(normalized)) return normalized;
  if (/^[A-Za-z]:\//.test(normalized)) {
    return `file:///${encodeURI(normalized)}`;
  }
  if (normalized.startsWith('/')) {
    return `file://${encodeURI(normalized)}`;
  }
  return `file://${encodeURI(`/${normalized}`)}`;
};

const pad2 = (value: number) => String(value).padStart(2, '0');

const formatObservedCode = (date: Date) =>
  `${pad2(date.getDate())}${pad2(date.getHours())}${pad2(date.getMinutes())}${pad2(date.getSeconds())}`;

const parseObservedDate = (raw: unknown): Date => {
  const candidate = typeof raw === 'string' || typeof raw === 'number' ? new Date(raw) : new Date();
  if (Number.isNaN(candidate.getTime())) {
    return new Date();
  }
  return candidate;
};

const MOCK_TOD_KEYWORDS = ['uav', 'heli', 'fighter', 'bird', 'civil', 'highspeed'] as const;

const buildMockPreviewUrl = (todId: string, observedCode: string, index: number): string => {
  const hue = (index * 47 + 192) % 360;
  const hue2 = (hue + 38) % 360;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180" viewBox="0 0 320 180">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="hsl(${hue} 62% 22%)" />
      <stop offset="100%" stop-color="hsl(${hue2} 58% 12%)" />
    </linearGradient>
  </defs>
  <rect width="320" height="180" fill="url(#bg)" />
  <rect x="8" y="8" width="304" height="164" rx="8" fill="none" stroke="rgba(160,220,255,0.45)" stroke-dasharray="6 4" />
  <text x="16" y="34" fill="#d8f5ff" font-family="sans-serif" font-size="18" font-weight="700">${todId}</text>
  <text x="16" y="58" fill="#9dd4ea" font-family="sans-serif" font-size="12">MOCK TOD FRAME</text>
  <text x="16" y="162" fill="#9dd4ea" font-family="monospace" font-size="11">${observedCode}</text>
</svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
};

const buildMockTodEntries = (trackId: string, count = 8): TodMediaEntry[] => {
  const now = Date.now();
  return Array.from({ length: count }, (_, index) => {
    const observedAt = new Date(now - index * 38_000);
    const observedCode = formatObservedCode(observedAt);
    const todId = `TOD-MOCK-${String(index + 1).padStart(4, '0')}`;
    const keyword = MOCK_TOD_KEYWORDS[index % MOCK_TOD_KEYWORDS.length];
    const fileName = `${todId.toLowerCase()}_${keyword}_${observedCode}.jpg`;
    return {
      entryId: `${trackId}-mock-${index + 1}`,
      todId,
      observedAt,
      observedCode,
      fileName,
      mediaPath: '',
      previewUrl: buildMockPreviewUrl(todId, observedCode, index),
      status: 'READY' as const,
    };
  });
};

const mapTodProbabilities = (raw: unknown): TodClassProbability[] => {
  if (!Array.isArray(raw)) return [];
  const mapped = raw
    .map((candidate) => {
      const record = toRecord(candidate);
      if (!record) return null;
      const className = normalizeObjectClass(
        record.className ?? record.class ?? record.label ?? record.name ?? 'UNKNOWN'
      );
      const probability = toConfidencePercent(
        record.probability ?? record.confidence ?? record.score ?? 0,
        0
      );
      return {
        className,
        probability,
      } as TodClassProbability;
    })
    .filter((candidate): candidate is TodClassProbability => candidate !== null);

  return mapped.sort((a, b) => b.probability - a.probability).slice(0, 5);
};

const buildCombinedInference = (
  selectedObject: DetectedObject,
  todInference: TodInferenceResult
): CombinedInferenceResult => {
  const signalClass = selectedObject.signalInference?.class ?? selectedObject.class;
  const signalConfidence = selectedObject.signalInference?.confidence ?? selectedObject.confidence;
  const todClass = todInference.available ? todInference.className : 'UNKNOWN';
  const todConfidence = todInference.available ? todInference.confidence : 0;
  const todPriorityThreshold = 65;
  const selectedSource =
    todInference.available && todClass !== 'UNKNOWN' && todConfidence >= todPriorityThreshold
      ? 'TOD_YOLO'
      : 'RADAR_SIGNAL';

  const className = selectedSource === 'TOD_YOLO' ? todClass : signalClass;
  const confidence = selectedSource === 'TOD_YOLO' ? todConfidence : signalConfidence;

  return {
    selectedSource,
    className,
    confidence,
    signalClass,
    signalConfidence,
    todClass,
    todConfidence,
    agreement: todInference.available ? todClass === signalClass : null,
    policy: `TOD_IF_CONFIDENCE>=${todPriorityThreshold.toFixed(1)}`,
  };
};

const buildMockTodInference = (
  selectedObject: DetectedObject,
  fileName: string,
  sourcePath: string
): TodInferenceResult => {
  const keyword = fileName.toLowerCase();
  let className: ObjectClass | 'UNKNOWN' = 'UNKNOWN';
  if (keyword.includes('uav') || keyword.includes('drone')) className = 'UAV';
  else if (keyword.includes('bird') || keyword.includes('flock')) className = 'BIRD_FLOCK';
  else if (keyword.includes('heli')) className = 'HELICOPTER';
  else if (keyword.includes('fighter') || keyword.includes('jet')) className = 'FIGHTER';
  else if (keyword.includes('civil') || keyword.includes('air')) className = 'CIVIL_AIR';
  else if (keyword.includes('high') || keyword.includes('fast')) className = 'HIGHSPEED';
  else className = selectedObject.class;

  const confidence = Math.min(99, Math.max(55, selectedObject.confidence + (Math.random() - 0.5) * 16));
  const secondClass: ObjectClass = className === 'UAV' ? 'HELICOPTER' : 'UAV';
  const thirdClass: ObjectClass = className === 'BIRD_FLOCK' ? 'BIRD' : 'BIRD_FLOCK';
  const probabilities: TodClassProbability[] = [
    { className, probability: confidence },
    { className: secondClass, probability: Math.max(1, (100 - confidence) * 0.58) },
    { className: thirdClass, probability: Math.max(1, (100 - confidence) * 0.32) },
  ].sort((a, b) => b.probability - a.probability);

  return {
    available: true,
    className,
    confidence,
    probabilities,
    detectionCount: className === 'BIRD_FLOCK' ? 4 : 1,
    sourcePath,
    sourceType: 'IMAGE',
    modelId: 'tod-yolo-mock',
    modelVersion: 'tod-yolo-mock-v1',
    latencyMs: Math.round(24 + Math.random() * 36),
    reason: 'mock_fallback_no_runtime',
  };
};

const mapRuntimeTodInference = (
  rawResult: unknown,
  fallbackPath: string
): TodInferenceResult => {
  const root = toRecord(rawResult) ?? {};
  const level1 = toRecord(root.result ?? root.data) ?? root;
  const payload = toRecord(level1.result ?? level1.data) ?? level1;

  const className = normalizeObjectClass(
    payload.className ?? payload.class ?? payload.label ?? payload.name ?? 'UNKNOWN'
  );
  const confidence = toConfidencePercent(payload.confidence ?? payload.score ?? 0, 0);
  const probabilities = mapTodProbabilities(payload.probabilities ?? payload.candidates);

  return {
    available: Boolean(payload.available),
    className,
    confidence,
    probabilities:
      probabilities.length > 0
        ? probabilities
        : [{ className, probability: confidence }],
    detectionCount: Math.max(0, Math.floor(Number(payload.detectionCount ?? payload.count ?? 0) || 0)),
    sourcePath: String(payload.sourcePath ?? payload.mediaPath ?? fallbackPath ?? ''),
    sourceType:
      payload.sourceType === 'VIDEO' || payload.sourceType === 'IMAGE' || payload.sourceType === 'UNKNOWN'
        ? payload.sourceType
        : 'IMAGE',
    decodedPath:
      typeof payload.decodedPath === 'string' && payload.decodedPath.trim()
        ? payload.decodedPath
        : undefined,
    decoderUsed: typeof payload.decoderUsed === 'boolean' ? payload.decoderUsed : undefined,
    decoderLatencyMs: Number.isFinite(Number(payload.decoderLatencyMs))
      ? Number(payload.decoderLatencyMs)
      : undefined,
    modelId: String(payload.modelId ?? payload.activeModelId ?? 'tod-yolo'),
    modelVersion: String(payload.modelVersion ?? payload.version ?? 'tod-yolo'),
    latencyMs: Number.isFinite(Number(payload.latencyMs)) ? Number(payload.latencyMs) : 0,
    cacheHit: typeof payload.cacheHit === 'boolean' ? payload.cacheHit : undefined,
    reason:
      typeof payload.reason === 'string' && payload.reason.trim() ? payload.reason : undefined,
  };
};

export function TodDataDialog({
  open,
  selectedObject,
  onClose,
  onApplyResult,
}: TodDataDialogProps) {
  const [entries, setEntries] = useState<TodMediaEntry[]>([]);
  const [errorMessage, setErrorMessage] = useState('');
  const [isPicking, setIsPicking] = useState(false);
  const [sourceDirectory, setSourceDirectory] = useState('');
  const [isMockSource, setIsMockSource] = useState(false);
  const [appliedEntryId, setAppliedEntryId] = useState<string | null>(null);
  const todSequenceRef = useRef(0);

  const runtime = (window as Window & { radarRuntime?: RadarRuntimeBridge }).radarRuntime;

  useEffect(() => {
    // Track changed: clear previous TOD picks to avoid cross-track mixup.
    todSequenceRef.current = 0;
    setEntries([]);
    setAppliedEntryId(null);
    setErrorMessage('');
    setSourceDirectory('');
    setIsMockSource(false);
  }, [selectedObject.id]);

  const readyCount = useMemo(
    () => entries.filter((entry) => entry.status === 'READY' || entry.status === 'DONE').length,
    [entries]
  );
  const doneCount = useMemo(
    () => entries.filter((entry) => entry.status === 'DONE').length,
    [entries]
  );

  const nextTodId = () => {
    todSequenceRef.current += 1;
    return `TOD-${String(todSequenceRef.current).padStart(4, '0')}`;
  };

  const mapRuntimeEntry = (entry: TodDirectoryEntry, index: number): TodMediaEntry | null => {
    const mediaPath = typeof entry.mediaPath === 'string' && entry.mediaPath.trim() ? entry.mediaPath.trim() : '';
    if (!mediaPath) return null;
    const fileName =
      typeof entry.fileName === 'string' && entry.fileName.trim()
        ? entry.fileName.trim()
        : mediaPath.replace(/\\/g, '/').split('/').pop() || `tod-${index + 1}`;
    const observedAt = parseObservedDate(entry.observedAt);
    const observedCode =
      typeof entry.observedCode === 'string' && /^\d{8}$/.test(entry.observedCode)
        ? entry.observedCode
        : formatObservedCode(observedAt);
    const todId =
      typeof entry.todId === 'string' && entry.todId.trim()
        ? entry.todId.trim()
        : nextTodId();
    const normalizedPath = mediaPath.replace(/\\/g, '/');

    return {
      entryId:
        typeof entry.id === 'string' && entry.id.trim()
          ? entry.id.trim()
          : `${normalizedPath}-${Math.floor(observedAt.getTime())}`,
      todId,
      observedAt,
      observedCode,
      fileName,
      mediaPath: normalizedPath,
      previewUrl: toFileUrl(normalizedPath),
      status: 'READY',
    };
  };

  const loadMockEntries = (message?: string) => {
    setSourceDirectory('mock://tod');
    setIsMockSource(true);
    setEntries((prev) => {
      const nextMock = buildMockTodEntries(selectedObject.id);
      const prevById = new Map(prev.map((entry) => [entry.entryId, entry]));
      return nextMock.map((entry) => {
        const existing = prevById.get(entry.entryId);
        if (!existing) return entry;
        return {
          ...entry,
          status: existing.status === 'ANALYZING' ? 'READY' : existing.status,
          inference: existing.inference,
          combinedInference: existing.combinedInference,
          errorMessage: existing.errorMessage,
        };
      });
    });
    setErrorMessage(message || '');
  };

  const handleRefreshTodData = async () => {
    setErrorMessage('');

    if (!runtime || typeof runtime.listTodEntries !== 'function') {
      loadMockEntries('실시간 TOD 디렉터리 연결이 없어 목업 목록을 표시합니다.');
      return;
    }

    try {
      setIsPicking(true);
      const response = await runtime.listTodEntries();
      if (!response || response.ok === false) {
        loadMockEntries(`TOD 목록 조회 실패: ${response?.error || '알 수 없는 오류'} (목업 목록으로 전환)`);
        return;
      }

      const directory = typeof response.directory === 'string' ? response.directory : '';
      const rawEntries = Array.isArray(response.entries) ? response.entries : [];
      const mappedEntries = rawEntries
        .map((entry, index) => mapRuntimeEntry(entry, index))
        .filter((entry): entry is TodMediaEntry => entry !== null);

      if (mappedEntries.length === 0) {
        loadMockEntries('TOD 디렉터리가 비어 있어 목업 목록을 표시합니다.');
        return;
      }

      setIsMockSource(false);
      setSourceDirectory(directory);
      setEntries((prev) => {
        const prevByPath = new Map(
          prev.map((entry) => [(entry.mediaPath || entry.fileName).toLowerCase(), entry])
        );

        return mappedEntries.map((entry) => {
          const existing = prevByPath.get((entry.mediaPath || entry.fileName).toLowerCase());
          if (!existing) return entry;
          return {
            ...entry,
            status: existing.status === 'ANALYZING' ? 'READY' : existing.status,
            inference: existing.inference,
            combinedInference: existing.combinedInference,
            errorMessage: existing.errorMessage,
          };
        });
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : '알 수 없는 오류';
      loadMockEntries(`TOD 목록 조회 실패: ${reason} (목업 목록으로 전환)`);
    } finally {
      setIsPicking(false);
    }
  };

  useEffect(() => {
    if (!open) return;
    void handleRefreshTodData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, selectedObject.id]);

  const updateEntry = (
    entryId: string,
    patch: Partial<TodMediaEntry> | ((prev: TodMediaEntry) => Partial<TodMediaEntry>)
  ) => {
    setEntries((prev) =>
      prev.map((entry) => {
        if (entry.entryId !== entryId) return entry;
        const nextPatch = typeof patch === 'function' ? patch(entry) : patch;
        return {
          ...entry,
          ...nextPatch,
        };
      })
    );
  };

  const runTodAnalysis = async (entry: TodMediaEntry) => {
    updateEntry(entry.entryId, {
      status: 'ANALYZING',
      errorMessage: '',
    });

    try {
      let todInference: TodInferenceResult;
      if (runtime && typeof runtime.inferTodPath === 'function' && entry.mediaPath) {
        const response = await runtime.inferTodPath({
          mediaPath: entry.mediaPath,
          trackId: selectedObject.id,
          timeoutMs: 15000,
        });

        if (!response || response.ok === false) {
          const reason = response?.error || 'ARGUS-Brain TOD 분석에 실패했습니다.';
          throw new Error(reason);
        }

        todInference = mapRuntimeTodInference(response.result ?? response, entry.mediaPath);
      } else {
        const mockPath = entry.mediaPath ?? entry.fileName;
        todInference = buildMockTodInference(selectedObject, entry.fileName, mockPath);
      }

      const combinedInference = buildCombinedInference(selectedObject, todInference);
      updateEntry(entry.entryId, {
        status: 'DONE',
        inference: todInference,
        combinedInference,
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'TOD 분석 실패';
      updateEntry(entry.entryId, {
        status: 'ERROR',
        errorMessage: reason,
      });
    }
  };

  const handleApplyInference = (entry: TodMediaEntry) => {
    if (!entry.inference || !entry.combinedInference) return;
    onApplyResult({
      trackId: selectedObject.id,
      todInference: entry.inference,
      combinedInference: entry.combinedInference,
    });
    setAppliedEntryId(entry.entryId);
    setErrorMessage('');
  };

  const handleRemoveEntry = (entry: TodMediaEntry) => {
    setEntries((prev) => prev.filter((item) => item.entryId !== entry.entryId));
    if (appliedEntryId === entry.entryId) {
      setAppliedEntryId(null);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[140] flex items-center justify-center p-4">
      <button
        type="button"
        aria-label="TOD 분석 창 닫기 배경"
        className="absolute inset-0 bg-[#05080d]/84 backdrop-blur-[2px]"
        onClick={onClose}
      />
      <div className="argus-surface relative w-full max-w-5xl max-h-[92vh] overflow-auto rounded-lg border border-cyan-900/70 bg-[#0a1118] shadow-2xl shadow-black/70">
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-cyan-950/60 bg-[#0b141d] px-5 py-3">
          <div className="min-w-0">
            <h2 className="text-cyan-200 font-semibold tracking-wide">TOD 데이터 추가 분석</h2>
            <p className="text-xs text-slate-400 mt-0.5">
              트랙 {selectedObject.id} · ARGUS Brain YOLO 경로 기반 분석
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="h-8 w-8 rounded border border-cyan-900/60 text-gray-300 hover:bg-[#122131]"
          >
            <X className="w-4 h-4 mx-auto" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => {
                void handleRefreshTodData();
              }}
              disabled={isPicking}
              className="h-10 px-3 rounded border border-cyan-700/70 bg-cyan-900/30 text-cyan-100 text-sm font-semibold hover:bg-cyan-800/40 whitespace-nowrap disabled:opacity-60 disabled:cursor-not-allowed"
            >
              <span className="inline-flex items-center gap-1.5">
                {isPicking ? <Loader2 className="h-4 w-4 animate-spin" /> : <FolderOpen className="h-4 w-4" />}
                목록 새로고침
              </span>
            </button>
            <div className="text-xs text-slate-400 tabular-nums">
              목록 {readyCount}건 · 분석 완료 {doneCount}건
            </div>
          </div>

          <p className="text-[11px] text-slate-500 break-all">
            TOD 디렉터리: {sourceDirectory || '(미확인)'}
            {isMockSource ? ' · MOCK MODE' : ''} · 촬영시간 형식 DDHHMMSS
          </p>

          {errorMessage && (
            <div className="rounded border border-amber-800/65 bg-amber-950/35 px-3 py-2 text-xs text-amber-200">
              {errorMessage}
            </div>
          )}

          <div className="space-y-2">
            {entries.length === 0 && (
              <div className="rounded border border-cyan-900/50 bg-[#0d1721] p-6 text-center">
                <ImageIcon className="h-9 w-9 mx-auto text-cyan-700/70" />
                <p className="text-sm text-slate-300 mt-2">표시할 TOD 데이터가 없습니다.</p>
                <p className="text-xs text-slate-500 mt-1">
                  ARGUS-eye 저장 디렉터리에서 이미지를 수집한 뒤 분석을 실행해 주세요.
                </p>
              </div>
            )}

            {entries.map((entry) => {
              const classLabel =
                entry.inference && entry.inference.className !== 'UNKNOWN'
                  ? CLASS_NAMES_KR[entry.inference.className]
                  : 'UNKNOWN';
              return (
                <article
                  key={entry.entryId}
                  className="rounded border border-slate-800/70 bg-[#0d1721] px-3 py-3"
                >
                  <div className="flex flex-col gap-3 md:flex-row md:items-center">
                    <div className="h-[84px] w-full max-w-[150px] shrink-0 overflow-hidden rounded border border-slate-700/60 bg-[#0a131d]">
                      <img
                        src={entry.previewUrl}
                        alt={`${entry.todId} 미리보기`}
                        className="h-full w-full object-cover"
                        loading="lazy"
                      />
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="grid grid-cols-1 gap-1 text-sm md:grid-cols-3">
                        <p className="flex items-center gap-1.5 text-slate-200">
                          <span className="text-slate-500">TOD ID</span>
                          <span className="font-semibold tabular-nums">{entry.todId}</span>
                        </p>
                        <p className="flex items-center gap-1.5 text-slate-200">
                          <Clock3 className="h-3.5 w-3.5 text-slate-500" />
                          <span className="font-mono tabular-nums">
                            촬영 {entry.observedCode}
                          </span>
                        </p>
                        <p className="truncate text-slate-300">
                          <span className="text-slate-500">파일</span> {entry.fileName}
                        </p>
                      </div>

                      <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs">
                        {entry.status === 'ANALYZING' && (
                          <span className="inline-flex items-center gap-1 rounded border border-cyan-700/70 bg-cyan-950/30 px-2 py-0.5 text-cyan-200">
                            <Loader2 className="h-3 w-3 animate-spin" />
                            분석 중
                          </span>
                        )}
                        {entry.status === 'DONE' && entry.inference && (
                          <span className="inline-flex items-center gap-1 rounded border border-emerald-700/65 bg-emerald-950/30 px-2 py-0.5 text-emerald-200">
                            <CheckCircle2 className="h-3 w-3" />
                            {classLabel} {entry.inference.confidence.toFixed(1)}% · {entry.inference.modelVersion}
                          </span>
                        )}
                        {entry.status === 'ERROR' && (
                          <span className="inline-flex items-center gap-1 rounded border border-amber-700/65 bg-amber-950/30 px-2 py-0.5 text-amber-200">
                            <AlertTriangle className="h-3 w-3" />
                            {entry.errorMessage || '분석 실패'}
                          </span>
                        )}
                        {appliedEntryId === entry.entryId && (
                          <span className="inline-flex items-center gap-1 rounded border border-sky-700/65 bg-sky-950/35 px-2 py-0.5 text-sky-200">
                            반영 됨
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          void runTodAnalysis(entry);
                        }}
                        disabled={entry.status === 'ANALYZING'}
                        className="h-9 px-3 rounded border border-cyan-700/70 bg-cyan-900/25 text-xs text-cyan-100 font-semibold hover:bg-cyan-800/35 whitespace-nowrap disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {entry.status === 'DONE' ? '재분석' : '분석 실행'}
                      </button>
                      <button
                        type="button"
                        disabled={!entry.inference || !entry.combinedInference || appliedEntryId === entry.entryId}
                        onClick={() => handleApplyInference(entry)}
                        className={`h-9 px-3 rounded border text-xs font-semibold whitespace-nowrap disabled:cursor-not-allowed ${
                          appliedEntryId === entry.entryId
                            ? 'border-sky-700/70 bg-sky-950/35 text-sky-200 disabled:opacity-100'
                            : 'border-emerald-700/70 bg-emerald-900/25 text-emerald-100 hover:bg-emerald-800/35 disabled:opacity-45'
                        }`}
                      >
                        {appliedEntryId === entry.entryId ? '반영 됨' : '결과 적용'}
                      </button>
                      <button
                        type="button"
                        onClick={() => handleRemoveEntry(entry)}
                        className="h-9 px-3 rounded border border-slate-700/80 bg-[#101725] text-xs text-slate-200 font-semibold hover:bg-[#1a2535] whitespace-nowrap"
                      >
                        목록 제거
                      </button>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
