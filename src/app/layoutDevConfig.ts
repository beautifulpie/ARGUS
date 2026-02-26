export const LAYOUT_DEV_CONFIG_STORAGE_KEY = 'argus.layout.dev.config.v1';

export interface LayoutDevConfig {
  statusSystemFr: number;
  statusPerformanceFr: number;
  statusControlsFr: number;
  statusCardPaddingY: number;
  metricBoxHeight: number;
  controlButtonHeight: number;
  statusFontScale: number;
  leftColumnVw: number;
  topRowPx: number;
  trackedRowMinPx: number;
  bottomRowPx: number;
  bottomLeftPercent: number;
  mapHeaderPaddingY: number;
  mapLegendPaddingY: number;
  mapFontScale: number;
  selectedPanelFontScale: number;
  tableFontScale: number;
  candidateFontScale: number;
  timelineFontScale: number;
}

export const DEFAULT_LAYOUT_DEV_CONFIG: LayoutDevConfig = {
  statusSystemFr: 0.95,
  statusPerformanceFr: 1.55,
  statusControlsFr: 1.05,
  statusCardPaddingY: 10,
  metricBoxHeight: 54,
  controlButtonHeight: 40,
  statusFontScale: 1,
  leftColumnVw: 43,
  topRowPx: 470,
  trackedRowMinPx: 130,
  bottomRowPx: 232,
  bottomLeftPercent: 50,
  mapHeaderPaddingY: 16,
  mapLegendPaddingY: 12,
  mapFontScale: 1,
  selectedPanelFontScale: 1,
  tableFontScale: 1,
  candidateFontScale: 1,
  timelineFontScale: 1,
};

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const toFinite = (input: unknown, fallback: number) => {
  const numeric = Number(input);
  return Number.isFinite(numeric) ? numeric : fallback;
};

const round2 = (value: number) => Math.round(value * 100) / 100;

export const sanitizeLayoutDevConfig = (
  value: Partial<LayoutDevConfig> | null | undefined
): LayoutDevConfig => ({
  statusSystemFr: round2(clamp(toFinite(value?.statusSystemFr, DEFAULT_LAYOUT_DEV_CONFIG.statusSystemFr), 0.7, 1.6)),
  statusPerformanceFr: round2(
    clamp(toFinite(value?.statusPerformanceFr, DEFAULT_LAYOUT_DEV_CONFIG.statusPerformanceFr), 1.0, 2.3)
  ),
  statusControlsFr: round2(clamp(toFinite(value?.statusControlsFr, DEFAULT_LAYOUT_DEV_CONFIG.statusControlsFr), 0.8, 1.8)),
  statusCardPaddingY: Math.round(
    clamp(toFinite(value?.statusCardPaddingY, DEFAULT_LAYOUT_DEV_CONFIG.statusCardPaddingY), 6, 18)
  ),
  metricBoxHeight: Math.round(
    clamp(toFinite(value?.metricBoxHeight, DEFAULT_LAYOUT_DEV_CONFIG.metricBoxHeight), 42, 72)
  ),
  controlButtonHeight: Math.round(
    clamp(toFinite(value?.controlButtonHeight, DEFAULT_LAYOUT_DEV_CONFIG.controlButtonHeight), 32, 56)
  ),
  statusFontScale: round2(
    clamp(toFinite(value?.statusFontScale, DEFAULT_LAYOUT_DEV_CONFIG.statusFontScale), 0.75, 1.6)
  ),
  leftColumnVw: Math.round(clamp(toFinite(value?.leftColumnVw, DEFAULT_LAYOUT_DEV_CONFIG.leftColumnVw), 36, 52)),
  topRowPx: Math.round(clamp(toFinite(value?.topRowPx, DEFAULT_LAYOUT_DEV_CONFIG.topRowPx), 380, 620)),
  trackedRowMinPx: Math.round(
    clamp(toFinite(value?.trackedRowMinPx, DEFAULT_LAYOUT_DEV_CONFIG.trackedRowMinPx), 90, 280)
  ),
  bottomRowPx: Math.round(clamp(toFinite(value?.bottomRowPx, DEFAULT_LAYOUT_DEV_CONFIG.bottomRowPx), 170, 360)),
  bottomLeftPercent: Math.round(
    clamp(toFinite(value?.bottomLeftPercent, DEFAULT_LAYOUT_DEV_CONFIG.bottomLeftPercent), 35, 65)
  ),
  mapHeaderPaddingY: Math.round(
    clamp(toFinite(value?.mapHeaderPaddingY, DEFAULT_LAYOUT_DEV_CONFIG.mapHeaderPaddingY), 8, 24)
  ),
  mapLegendPaddingY: Math.round(
    clamp(toFinite(value?.mapLegendPaddingY, DEFAULT_LAYOUT_DEV_CONFIG.mapLegendPaddingY), 8, 24)
  ),
  mapFontScale: round2(
    clamp(toFinite(value?.mapFontScale, DEFAULT_LAYOUT_DEV_CONFIG.mapFontScale), 0.75, 1.6)
  ),
  selectedPanelFontScale: round2(
    clamp(
      toFinite(value?.selectedPanelFontScale, DEFAULT_LAYOUT_DEV_CONFIG.selectedPanelFontScale),
      0.75,
      1.6
    )
  ),
  tableFontScale: round2(
    clamp(toFinite(value?.tableFontScale, DEFAULT_LAYOUT_DEV_CONFIG.tableFontScale), 0.75, 1.6)
  ),
  candidateFontScale: round2(
    clamp(toFinite(value?.candidateFontScale, DEFAULT_LAYOUT_DEV_CONFIG.candidateFontScale), 0.75, 1.6)
  ),
  timelineFontScale: round2(
    clamp(toFinite(value?.timelineFontScale, DEFAULT_LAYOUT_DEV_CONFIG.timelineFontScale), 0.75, 1.6)
  ),
});

export const readLayoutDevConfig = (): LayoutDevConfig => {
  if (typeof window === 'undefined') {
    return DEFAULT_LAYOUT_DEV_CONFIG;
  }

  try {
    const raw = window.localStorage.getItem(LAYOUT_DEV_CONFIG_STORAGE_KEY);
    if (!raw) return DEFAULT_LAYOUT_DEV_CONFIG;
    return sanitizeLayoutDevConfig(JSON.parse(raw) as Partial<LayoutDevConfig>);
  } catch {
    return DEFAULT_LAYOUT_DEV_CONFIG;
  }
};
