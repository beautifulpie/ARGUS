import { useEffect, useMemo, useState } from 'react';
import { Settings2, X } from 'lucide-react';

export type DetectionMode = 'ACCURACY' | 'SPEED';
export type MapThemeMode = 'DARK' | 'LIGHT';
export type MapLabelLevel = 'PROVINCE' | 'DISTRICT' | 'EMD';

export interface ConsoleSettings {
  mapCenter: {
    lat: number;
    lon: number;
  };
  positionCode: string;
  modelPath: string;
  detectionMode: DetectionMode;
  mapLabelLevel: MapLabelLevel;
  mapTheme: MapThemeMode;
  mapDataPath: string;
  mapDataLoadNonce: number;
}

export interface PositionCodePreset {
  code: string;
  name: string;
  lat: number;
  lon: number;
}

interface SettingsDialogProps {
  open: boolean;
  settings: ConsoleSettings;
  presets: PositionCodePreset[];
  onClose: () => void;
  onSave: (settings: ConsoleSettings) => void;
  onPreviewThemeChange: (theme: MapThemeMode | null) => void;
}

export function SettingsDialog({
  open,
  settings,
  presets,
  onClose,
  onSave,
  onPreviewThemeChange,
}: SettingsDialogProps) {
  const [draft, setDraft] = useState<ConsoleSettings>(settings);
  const [latInput, setLatInput] = useState(settings.mapCenter.lat.toFixed(6));
  const [lonInput, setLonInput] = useState(settings.mapCenter.lon.toFixed(6));
  const [errorMessage, setErrorMessage] = useState('');

  useEffect(() => {
    if (!open) return;
    setDraft(settings);
    setLatInput(settings.mapCenter.lat.toFixed(6));
    setLonInput(settings.mapCenter.lon.toFixed(6));
    setErrorMessage('');
  }, [open, settings]);

  useEffect(() => {
    if (!open) {
      onPreviewThemeChange(null);
      return;
    }
    onPreviewThemeChange(draft.mapTheme);
  }, [open, draft.mapTheme, onPreviewThemeChange]);

  const presetMap = useMemo(() => {
    const map = new Map<string, PositionCodePreset>();
    presets.forEach((preset) => {
      map.set(preset.code.toUpperCase(), preset);
    });
    return map;
  }, [presets]);

  const handleApplyPositionCode = () => {
    const key = draft.positionCode.trim().toUpperCase();
    if (!key) {
      setErrorMessage('진지명 코드를 입력해 주세요.');
      return;
    }

    const preset = presetMap.get(key);
    if (!preset) {
      setErrorMessage('알 수 없는 진지명 코드입니다. 아래 목록에서 선택해 주세요.');
      return;
    }

    setDraft((prev) => ({
      ...prev,
      positionCode: preset.code,
      mapCenter: { lat: preset.lat, lon: preset.lon },
    }));
    setLatInput(preset.lat.toFixed(6));
    setLonInput(preset.lon.toFixed(6));
    setErrorMessage('');
  };

  const handleSave = () => {
    const lat = Number.parseFloat(latInput.trim().replace(',', '.'));
    const lon = Number.parseFloat(lonInput.trim().replace(',', '.'));

    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      setErrorMessage('위도/경도 값이 올바르지 않습니다.');
      return;
    }

    if (lat < -90 || lat > 90 || lon < -180 || lon > 180) {
      setErrorMessage('위도/경도 범위를 확인해 주세요.');
      return;
    }

    onSave({
      ...draft,
      mapCenter: { lat, lon },
      mapDataPath: draft.mapDataPath.trim() || '/official',
      mapDataLoadNonce: Math.max(0, Math.floor(draft.mapDataLoadNonce || 0)),
    });
    onClose();
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center p-4">
      <button
        type="button"
        aria-label="설정 닫기 배경"
        className="absolute inset-0 bg-[#05080d]/80 backdrop-blur-[2px]"
        onClick={onClose}
      />
      <div className="argus-surface relative w-full max-w-3xl max-h-[92vh] overflow-auto rounded-lg border border-cyan-900/70 bg-[#0a1118] shadow-2xl shadow-black/70">
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-cyan-950/60 bg-[#0b141d] px-5 py-3">
          <div className="flex items-center gap-2">
            <Settings2 className="w-4 h-4 text-cyan-300" />
            <h2 className="text-cyan-200 font-semibold tracking-wide">ARGUS 설정</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="h-8 w-8 rounded border border-cyan-900/60 text-gray-300 hover:bg-[#122131]"
          >
            <X className="w-4 h-4 mx-auto" />
          </button>
        </div>

        <div className="p-5 space-y-6">
          <section className="rounded border border-cyan-900/60 bg-[#0d1721] p-4">
            <h3 className="text-sm font-semibold text-cyan-300">지도 보정</h3>
            <p className="text-xs text-gray-400 mt-1">위치 좌표 또는 진지명 코드로 센서 기준점을 설정합니다.</p>

            <div className="mt-3 grid grid-cols-1 md:grid-cols-[1fr_auto] gap-2">
              <input
                value={draft.positionCode}
                onChange={(event) =>
                  setDraft((prev) => ({
                    ...prev,
                    positionCode: event.target.value,
                  }))
                }
                placeholder="진지명 코드 입력 (예: ARGUS-HQ)"
                className="h-10 rounded border border-cyan-900/70 bg-[#09121a] px-3 text-sm text-gray-100 focus:outline-none focus:ring-1 focus:ring-cyan-500"
              />
              <button
                type="button"
                onClick={handleApplyPositionCode}
                className="h-10 px-3 rounded border border-cyan-700/70 bg-cyan-900/30 text-cyan-100 text-xs font-semibold hover:bg-cyan-800/40 whitespace-nowrap"
              >
                코드 적용
              </button>
            </div>

            <div className="mt-2 flex flex-wrap gap-2">
              {presets.map((preset) => (
                <button
                  key={preset.code}
                  type="button"
                  onClick={() => {
                    setDraft((prev) => ({ ...prev, positionCode: preset.code }));
                    setLatInput(preset.lat.toFixed(6));
                    setLonInput(preset.lon.toFixed(6));
                    setDraft((prev) => ({
                      ...prev,
                      positionCode: preset.code,
                      mapCenter: { lat: preset.lat, lon: preset.lon },
                    }));
                    setErrorMessage('');
                  }}
                  className="px-2 py-1 rounded border border-cyan-900/70 bg-[#0a131d] text-[11px] text-cyan-200 hover:bg-[#102030]"
                >
                  {preset.code}
                </button>
              ))}
            </div>

            <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-2">
              <label className="text-xs text-gray-300">
                위도 (Latitude)
                <input
                  value={latInput}
                  onChange={(event) => setLatInput(event.target.value)}
                  className="mt-1 h-9 w-full rounded border border-cyan-900/70 bg-[#09121a] px-2 text-sm text-gray-100 focus:outline-none focus:ring-1 focus:ring-cyan-500"
                />
              </label>
              <label className="text-xs text-gray-300">
                경도 (Longitude)
                <input
                  value={lonInput}
                  onChange={(event) => setLonInput(event.target.value)}
                  className="mt-1 h-9 w-full rounded border border-cyan-900/70 bg-[#09121a] px-2 text-sm text-gray-100 focus:outline-none focus:ring-1 focus:ring-cyan-500"
                />
              </label>
            </div>
          </section>

          <section className="rounded border border-cyan-900/60 bg-[#0d1721] p-4">
            <h3 className="text-sm font-semibold text-cyan-300">모델 설정</h3>
            <p className="text-xs text-gray-400 mt-1">ARGUS Brain 모델 파일/디렉터리 경로를 지정합니다.</p>
            <input
              value={draft.modelPath}
              onChange={(event) =>
                setDraft((prev) => ({
                  ...prev,
                  modelPath: event.target.value,
                }))
              }
              placeholder="/home/jung/models/argus_brain_multiclass.pt"
              className="mt-3 h-10 w-full rounded border border-cyan-900/70 bg-[#09121a] px-3 text-sm text-gray-100 focus:outline-none focus:ring-1 focus:ring-cyan-500"
            />
          </section>

          <section className="rounded border border-cyan-900/60 bg-[#0d1721] p-4">
            <h3 className="text-sm font-semibold text-cyan-300">탐지 모드</h3>
            <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() =>
                  setDraft((prev) => ({
                    ...prev,
                    detectionMode: 'ACCURACY',
                  }))
                }
                className={`rounded border px-3 py-3 text-left ${
                  draft.detectionMode === 'ACCURACY'
                    ? 'settings-option-selected border-cyan-500 bg-cyan-900/35 text-cyan-100'
                    : 'border-cyan-900/70 bg-[#09121a] text-gray-300'
                }`}
              >
                <p className="text-sm font-semibold">정확성 우선</p>
                <p className="text-xs mt-1 opacity-80">오탐을 줄이고 분류 안정성을 높입니다.</p>
              </button>
              <button
                type="button"
                onClick={() =>
                  setDraft((prev) => ({
                    ...prev,
                    detectionMode: 'SPEED',
                  }))
                }
                className={`rounded border px-3 py-3 text-left ${
                  draft.detectionMode === 'SPEED'
                    ? 'settings-option-selected border-cyan-500 bg-cyan-900/35 text-cyan-100'
                    : 'border-cyan-900/70 bg-[#09121a] text-gray-300'
                }`}
              >
                <p className="text-sm font-semibold">속도 우선</p>
                <p className="text-xs mt-1 opacity-80">낮은 지연 시간과 높은 처리량에 집중합니다.</p>
              </button>
            </div>
          </section>

          <section className="rounded border border-cyan-900/60 bg-[#0d1721] p-4">
            <h3 className="text-sm font-semibold text-cyan-300">지도 표시</h3>
            <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="text-xs text-gray-300 block mb-2">지명 표시 단계</label>
                <div className="grid grid-cols-1 gap-2">
                  <button
                    type="button"
                    onClick={() =>
                      setDraft((prev) => ({
                        ...prev,
                        mapLabelLevel: 'PROVINCE',
                      }))
                    }
                    className={`rounded border px-3 py-2 text-left text-xs ${
                      draft.mapLabelLevel === 'PROVINCE'
                        ? 'settings-option-selected border-cyan-500 bg-cyan-900/35 text-cyan-100'
                        : 'border-cyan-900/70 bg-[#09121a] text-gray-300'
                    }`}
                  >
                    도 단위까지 표시
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setDraft((prev) => ({
                        ...prev,
                        mapLabelLevel: 'DISTRICT',
                      }))
                    }
                    className={`rounded border px-3 py-2 text-left text-xs ${
                      draft.mapLabelLevel === 'DISTRICT'
                        ? 'settings-option-selected border-cyan-500 bg-cyan-900/35 text-cyan-100'
                        : 'border-cyan-900/70 bg-[#09121a] text-gray-300'
                    }`}
                  >
                    시군구 단위까지 표시
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setDraft((prev) => ({
                        ...prev,
                        mapLabelLevel: 'EMD',
                      }))
                    }
                    className={`rounded border px-3 py-2 text-left text-xs ${
                      draft.mapLabelLevel === 'EMD'
                        ? 'settings-option-selected border-cyan-500 bg-cyan-900/35 text-cyan-100'
                        : 'border-cyan-900/70 bg-[#09121a] text-gray-300'
                    }`}
                  >
                    읍면동 단위까지 표시
                  </button>
                </div>
              </div>
              <div>
                <label className="text-xs text-gray-300 block mb-2">테마 설정</label>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() =>
                      setDraft((prev) => ({
                        ...prev,
                        mapTheme: 'DARK',
                      }))
                    }
                    className={`px-3 py-2 rounded border text-xs font-semibold ${
                      draft.mapTheme === 'DARK'
                        ? 'settings-option-selected border-cyan-500 bg-cyan-900/35 text-cyan-100'
                        : 'border-cyan-900/70 bg-[#09121a] text-gray-300'
                    }`}
                  >
                    다크 테마
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setDraft((prev) => ({
                        ...prev,
                        mapTheme: 'LIGHT',
                      }))
                    }
                    className={`px-3 py-2 rounded border text-xs font-semibold ${
                      draft.mapTheme === 'LIGHT'
                        ? 'settings-option-selected border-cyan-500 bg-cyan-900/35 text-cyan-100'
                        : 'border-cyan-900/70 bg-[#09121a] text-gray-300'
                    }`}
                  >
                    화이트 테마
                  </button>
                </div>
              </div>
            </div>
            <div className="mt-4">
              <label className="text-xs text-gray-300 block">지도 데이터 경로</label>
              <p className="text-[11px] text-gray-500 mt-1">
                최신 데이터 반영을 위해 경로를 바꾸고 적용하세요. 예: `/official`, `https://server/maps/official`
              </p>
              <div className="mt-2 flex flex-col md:flex-row gap-2">
                <input
                  value={draft.mapDataPath}
                  onChange={(event) =>
                    setDraft((prev) => ({
                      ...prev,
                      mapDataPath: event.target.value,
                    }))
                  }
                  placeholder="/official"
                  className="h-10 flex-1 rounded border border-cyan-900/70 bg-[#09121a] px-3 text-sm text-gray-100 focus:outline-none focus:ring-1 focus:ring-cyan-500"
                />
                <button
                  type="button"
                  onClick={() =>
                    setDraft((prev) => ({
                      ...prev,
                      mapDataPath: '/official',
                    }))
                  }
                  className="h-10 px-3 rounded border border-cyan-900/70 bg-[#0a131d] text-xs text-cyan-200 hover:bg-[#102030] whitespace-nowrap"
                >
                  기본 경로
                </button>
                <button
                  type="button"
                  onClick={() =>
                    setDraft((prev) => ({
                      ...prev,
                      mapDataLoadNonce: (prev.mapDataLoadNonce || 0) + 1,
                    }))
                  }
                  className="h-10 px-3 rounded border border-cyan-700/70 bg-cyan-900/25 text-xs text-cyan-100 hover:bg-cyan-800/35 whitespace-nowrap"
                >
                  데이터 다시 불러오기
                </button>
              </div>
            </div>
          </section>

          {errorMessage && <p className="text-xs text-amber-300">{errorMessage}</p>}
        </div>

        <div className="sticky bottom-0 z-10 flex items-center justify-end gap-2 border-t border-cyan-950/60 bg-[#0b141d] px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            className="h-9 px-3 rounded border border-gray-700 bg-[#111a24] text-gray-200 text-sm font-semibold hover:bg-[#182838]"
          >
            취소
          </button>
          <button
            type="button"
            onClick={handleSave}
            className="h-9 px-3 rounded border border-cyan-700/70 bg-cyan-900/35 text-cyan-100 text-sm font-semibold hover:bg-cyan-800/45"
          >
            설정 적용
          </button>
        </div>
      </div>
    </div>
  );
}
