import { useRef, useEffect, useState } from 'react';
import { DetectedObject, ObjectClass } from '../types';
import { encodeMgrsFromLatLon, extract100kIdFromMgrs, extractSixDigitFromMgrs } from '../lib/mgrsLocal';
import { type LayoutDevConfig } from '../layoutDevConfig';

interface LidarSpatialViewProps {
  objects: DetectedObject[];
  selectedObjectId: string | null;
  onSelectObject: (id: string | null) => void;
  mapCenter: GeoPoint;
  detectionMode: 'ACCURACY' | 'SPEED';
  computeMode: 'CPU_ONLY' | 'AUTO';
  mapTheme: 'DARK' | 'LIGHT';
  mapLabelLevel: 'PROVINCE' | 'DISTRICT' | 'EMD';
  showUtmGrid: boolean;
  showMgrsLabels: boolean;
  mapDataPath: string;
  mapDataLoadNonce: number;
  layoutDevConfig: LayoutDevConfig;
}

type TrackTone = 'SAFE' | 'UNKNOWN' | 'SUSPICIOUS' | 'THREAT';

const TACTICAL_TRACK_COLORS: Record<TrackTone, string> = {
  SAFE: '#38bdf8',
  UNKNOWN: '#fbbf24',
  SUSPICIOUS: '#fb923c',
  THREAT: '#ef4444',
};

const CLASS_NAMES_KR: Record<ObjectClass, string> = {
  HELICOPTER: '헬기',
  UAV: '무인기',
  HIGHSPEED: '고속기',
  BIRD_FLOCK: '새떼',
  BIRD: '새',
  CIVIL_AIR: '민간기',
  FIGHTER: '전투기',
};

const CLASS_MARKER_SIZE_HINT: Record<ObjectClass, { length: number; width: number }> = {
  HELICOPTER: { length: 15, width: 12 },
  UAV: { length: 2, width: 2 },
  HIGHSPEED: { length: 18, width: 8 },
  BIRD_FLOCK: { length: 5, width: 5 },
  BIRD: { length: 1, width: 1 },
  CIVIL_AIR: { length: 40, width: 35 },
  FIGHTER: { length: 18, width: 12 },
};

const getTrackMarkerBoxSize = (obj: DetectedObject, scale: number) => {
  const fallback = CLASS_MARKER_SIZE_HINT[obj.class];
  const lengthHint = Math.max(0.6, obj.size?.length ?? fallback.length);
  const widthHint = Math.max(0.6, obj.size?.width ?? fallback.width);
  return {
    boxWidth: Math.max(lengthHint * scale, 9),
    boxHeight: Math.max(widthHint * scale, 7),
  };
};

const getTrackTone = (obj: DetectedObject): TrackTone => {
  if (obj.riskLevel === 'CRITICAL' || obj.riskLevel === 'HIGH') {
    return 'THREAT';
  }
  if (obj.riskLevel === 'MEDIUM' || obj.uavDecision === 'UAV') {
    return 'SUSPICIOUS';
  }
  if (obj.uavDecision === 'UNKNOWN' || obj.class === 'BIRD' || obj.class === 'BIRD_FLOCK') {
    return 'UNKNOWN';
  }
  return 'SAFE';
};

interface GeoPoint {
  lat: number;
  lon: number;
}

interface GeoPolyline {
  name?: string;
  points: GeoPoint[];
}

interface GeoLabel {
  name: string;
  point: GeoPoint;
}

interface AdminLabelLayers {
  province: GeoLabel[];
  district: GeoLabel[];
  emd: GeoLabel[];
}

type UtmGridSpacing = 1000 | 10000 | 100000;

interface UtmGridLine {
  points: GeoPoint[];
  spacingMeters: UtmGridSpacing;
}

interface UtmGridViewportBounds {
  minLat: number;
  maxLat: number;
  minLon: number;
  maxLon: number;
}

interface UtmGridData {
  zone: 51 | 52;
  epsg: 32651 | 32652;
  zoom: number;
  majorLines: UtmGridLine[];
  minorLines: UtmGridLine[];
  mgrsBoundaryLines: UtmGridLine[];
  mgrs100kmLabels: Mgrs100kmLabel[];
  viewportSignature: string;
}

interface Mgrs100kmLabel {
  id: string;
  label: string;
  sixDigit: string;
  point: GeoPoint;
}

interface TileState {
  image: HTMLImageElement;
  loaded: boolean;
  failed: boolean;
}

interface DragState {
  dragging: boolean;
  moved: boolean;
  lastX: number;
  lastY: number;
}

interface GeoJsonDirectoryReadResult {
  ok?: boolean;
  path?: string | null;
  data?: unknown;
  error?: string;
}

interface RadarRuntimeBridge {
  readGeoJsonFromDirectory?: (payload: {
    basePath: string;
    fileNames: string[];
  }) => Promise<GeoJsonDirectoryReadResult | null | undefined>;
}

interface UtmGridThemeStyle {
  majorLineColor: string;
  minorLineColor: string;
  mgrsBoundaryLineColor: string;
  majorLineWidth: number;
  minorLineWidth: number;
  mgrsBoundaryLineWidth: number;
  majorLineDash: number[];
  minorLineDash: number[];
  mgrsBoundaryLineDash: number[];
  mgrsLabelFill: string;
  mgrsLabelStroke: string;
  mgrsCoordFill: string;
  mgrsCoordStroke: string;
  mgrsLabelFontSize: number;
  mgrsLabelFontSizeZoomed: number;
  mgrsCoordFontSize: number;
  mgrsLabelLetterSpacing: number;
}

const KOREA_BOUNDS = {
  minLat: 32.7,
  maxLat: 39.9,
  minLon: 123.0,
  maxLon: 132.2,
};

const TILE_SIZE = 256;
const EARTH_RADIUS_METERS = 6378137;
const RADAR_UNITS_MAX = 100;
const MAX_RANGE_KM = 15;
const METERS_PER_RADAR_UNIT = (MAX_RANGE_KM * 1000) / RADAR_UNITS_MAX;
const MAP_ZOOM_STORAGE_KEY = 'argus.map.zoom.v1';
const DEFAULT_MAP_ZOOM = 11;
const MIN_MAP_ZOOM = 7;
const MAX_MAP_ZOOM = 15;
const DARK_TILE_ALPHA = 0.28;
const LIGHT_TILE_ALPHA = 0.48;
const TACTICAL_DARK_OVERLAY = 'rgba(3, 8, 14, 0.62)';
const TACTICAL_LIGHT_OVERLAY = 'rgba(10, 18, 28, 0.16)';
const SHOW_BASEMAP_IN_LIGHT_THEME =
  import.meta.env.DEV || import.meta.env.VITE_SHOW_LIGHT_BASEMAP === 'true';
const DEFAULT_OFFICIAL_DATA_BASE_PATH = '/official';
const OFFICIAL_BOUNDARY_FILES = [
  'korea_boundary.geojson',
  'national_boundary.geojson',
  'admin_boundary.geojson',
];
const OFFICIAL_TERRITORIAL_FILES = [
  'territorial_sea.geojson',
  'maritime_boundary.geojson',
  'eez_boundary.geojson',
];
const OFFICIAL_AIRSPACE_FILES = ['airspace_boundary.geojson', 'airspace.geojson', 'fir.geojson'];
const OFFICIAL_EMD_LABEL_FILES = ['emd_labels.geojson', 'emd.geojson', 'eupmyeondong.geojson'];
const UTM_GRID_SOURCE_ID = 'argus-utm-grid';
const UTM_GRID_10KM_LAYER_ID = 'argus-utm-10km';
const UTM_GRID_1KM_LAYER_ID = 'argus-utm-1km';
const UTM_GRID_LAYER_SIGNATURE = `${UTM_GRID_SOURCE_ID}:${UTM_GRID_10KM_LAYER_ID}:${UTM_GRID_1KM_LAYER_ID}`;
const UTM_GRID_DEBOUNCE_MS = 90;
const UTM_GRID_LINE_SAMPLE_STEPS = 12;
const UTM_GRID_MAX_MAJOR_LINE_COUNT = 420;
const UTM_GRID_MAX_MINOR_LINE_COUNT = 900;
const UTM_GRID_MAJOR_STEP_METERS = 10_000;
const UTM_GRID_MINOR_STEP_METERS = 1_000;
const UTM_GRID_MGRS_STEP_METERS = 100_000;
const UTM_GRID_MGRS_LABEL_ANCHOR_EASTING_METERS = 12_000;
const UTM_GRID_MGRS_LABEL_ANCHOR_NORTHING_METERS = 12_000;
const UTM_ZONE_HYSTERESIS_MIN_LON = 125.7;
const UTM_ZONE_HYSTERESIS_MAX_LON = 126.3;
const UTM_GRID_MGRS_CACHE_MAX = 96;
const utmMgrsLabelCache = new Map<string, Mgrs100kmLabel[]>();

const UTM_GRID_THEME_STYLE: Record<'DARK' | 'LIGHT', UtmGridThemeStyle> = {
  LIGHT: {
    majorLineColor: 'rgba(60, 90, 120, 0.18)',
    minorLineColor: 'rgba(60, 90, 120, 0.08)',
    mgrsBoundaryLineColor: 'rgba(45, 72, 96, 0.48)',
    majorLineWidth: 1.4,
    minorLineWidth: 1,
    mgrsBoundaryLineWidth: 1.9,
    majorLineDash: [7, 6],
    minorLineDash: [3, 7],
    mgrsBoundaryLineDash: [10, 8],
    mgrsLabelFill: 'rgba(32, 58, 82, 0.74)',
    mgrsLabelStroke: 'rgba(255, 255, 255, 0.86)',
    mgrsCoordFill: 'rgba(26, 50, 74, 0.7)',
    mgrsCoordStroke: 'rgba(255, 255, 255, 0.8)',
    mgrsLabelFontSize: 34,
    mgrsLabelFontSizeZoomed: 41,
    mgrsCoordFontSize: 31,
    mgrsLabelLetterSpacing: 0.5,
  },
  DARK: {
    majorLineColor: 'rgba(120, 180, 220, 0.22)',
    minorLineColor: 'rgba(120, 180, 220, 0.10)',
    mgrsBoundaryLineColor: 'rgba(125, 190, 232, 0.48)',
    majorLineWidth: 1.4,
    minorLineWidth: 1,
    mgrsBoundaryLineWidth: 1.9,
    majorLineDash: [7, 6],
    minorLineDash: [3, 7],
    mgrsBoundaryLineDash: [10, 8],
    mgrsLabelFill: 'rgba(166, 220, 250, 0.7)',
    mgrsLabelStroke: 'rgba(0, 0, 0, 0.72)',
    mgrsCoordFill: 'rgba(166, 220, 250, 0.62)',
    mgrsCoordStroke: 'rgba(0, 0, 0, 0.7)',
    mgrsLabelFontSize: 34,
    mgrsLabelFontSizeZoomed: 41,
    mgrsCoordFontSize: 31,
    mgrsLabelLetterSpacing: 0.5,
  },
};

const UTM_WGS84_A = 6378137.0;
const UTM_WGS84_F = 1 / 298.257223563;
const UTM_WGS84_E2 = UTM_WGS84_F * (2 - UTM_WGS84_F);
const UTM_WGS84_E_PRIME_SQ = UTM_WGS84_E2 / (1 - UTM_WGS84_E2);
const UTM_SCALE_FACTOR = 0.9996;
const UTM_FALSE_EASTING = 500000.0;
const UTM_NORTHERN_FALSE_NORTHING = 0.0;
const UTM_EPSILON = 1e-9;

const toRadians = (degree: number) => (degree * Math.PI) / 180;
const toDegrees = (radian: number) => (radian * 180) / Math.PI;

const getUtmZoneByLongitude = (lon: number): 51 | 52 => (lon < 126 ? 51 : 52);
const getStableUtmZoneByLongitude = (lon: number, previousZone?: 51 | 52): 51 | 52 => {
  if (
    previousZone &&
    lon >= UTM_ZONE_HYSTERESIS_MIN_LON &&
    lon <= UTM_ZONE_HYSTERESIS_MAX_LON
  ) {
    return previousZone;
  }
  return getUtmZoneByLongitude(lon);
};
const getUtmEpsgByZone = (zone: 51 | 52): 32651 | 32652 => (zone === 51 ? 32651 : 32652);
const getCentralMeridianByZone = (zone: 51 | 52) => (zone === 51 ? 123 : 129);

const toUtmCoordinates = (lat: number, lon: number, zone: 51 | 52) => {
  const latClamped = clamp(lat, -80, 84);
  const lonNormalized = normalizeLongitude(lon);
  const latRad = toRadians(latClamped);
  const lonRad = toRadians(lonNormalized);
  const lonOriginRad = toRadians(getCentralMeridianByZone(zone));

  const sinLat = Math.sin(latRad);
  const cosLat = Math.cos(latRad);
  const tanLat = Math.tan(latRad);

  const n = UTM_WGS84_A / Math.sqrt(1 - UTM_WGS84_E2 * sinLat * sinLat);
  const t = tanLat * tanLat;
  const c = UTM_WGS84_E_PRIME_SQ * cosLat * cosLat;
  const a = cosLat * (lonRad - lonOriginRad);

  const m =
    UTM_WGS84_A *
    ((1 - UTM_WGS84_E2 / 4 - (3 * UTM_WGS84_E2 ** 2) / 64 - (5 * UTM_WGS84_E2 ** 3) / 256) * latRad -
      ((3 * UTM_WGS84_E2) / 8 + (3 * UTM_WGS84_E2 ** 2) / 32 + (45 * UTM_WGS84_E2 ** 3) / 1024) *
        Math.sin(2 * latRad) +
      ((15 * UTM_WGS84_E2 ** 2) / 256 + (45 * UTM_WGS84_E2 ** 3) / 1024) * Math.sin(4 * latRad) -
      ((35 * UTM_WGS84_E2 ** 3) / 3072) * Math.sin(6 * latRad));

  const easting =
    UTM_SCALE_FACTOR *
      n *
      (a +
        ((1 - t + c) * a ** 3) / 6 +
        ((5 - 18 * t + t ** 2 + 72 * c - 58 * UTM_WGS84_E_PRIME_SQ) * a ** 5) / 120) +
    UTM_FALSE_EASTING;

  const northing =
    UTM_SCALE_FACTOR *
      (m +
        n *
          tanLat *
          (a ** 2 / 2 +
            ((5 - t + 9 * c + 4 * c ** 2) * a ** 4) / 24 +
            ((61 - 58 * t + t ** 2 + 600 * c - 330 * UTM_WGS84_E_PRIME_SQ) * a ** 6) / 720)) +
    UTM_NORTHERN_FALSE_NORTHING;

  return { easting, northing };
};

const toLatLonFromUtm = (easting: number, northing: number, zone: 51 | 52): GeoPoint => {
  const x = easting - UTM_FALSE_EASTING;
  const y = northing - UTM_NORTHERN_FALSE_NORTHING;
  const lonOriginRad = toRadians(getCentralMeridianByZone(zone));

  const m = y / UTM_SCALE_FACTOR;
  const mu =
    m /
    (UTM_WGS84_A *
      (1 - UTM_WGS84_E2 / 4 - (3 * UTM_WGS84_E2 ** 2) / 64 - (5 * UTM_WGS84_E2 ** 3) / 256));

  const e1 = (1 - Math.sqrt(1 - UTM_WGS84_E2)) / (1 + Math.sqrt(1 - UTM_WGS84_E2));
  const j1 = (3 * e1) / 2 - (27 * e1 ** 3) / 32;
  const j2 = (21 * e1 ** 2) / 16 - (55 * e1 ** 4) / 32;
  const j3 = (151 * e1 ** 3) / 96;
  const j4 = (1097 * e1 ** 4) / 512;

  const fp =
    mu + j1 * Math.sin(2 * mu) + j2 * Math.sin(4 * mu) + j3 * Math.sin(6 * mu) + j4 * Math.sin(8 * mu);
  const sinFp = Math.sin(fp);
  const cosFp = Math.cos(fp);
  const tanFp = Math.tan(fp);

  const c1 = UTM_WGS84_E_PRIME_SQ * cosFp ** 2;
  const t1 = tanFp ** 2;
  const n1 = UTM_WGS84_A / Math.sqrt(1 - UTM_WGS84_E2 * sinFp ** 2);
  const r1 = (UTM_WGS84_A * (1 - UTM_WGS84_E2)) / (1 - UTM_WGS84_E2 * sinFp ** 2) ** 1.5;
  const d = x / (n1 * UTM_SCALE_FACTOR);

  const lat =
    fp -
    ((n1 * tanFp) / r1) *
      (d ** 2 / 2 -
        ((5 + 3 * t1 + 10 * c1 - 4 * c1 ** 2 - 9 * UTM_WGS84_E_PRIME_SQ) * d ** 4) / 24 +
        ((61 + 90 * t1 + 298 * c1 + 45 * t1 ** 2 - 252 * UTM_WGS84_E_PRIME_SQ - 3 * c1 ** 2) * d ** 6) /
          720);

  const lon =
    lonOriginRad +
    (d - ((1 + 2 * t1 + c1) * d ** 3) / 6 +
      ((5 - 2 * c1 + 28 * t1 - 3 * c1 ** 2 + 8 * UTM_WGS84_E_PRIME_SQ + 24 * t1 ** 2) * d ** 5) /
        120) /
      Math.max(UTM_EPSILON, cosFp);

  return {
    lat: toDegrees(lat),
    lon: normalizeLongitude(toDegrees(lon)),
  };
};

const buildGridLinePointsByFixedEasting = (
  zone: 51 | 52,
  easting: number,
  minNorthing: number,
  maxNorthing: number
) => {
  const points: GeoPoint[] = [];
  const span = Math.max(UTM_EPSILON, maxNorthing - minNorthing);
  for (let i = 0; i <= UTM_GRID_LINE_SAMPLE_STEPS; i += 1) {
    const ratio = i / UTM_GRID_LINE_SAMPLE_STEPS;
    const northing = minNorthing + span * ratio;
    points.push(toLatLonFromUtm(easting, northing, zone));
  }
  return points;
};

const buildGridLinePointsByFixedNorthing = (
  zone: 51 | 52,
  northing: number,
  minEasting: number,
  maxEasting: number
) => {
  const points: GeoPoint[] = [];
  const span = Math.max(UTM_EPSILON, maxEasting - minEasting);
  for (let i = 0; i <= UTM_GRID_LINE_SAMPLE_STEPS; i += 1) {
    const ratio = i / UTM_GRID_LINE_SAMPLE_STEPS;
    const easting = minEasting + span * ratio;
    points.push(toLatLonFromUtm(easting, northing, zone));
  }
  return points;
};

const isLikelyFilesystemPath = (pathValue: string): boolean => {
  const normalized = pathValue.trim();
  if (!normalized) return false;
  if (/^https?:\/\//i.test(normalized)) return false;
  if (normalized === DEFAULT_OFFICIAL_DATA_BASE_PATH || normalized.startsWith(`${DEFAULT_OFFICIAL_DATA_BASE_PATH}/`)) {
    return false;
  }
  if (/^[A-Za-z]:[\\/]/.test(normalized)) return true;
  if (normalized.startsWith('/')) return true;
  if (normalized.startsWith('./') || normalized.startsWith('../') || normalized.startsWith('~')) return true;
  return normalized.includes('\\');
};

const KOREA_MAINLAND_BOUNDARY: GeoPoint[] = [
  { lat: 34.24, lon: 126.09 },
  { lat: 34.53, lon: 126.37 },
  { lat: 34.92, lon: 126.53 },
  { lat: 35.42, lon: 126.17 },
  { lat: 35.77, lon: 126.52 },
  { lat: 36.17, lon: 126.86 },
  { lat: 36.47, lon: 127.32 },
  { lat: 36.76, lon: 127.9 },
  { lat: 37.18, lon: 128.48 },
  { lat: 37.74, lon: 128.86 },
  { lat: 38.33, lon: 128.52 },
  { lat: 38.52, lon: 127.6 },
  { lat: 38.36, lon: 126.86 },
  { lat: 37.98, lon: 126.17 },
  { lat: 37.48, lon: 126.2 },
  { lat: 36.88, lon: 126.05 },
  { lat: 36.31, lon: 125.92 },
  { lat: 35.73, lon: 125.84 },
  { lat: 35.1, lon: 125.94 },
  { lat: 34.66, lon: 126.01 },
  { lat: 34.24, lon: 126.09 },
];

const JEJU_BOUNDARY: GeoPoint[] = [
  { lat: 33.14, lon: 126.1 },
  { lat: 33.2, lon: 126.55 },
  { lat: 33.37, lon: 126.94 },
  { lat: 33.52, lon: 126.87 },
  { lat: 33.57, lon: 126.52 },
  { lat: 33.54, lon: 126.14 },
  { lat: 33.35, lon: 126.02 },
  { lat: 33.14, lon: 126.1 },
];

const ULLEUNG_BOUNDARY: GeoPoint[] = [
  { lat: 37.43, lon: 130.8 },
  { lat: 37.54, lon: 130.91 },
  { lat: 37.56, lon: 131.02 },
  { lat: 37.47, lon: 131.1 },
  { lat: 37.37, lon: 130.99 },
  { lat: 37.39, lon: 130.84 },
  { lat: 37.43, lon: 130.8 },
];

const TERRITORIAL_SEA_LINE: GeoPoint[] = [
  { lat: 33.0, lon: 124.45 },
  { lat: 34.48, lon: 124.2 },
  { lat: 36.18, lon: 124.46 },
  { lat: 37.88, lon: 124.78 },
  { lat: 39.12, lon: 126.16 },
  { lat: 39.2, lon: 128.52 },
  { lat: 38.48, lon: 130.18 },
  { lat: 36.92, lon: 131.38 },
  { lat: 34.94, lon: 130.46 },
  { lat: 33.06, lon: 128.9 },
  { lat: 32.68, lon: 126.33 },
  { lat: 33.0, lon: 124.45 },
];

const AIRSPACE_LINE: GeoPoint[] = [
  { lat: 32.7, lon: 123.0 },
  { lat: 39.9, lon: 123.0 },
  { lat: 39.9, lon: 132.2 },
  { lat: 32.7, lon: 132.2 },
  { lat: 32.7, lon: 123.0 },
];

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const normalizeLongitude = (lon: number) => {
  let normalized = lon;
  while (normalized < -180) normalized += 360;
  while (normalized > 180) normalized -= 360;
  return normalized;
};

const clampToKoreaBounds = (point: GeoPoint): GeoPoint => ({
  lat: clamp(point.lat, KOREA_BOUNDS.minLat, KOREA_BOUNDS.maxLat),
  lon: clamp(normalizeLongitude(point.lon), KOREA_BOUNDS.minLon, KOREA_BOUNDS.maxLon),
});

const projectLatLonToWorld = (lat: number, lon: number, zoom: number) => {
  const latClamped = clamp(lat, -85.0511, 85.0511);
  const sinLat = Math.sin((latClamped * Math.PI) / 180);
  const worldSize = TILE_SIZE * 2 ** zoom;
  const x = ((normalizeLongitude(lon) + 180) / 360) * worldSize;
  const y = (0.5 - Math.log((1 + sinLat) / (1 - sinLat)) / (4 * Math.PI)) * worldSize;

  return { x, y };
};

const unprojectWorldToLatLon = (x: number, y: number, zoom: number): GeoPoint => {
  const worldSize = TILE_SIZE * 2 ** zoom;
  const lon = (x / worldSize) * 360 - 180;
  const n = Math.PI - (2 * Math.PI * y) / worldSize;
  const lat = (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));

  return { lat, lon };
};

const getRadarScaleFromLatitude = (lat: number, zoom: number) => {
  const latitudeRadians = (lat * Math.PI) / 180;
  const metersPerPixel =
    (Math.cos(latitudeRadians) * 2 * Math.PI * EARTH_RADIUS_METERS) /
    (TILE_SIZE * 2 ** zoom);
  return METERS_PER_RADAR_UNIT / metersPerPixel;
};

const getViewportBoundsForGrid = (
  viewCenter: GeoPoint,
  zoom: number,
  canvas: { width: number; height: number }
): UtmGridViewportBounds => {
  const worldViewCenter = projectLatLonToWorld(viewCenter.lat, viewCenter.lon, zoom);
  const topLeft = unprojectWorldToLatLon(
    worldViewCenter.x - canvas.width / 2,
    worldViewCenter.y - canvas.height / 2,
    zoom
  );
  const bottomRight = unprojectWorldToLatLon(
    worldViewCenter.x + canvas.width / 2,
    worldViewCenter.y + canvas.height / 2,
    zoom
  );

  const minLat = clamp(
    Math.min(topLeft.lat, bottomRight.lat),
    KOREA_BOUNDS.minLat,
    KOREA_BOUNDS.maxLat
  );
  const maxLat = clamp(
    Math.max(topLeft.lat, bottomRight.lat),
    KOREA_BOUNDS.minLat,
    KOREA_BOUNDS.maxLat
  );
  const minLon = clamp(
    Math.min(topLeft.lon, bottomRight.lon),
    KOREA_BOUNDS.minLon,
    KOREA_BOUNDS.maxLon
  );
  const maxLon = clamp(
    Math.max(topLeft.lon, bottomRight.lon),
    KOREA_BOUNDS.minLon,
    KOREA_BOUNDS.maxLon
  );

  return { minLat, maxLat, minLon, maxLon };
};

const getUtmBoundsFromViewport = (
  zone: 51 | 52,
  bounds: UtmGridViewportBounds,
  paddingMeters = 0
) => {
  const samplePoints: GeoPoint[] = [
    { lat: bounds.minLat, lon: bounds.minLon },
    { lat: bounds.minLat, lon: bounds.maxLon },
    { lat: bounds.maxLat, lon: bounds.minLon },
    { lat: bounds.maxLat, lon: bounds.maxLon },
    { lat: bounds.minLat, lon: (bounds.minLon + bounds.maxLon) / 2 },
    { lat: bounds.maxLat, lon: (bounds.minLon + bounds.maxLon) / 2 },
    { lat: (bounds.minLat + bounds.maxLat) / 2, lon: bounds.minLon },
    { lat: (bounds.minLat + bounds.maxLat) / 2, lon: bounds.maxLon },
    { lat: (bounds.minLat + bounds.maxLat) / 2, lon: (bounds.minLon + bounds.maxLon) / 2 },
  ];
  const utmSamples = samplePoints.map((point) => toUtmCoordinates(point.lat, point.lon, zone));
  return {
    minEasting: Math.min(...utmSamples.map((point) => point.easting)) - paddingMeters,
    maxEasting: Math.max(...utmSamples.map((point) => point.easting)) + paddingMeters,
    minNorthing: Math.min(...utmSamples.map((point) => point.northing)) - paddingMeters,
    maxNorthing: Math.max(...utmSamples.map((point) => point.northing)) + paddingMeters,
  };
};

const createMgrs100kmLabels = (
  zone: 51 | 52,
  bounds: UtmGridViewportBounds,
  zoom: number
): Mgrs100kmLabel[] => {
  if (zoom < 8) return [];

  const {
    minEasting: viewportMinEasting,
    maxEasting: viewportMaxEasting,
    minNorthing: viewportMinNorthing,
    maxNorthing: viewportMaxNorthing,
  } = getUtmBoundsFromViewport(zone, bounds, 0);
  const e0 =
    Math.floor(viewportMinEasting / UTM_GRID_MGRS_STEP_METERS) * UTM_GRID_MGRS_STEP_METERS;
  const e1 =
    Math.ceil(viewportMaxEasting / UTM_GRID_MGRS_STEP_METERS) * UTM_GRID_MGRS_STEP_METERS;
  const n0 =
    Math.floor(viewportMinNorthing / UTM_GRID_MGRS_STEP_METERS) * UTM_GRID_MGRS_STEP_METERS;
  const n1 =
    Math.ceil(viewportMaxNorthing / UTM_GRID_MGRS_STEP_METERS) * UTM_GRID_MGRS_STEP_METERS;
  const zoomBucket = zoom >= 12 ? 12 : 8;
  const cacheKey = `${zone}:${zoomBucket}:${e0}:${e1}:${n0}:${n1}`;
  const cached = utmMgrsLabelCache.get(cacheKey);
  if (cached) return cached;

  const labels: Mgrs100kmLabel[] = [];
  for (let easting = e0; easting < e1; easting += UTM_GRID_MGRS_STEP_METERS) {
    for (let northing = n0; northing < n1; northing += UTM_GRID_MGRS_STEP_METERS) {
      const centerEasting = easting + UTM_GRID_MGRS_STEP_METERS / 2;
      const centerNorthing = northing + UTM_GRID_MGRS_STEP_METERS / 2;
      const centerPoint = toLatLonFromUtm(centerEasting, centerNorthing, zone);
      const mgrsString = encodeMgrsFromLatLon(
        centerPoint.lat,
        centerPoint.lon,
        (lat, lon, zoneNumber) => toUtmCoordinates(lat, lon, zoneNumber as 51 | 52),
        zone,
        0
      );
      const label = extract100kIdFromMgrs(mgrsString);
      if (!label) continue;
      const mgrs6String = encodeMgrsFromLatLon(
        centerPoint.lat,
        centerPoint.lon,
        (lat, lon, zoneNumber) => toUtmCoordinates(lat, lon, zoneNumber as 51 | 52),
        zone,
        3
      );
      const sixDigit = extractSixDigitFromMgrs(mgrs6String);

      const cellMinEasting = easting;
      const cellMaxEasting = easting + UTM_GRID_MGRS_STEP_METERS;
      const cellMinNorthing = northing;
      const cellMaxNorthing = northing + UTM_GRID_MGRS_STEP_METERS;
      const intersectMinEasting = Math.max(viewportMinEasting, cellMinEasting);
      const intersectMaxEasting = Math.min(viewportMaxEasting, cellMaxEasting);
      const intersectMinNorthing = Math.max(viewportMinNorthing, cellMinNorthing);
      const intersectMaxNorthing = Math.min(viewportMaxNorthing, cellMaxNorthing);
      const hasIntersection =
        intersectMinEasting <= intersectMaxEasting &&
        intersectMinNorthing <= intersectMaxNorthing;
      if (!hasIntersection) continue;

      // Fixed anchor per 100km cell (left-bottom offset) for stable, non-jumping label placement.
      const fixedAnchorEasting = cellMinEasting + UTM_GRID_MGRS_LABEL_ANCHOR_EASTING_METERS;
      const fixedAnchorNorthing = cellMinNorthing + UTM_GRID_MGRS_LABEL_ANCHOR_NORTHING_METERS;
      const anchorEasting = fixedAnchorEasting;
      const anchorNorthing = fixedAnchorNorthing;
      const anchorPoint = toLatLonFromUtm(anchorEasting, anchorNorthing, zone);

      labels.push({
        id: `${zone}:${easting}:${northing}:${label}`,
        label,
        sixDigit,
        point: anchorPoint,
      });
    }
  }

  if (utmMgrsLabelCache.size >= UTM_GRID_MGRS_CACHE_MAX) {
    const oldest = utmMgrsLabelCache.keys().next().value;
    if (oldest) {
      utmMgrsLabelCache.delete(oldest);
    }
  }
  utmMgrsLabelCache.set(cacheKey, labels);
  return labels;
};

const createEmptyUtmGridData = (zone: 51 | 52, zoom: number): UtmGridData => ({
  zone,
  epsg: getUtmEpsgByZone(zone),
  zoom,
  majorLines: [],
  minorLines: [],
  mgrsBoundaryLines: [],
  mgrs100kmLabels: [],
  viewportSignature: `${UTM_GRID_LAYER_SIGNATURE}:${zone}:${zoom}:none`,
});

const createUtmGridLines = (
  zone: 51 | 52,
  bounds: UtmGridViewportBounds,
  spacingMeters: UtmGridSpacing
): UtmGridLine[] => {
  const { minEasting, maxEasting, minNorthing, maxNorthing } = getUtmBoundsFromViewport(
    zone,
    bounds,
    spacingMeters
  );

  const eastingStart = Math.floor(minEasting / spacingMeters) * spacingMeters;
  const eastingEnd = Math.ceil(maxEasting / spacingMeters) * spacingMeters;
  const northingStart = Math.floor(minNorthing / spacingMeters) * spacingMeters;
  const northingEnd = Math.ceil(maxNorthing / spacingMeters) * spacingMeters;

  const eastingCount = Math.floor((eastingEnd - eastingStart) / spacingMeters) + 1;
  const northingCount = Math.floor((northingEnd - northingStart) / spacingMeters) + 1;
  const totalLineCount = eastingCount + northingCount;
  const maxLineCount =
    spacingMeters === UTM_GRID_MINOR_STEP_METERS
      ? UTM_GRID_MAX_MINOR_LINE_COUNT
      : UTM_GRID_MAX_MAJOR_LINE_COUNT;
  if (totalLineCount > maxLineCount) {
    return [];
  }

  const lines: UtmGridLine[] = [];
  for (let easting = eastingStart; easting <= eastingEnd + UTM_EPSILON; easting += spacingMeters) {
    const points = buildGridLinePointsByFixedEasting(zone, easting, northingStart, northingEnd);
    if (points.length >= 2) {
      lines.push({ points, spacingMeters });
    }
  }

  for (let northing = northingStart; northing <= northingEnd + UTM_EPSILON; northing += spacingMeters) {
    const points = buildGridLinePointsByFixedNorthing(zone, northing, eastingStart, eastingEnd);
    if (points.length >= 2) {
      lines.push({ points, spacingMeters });
    }
  }

  return lines;
};

const buildUtmGridDataForViewport = (
  center: GeoPoint,
  zoom: number,
  canvas: { width: number; height: number },
  previousZone: 51 | 52,
  showUtmGrid: boolean,
  showMgrsLabels: boolean
): UtmGridData => {
  const zone = getStableUtmZoneByLongitude(center.lon, previousZone);
  const shouldRenderLines = showUtmGrid && zoom >= 7;
  const shouldRenderMgrsLabels = showMgrsLabels && zoom >= 8;
  if (!shouldRenderLines && !shouldRenderMgrsLabels) {
    return createEmptyUtmGridData(zone, zoom);
  }

  const bounds = getViewportBoundsForGrid(center, zoom, canvas);
  const majorLines = shouldRenderLines
    ? createUtmGridLines(zone, bounds, UTM_GRID_MAJOR_STEP_METERS)
    : [];
  const shouldRenderMinor = shouldRenderLines && zoom >= 11;
  const minorLines = shouldRenderMinor ? createUtmGridLines(zone, bounds, UTM_GRID_MINOR_STEP_METERS) : [];
  const shouldRenderMgrsBoundaries = (showUtmGrid || showMgrsLabels) && zoom >= 8;
  const mgrsBoundaryLines = shouldRenderMgrsBoundaries
    ? createUtmGridLines(zone, bounds, UTM_GRID_MGRS_STEP_METERS)
    : [];
  const mgrs100kmLabels = shouldRenderMgrsLabels ? createMgrs100kmLabels(zone, bounds, zoom) : [];

  return {
    zone,
    epsg: getUtmEpsgByZone(zone),
    zoom,
    majorLines,
    minorLines,
    mgrsBoundaryLines,
    mgrs100kmLabels,
    viewportSignature: [
      UTM_GRID_LAYER_SIGNATURE,
      zone,
      getUtmEpsgByZone(zone),
      zoom,
      bounds.minLat.toFixed(4),
      bounds.maxLat.toFixed(4),
      bounds.minLon.toFixed(4),
      bounds.maxLon.toFixed(4),
      majorLines.length,
      minorLines.length,
      mgrsBoundaryLines.length,
      mgrs100kmLabels.length,
      mgrs100kmLabels[0]?.id ?? 'none',
      mgrs100kmLabels[mgrs100kmLabels.length - 1]?.id ?? 'none',
    ].join(':'),
  };
};

const toRecord = (value: unknown): Record<string, unknown> => {
  if (typeof value === 'object' && value !== null) {
    return value as Record<string, unknown>;
  }
  return {};
};

const pickStringFromRecord = (record: Record<string, unknown>, keys: string[]): string => {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return '';
};

const toGeoPoint = (coordinate: unknown): GeoPoint | null => {
  if (!Array.isArray(coordinate) || coordinate.length < 2) return null;
  const lon = Number(coordinate[0]);
  const lat = Number(coordinate[1]);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
  return { lat, lon };
};

const getFeatureName = (properties: unknown): string => {
  const record = toRecord(properties);
  const candidates = [
    record.name,
    record.kor_nm,
    record.adm_nm,
    record.emd_nm,
    record.emd_kor_nm,
    record.EMD_KOR_NM,
    record.ctp_kor_nm,
    record.CTP_KOR_NM,
    record.sgg_kor_nm,
    record.SGG_KOR_NM,
    record.sidonm,
    record.sggnm,
  ];
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) {
      return candidate.trim();
    }
  }
  return '';
};

const toCentroid = (points: GeoPoint[]): GeoPoint | null => {
  if (points.length === 0) return null;
  let sumLat = 0;
  let sumLon = 0;
  points.forEach((point) => {
    sumLat += point.lat;
    sumLon += point.lon;
  });
  return {
    lat: sumLat / points.length,
    lon: sumLon / points.length,
  };
};

const extractPolylinesFromGeometry = (geometry: unknown, name?: string): GeoPolyline[] => {
  const record = toRecord(geometry);
  const type = typeof record.type === 'string' ? record.type : '';
  const coordinates = record.coordinates;
  const polylines: GeoPolyline[] = [];

  if (type === 'LineString' && Array.isArray(coordinates)) {
    const points = coordinates
      .map((coordinate) => toGeoPoint(coordinate))
      .filter((point): point is GeoPoint => point !== null);
    if (points.length > 1) polylines.push({ name, points });
    return polylines;
  }

  if (type === 'MultiLineString' && Array.isArray(coordinates)) {
    coordinates.forEach((line) => {
      if (!Array.isArray(line)) return;
      const points = line
        .map((coordinate) => toGeoPoint(coordinate))
        .filter((point): point is GeoPoint => point !== null);
      if (points.length > 1) polylines.push({ name, points });
    });
    return polylines;
  }

  if (type === 'Polygon' && Array.isArray(coordinates)) {
    coordinates.forEach((ring) => {
      if (!Array.isArray(ring)) return;
      const points = ring
        .map((coordinate) => toGeoPoint(coordinate))
        .filter((point): point is GeoPoint => point !== null);
      if (points.length > 1) polylines.push({ name, points });
    });
    return polylines;
  }

  if (type === 'MultiPolygon' && Array.isArray(coordinates)) {
    coordinates.forEach((polygon) => {
      if (!Array.isArray(polygon)) return;
      polygon.forEach((ring) => {
        if (!Array.isArray(ring)) return;
        const points = ring
          .map((coordinate) => toGeoPoint(coordinate))
          .filter((point): point is GeoPoint => point !== null);
        if (points.length > 1) polylines.push({ name, points });
      });
    });
  }

  return polylines;
};

const extractPolylinesFromGeoJson = (geoJson: unknown): GeoPolyline[] => {
  const record = toRecord(geoJson);
  const type = typeof record.type === 'string' ? record.type : '';

  if (type === 'FeatureCollection' && Array.isArray(record.features)) {
    const polylines: GeoPolyline[] = [];
    record.features.forEach((feature) => {
      const featureRecord = toRecord(feature);
      const featureName = getFeatureName(featureRecord.properties);
      polylines.push(...extractPolylinesFromGeometry(featureRecord.geometry, featureName));
    });
    return polylines;
  }

  if (type === 'Feature') {
    return extractPolylinesFromGeometry(record.geometry, getFeatureName(record.properties));
  }

  return extractPolylinesFromGeometry(record, '');
};

const extractLabelsFromGeoJson = (geoJson: unknown): GeoLabel[] => {
  const record = toRecord(geoJson);
  const type = typeof record.type === 'string' ? record.type : '';
  const labels: GeoLabel[] = [];

  const pushLabel = (name: string, point: GeoPoint | null) => {
    if (!name || !point) return;
    labels.push({ name, point });
  };

  const handleFeature = (feature: unknown) => {
    const featureRecord = toRecord(feature);
    const name = getFeatureName(featureRecord.properties);
    const geometry = toRecord(featureRecord.geometry);
    const geometryType = typeof geometry.type === 'string' ? geometry.type : '';

    if (geometryType === 'Point') {
      pushLabel(name, toGeoPoint(geometry.coordinates));
      return;
    }

    if (geometryType === 'MultiPoint' && Array.isArray(geometry.coordinates)) {
      geometry.coordinates.forEach((coordinate) => pushLabel(name, toGeoPoint(coordinate)));
      return;
    }

    const polylines = extractPolylinesFromGeometry(geometry, name);
    if (polylines.length === 0) return;
    const bestPolyline = polylines.reduce((best, current) =>
      current.points.length > best.points.length ? current : best
    );
    const centroid = toCentroid(bestPolyline.points);
    pushLabel(name, centroid);
  };

  if (type === 'FeatureCollection' && Array.isArray(record.features)) {
    record.features.forEach((feature) => handleFeature(feature));
  } else if (type === 'Feature') {
    handleFeature(record);
  } else {
    const polylines = extractPolylinesFromGeometry(record);
    if (polylines.length > 0) {
      const bestPolyline = polylines.reduce((best, current) =>
        current.points.length > best.points.length ? current : best
      );
      const centroid = toCentroid(bestPolyline.points);
      pushLabel('', centroid);
    }
  }

  const deduped = new Map<string, GeoLabel>();
  labels.forEach((label) => {
    const key = `${label.name}:${label.point.lat.toFixed(4)}:${label.point.lon.toFixed(4)}`;
    if (!deduped.has(key)) {
      deduped.set(key, label);
    }
  });
  return removeSejongShortDuplicate(Array.from(deduped.values()));
};

const extractPointFromGeometry = (geometry: unknown): GeoPoint | null => {
  const record = toRecord(geometry);
  const geometryType = typeof record.type === 'string' ? record.type : '';

  if (geometryType === 'Point') {
    return toGeoPoint(record.coordinates);
  }

  if (geometryType === 'MultiPoint' && Array.isArray(record.coordinates)) {
    const points = record.coordinates
      .map((coordinate) => toGeoPoint(coordinate))
      .filter((point): point is GeoPoint => point !== null);
    return toCentroid(points);
  }

  const polylines = extractPolylinesFromGeometry(record);
  if (polylines.length === 0) return null;
  const bestPolyline = polylines.reduce((best, current) =>
    current.points.length > best.points.length ? current : best
  );
  return toCentroid(bestPolyline.points);
};

const aggregateLabels = (
  target: Map<string, { sumLat: number; sumLon: number; count: number }>,
  name: string,
  point: GeoPoint | null
) => {
  if (!name || !point) return;
  const current = target.get(name);
  if (!current) {
    target.set(name, {
      sumLat: point.lat,
      sumLon: point.lon,
      count: 1,
    });
    return;
  }
  current.sumLat += point.lat;
  current.sumLon += point.lon;
  current.count += 1;
};

const toAggregatedLabels = (
  source: Map<string, { sumLat: number; sumLon: number; count: number }>
): GeoLabel[] =>
  Array.from(source.entries()).map(([name, value]) => ({
    name,
    point: {
      lat: value.sumLat / value.count,
      lon: value.sumLon / value.count,
    },
  }));

const normalizeAdminLabelName = (name: string) => name.replace(/\s+/g, '').trim();

const removeSejongShortDuplicate = (labels: GeoLabel[]): GeoLabel[] => {
  const normalizedNames = new Set(labels.map((label) => normalizeAdminLabelName(label.name)));
  if (!normalizedNames.has('세종특별자치시')) {
    return labels;
  }

  return labels.filter((label) => normalizeAdminLabelName(label.name) !== '세종시');
};

const removeSejongCrossLayerDuplicate = (
  labels: GeoLabel[],
  higherLevelLabels: GeoLabel[]
): GeoLabel[] => {
  const hasSejongSpecialCity = higherLevelLabels.some(
    (label) => normalizeAdminLabelName(label.name) === '세종특별자치시'
  );
  if (!hasSejongSpecialCity) {
    return labels;
  }
  return labels.filter((label) => normalizeAdminLabelName(label.name) !== '세종시');
};

const extractAdminLabelLayersFromGeoJson = (geoJson: unknown): AdminLabelLayers => {
  const province = new Map<string, { sumLat: number; sumLon: number; count: number }>();
  const district = new Map<string, { sumLat: number; sumLon: number; count: number }>();
  const emd = new Map<string, { sumLat: number; sumLon: number; count: number }>();
  const record = toRecord(geoJson);
  const type = typeof record.type === 'string' ? record.type : '';

  const handleFeature = (feature: unknown) => {
    const featureRecord = toRecord(feature);
    const properties = toRecord(featureRecord.properties);
    const point = extractPointFromGeometry(featureRecord.geometry);

    const provinceName = pickStringFromRecord(properties, [
      'CTP_KOR_NM',
      'ctp_kor_nm',
      'sidonm',
      'SIDO_NM',
      'sido_nm',
      'sido',
      'province',
    ]);
    const districtName = pickStringFromRecord(properties, [
      'SGG_KOR_NM',
      'sgg_kor_nm',
      'sggnm',
      'SIGUNGU_NM',
      'sigungu_nm',
      'sigungu',
      'district',
    ]);
    const emdName =
      pickStringFromRecord(properties, [
        'EMD_KOR_NM',
        'emd_kor_nm',
        'EMD_NM',
        'emd_nm',
        'ADM_NM',
        'adm_nm',
        'dong_nm',
      ]) || getFeatureName(properties);

    aggregateLabels(province, provinceName, point);
    aggregateLabels(district, districtName, point);
    aggregateLabels(emd, emdName, point);
  };

  if (type === 'FeatureCollection' && Array.isArray(record.features)) {
    record.features.forEach((feature) => handleFeature(feature));
  } else if (type === 'Feature') {
    handleFeature(record);
  }

  return {
    province: removeSejongShortDuplicate(toAggregatedLabels(province)),
    district: removeSejongShortDuplicate(toAggregatedLabels(district)),
    emd: removeSejongShortDuplicate(toAggregatedLabels(emd)),
  };
};

export function LidarSpatialView({
  objects,
  selectedObjectId,
  onSelectObject,
  mapCenter,
  detectionMode,
  computeMode,
  mapTheme,
  mapLabelLevel,
  showUtmGrid,
  showMgrsLabels,
  mapDataPath,
  mapDataLoadNonce,
  layoutDevConfig,
}: LidarSpatialViewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const canvasContainerRef = useRef<HTMLDivElement>(null);
  const tileCacheRef = useRef<Map<string, TileState>>(new Map());
  const staticLayerCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const staticLayerKeyRef = useRef('');
  const viewCenterRef = useRef<GeoPoint>(mapCenter);
  const dragRef = useRef<DragState>({
    dragging: false,
    moved: false,
    lastX: 0,
    lastY: 0,
  });
  const [fontsReady, setFontsReady] = useState(false);
  const [tileVersion, setTileVersion] = useState(0);
  const [mapZoom, setMapZoom] = useState(DEFAULT_MAP_ZOOM);
  const [mapViewCenter, setMapViewCenter] = useState<GeoPoint>(mapCenter);
  const [isDragging, setIsDragging] = useState(false);
  const [hoveredObjectId, setHoveredObjectId] = useState<string | null>(null);
  const [officialBoundaryLines, setOfficialBoundaryLines] = useState<GeoPolyline[]>([]);
  const [officialSeaLines, setOfficialSeaLines] = useState<GeoPolyline[]>([]);
  const [officialAirspaceLines, setOfficialAirspaceLines] = useState<GeoPolyline[]>([]);
  const [officialProvinceLabels, setOfficialProvinceLabels] = useState<GeoLabel[]>([]);
  const [officialDistrictLabels, setOfficialDistrictLabels] = useState<GeoLabel[]>([]);
  const [officialEmdLabels, setOfficialEmdLabels] = useState<GeoLabel[]>([]);
  const [officialSourceLabel, setOfficialSourceLabel] = useState('Fallback');
  const [officialDataLoaded, setOfficialDataLoaded] = useState(false);
  const [canvasSize, setCanvasSize] = useState({ width: 700, height: 820 });
  const [utmGridData, setUtmGridData] = useState<UtmGridData>(() =>
    createEmptyUtmGridData(getUtmZoneByLongitude(mapCenter.lon), DEFAULT_MAP_ZOOM)
  );

  useEffect(() => {
    // Settings-provided coordinate is the fixed radar site center.
    viewCenterRef.current = mapCenter;
    setMapViewCenter(mapCenter);
  }, [mapCenter]);

  useEffect(() => {
    if (typeof document === 'undefined' || !('fonts' in document)) {
      setFontsReady(true);
      return;
    }

    const fontSet = document.fonts;
    Promise.all([
      fontSet.load('400 14px "ARGUS Korean"'),
      fontSet.load('700 14px "ARGUS Korean"'),
    ])
      .catch(() => {
        // Keep rendering even if explicit preload fails.
      })
      .finally(() => {
        setFontsReady(true);
      });
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    try {
      const saved = window.localStorage.getItem(MAP_ZOOM_STORAGE_KEY);
      if (!saved) return;

      const parsed = Number(saved);
      if (!Number.isFinite(parsed)) return;

      const nextZoom = clamp(Math.round(parsed), MIN_MAP_ZOOM, MAX_MAP_ZOOM);
      setMapZoom(nextZoom);
    } catch {
      // Ignore malformed saved zoom.
    }
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(MAP_ZOOM_STORAGE_KEY, String(mapZoom));
  }, [mapZoom]);

  useEffect(() => {
    const container = canvasContainerRef.current;
    if (!container) return;

    const updateCanvasSize = () => {
      const rect = container.getBoundingClientRect();
      const nextWidth = Math.max(360, Math.floor(rect.width));
      const nextHeight = Math.max(360, Math.floor(rect.height));
      setCanvasSize((prev) =>
        prev.width === nextWidth && prev.height === nextHeight
          ? prev
          : { width: nextWidth, height: nextHeight }
      );
    };

    updateCanvasSize();

    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', updateCanvasSize);
      return () => window.removeEventListener('resize', updateCanvasSize);
    }

    const observer = new ResizeObserver(() => updateCanvasSize());
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    tileCacheRef.current.clear();
    staticLayerKeyRef.current = '';
    setTileVersion((prev) => prev + 1);
  }, [mapTheme]);

  useEffect(() => {
    // Recreate raster pipeline when compute mode toggles so 2D context hints are reapplied.
    staticLayerCanvasRef.current = null;
    staticLayerKeyRef.current = '';
    setTileVersion((prev) => prev + 1);
  }, [computeMode]);

  useEffect(() => {
    let cancelled = false;
    const normalizedBasePath = (mapDataPath || DEFAULT_OFFICIAL_DATA_BASE_PATH).trim().replace(/\/+$/, '') || DEFAULT_OFFICIAL_DATA_BASE_PATH;
    const cacheBuster = Date.now();
    const runtime = (window as Window & { radarRuntime?: RadarRuntimeBridge }).radarRuntime;
    const canReadLocalDirectory =
      isLikelyFilesystemPath(normalizedBasePath) &&
      typeof runtime?.readGeoJsonFromDirectory === 'function';

    const loadFirstGeoJson = async (fileNames: string[]) => {
      if (canReadLocalDirectory && runtime?.readGeoJsonFromDirectory) {
        try {
          const localResult = await runtime.readGeoJsonFromDirectory({
            basePath: normalizedBasePath,
            fileNames,
          });
          if (localResult?.ok && localResult.data) {
            return {
              path: localResult.path || `${normalizedBasePath}/${fileNames[0]}`,
              data: localResult.data,
            };
          }
        } catch {
          // Fallback to fetch.
        }
      }

      for (const fileName of fileNames) {
        const path = `${normalizedBasePath}/${fileName}`;
        try {
          const response = await fetch(`${path}?v=${cacheBuster}`, { cache: 'no-store' });
          if (!response.ok) continue;
          const data = (await response.json()) as unknown;
          return { path, data };
        } catch {
          continue;
        }
      }
      return null;
    };

    const loadOfficialData = async () => {
      const [boundaryResult, seaResult, airspaceResult, emdLabelResult] = await Promise.all([
        loadFirstGeoJson(OFFICIAL_BOUNDARY_FILES),
        loadFirstGeoJson(OFFICIAL_TERRITORIAL_FILES),
        loadFirstGeoJson(OFFICIAL_AIRSPACE_FILES),
        loadFirstGeoJson(OFFICIAL_EMD_LABEL_FILES),
      ]);

      if (cancelled) return;

      const boundaryLines = boundaryResult ? extractPolylinesFromGeoJson(boundaryResult.data) : [];
      const seaLines = seaResult ? extractPolylinesFromGeoJson(seaResult.data) : [];
      const airspaceLines = airspaceResult ? extractPolylinesFromGeoJson(airspaceResult.data) : [];
      const adminLabels = emdLabelResult
        ? extractAdminLabelLayersFromGeoJson(emdLabelResult.data)
        : { province: [], district: [], emd: [] };
      const fallbackLabels = emdLabelResult ? extractLabelsFromGeoJson(emdLabelResult.data) : [];
      const emdLabels = adminLabels.emd.length > 0 ? adminLabels.emd : fallbackLabels;

      const hasOfficialData =
        boundaryLines.length > 0 ||
        seaLines.length > 0 ||
        airspaceLines.length > 0 ||
        adminLabels.province.length > 0 ||
        adminLabels.district.length > 0 ||
        emdLabels.length > 0;

      setOfficialBoundaryLines(boundaryLines);
      setOfficialSeaLines(seaLines);
      setOfficialAirspaceLines(airspaceLines);
      setOfficialProvinceLabels(adminLabels.province);
      setOfficialDistrictLabels(adminLabels.district);
      setOfficialEmdLabels(emdLabels);
      setOfficialDataLoaded(hasOfficialData);

      if (hasOfficialData) {
        const loadedPaths = [
          boundaryResult?.path,
          seaResult?.path,
          airspaceResult?.path,
          emdLabelResult?.path,
        ].filter((path): path is string => Boolean(path));
        setOfficialSourceLabel(
          `${normalizedBasePath} (${loadedPaths.map((path) => path.split('/').pop()).join(', ')})`
        );
      } else {
        setOfficialSourceLabel(`${normalizedBasePath} (Fallback: 공식 GeoJSON 미탑재)`);
      }
    };

    void loadOfficialData();

    return () => {
      cancelled = true;
    };
  }, [mapDataPath, mapDataLoadNonce]);

  useEffect(() => {
    const zone = getStableUtmZoneByLongitude(mapViewCenter.lon, utmGridData.zone);
    if (!showUtmGrid && !showMgrsLabels) {
      const emptyData = createEmptyUtmGridData(zone, mapZoom);
      setUtmGridData((prev) =>
        prev.viewportSignature === emptyData.viewportSignature ? prev : emptyData
      );
      return;
    }
    // Keep drag interaction smooth: rebuild the meter grid after movement settles.
    if (isDragging) {
      return;
    }

    if (typeof window === 'undefined') return;

    let cancelled = false;
    let rafId = 0;
    const timeoutId = window.setTimeout(() => {
      rafId = window.requestAnimationFrame(() => {
        if (cancelled) return;
        const nextGrid = buildUtmGridDataForViewport(
          mapViewCenter,
          mapZoom,
          canvasSize,
          utmGridData.zone,
          showUtmGrid,
          showMgrsLabels
        );
        setUtmGridData((prev) =>
          prev.viewportSignature === nextGrid.viewportSignature ? prev : nextGrid
        );
      });
    }, UTM_GRID_DEBOUNCE_MS);

    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
      if (rafId) {
        window.cancelAnimationFrame(rafId);
      }
    };
  }, [
    showUtmGrid,
    showMgrsLabels,
    mapZoom,
    isDragging,
    utmGridData.zone,
    mapViewCenter.lat,
    mapViewCenter.lon,
    canvasSize.width,
    canvasSize.height,
  ]);

  const requestTile = (theme: 'DARK' | 'LIGHT', z: number, x: number, y: number): TileState => {
    const key = `${theme}:${z}/${x}/${y}`;
    const cached = tileCacheRef.current.get(key);
    if (cached) return cached;

    const image = new Image();
    const tileState: TileState = {
      image,
      loaded: false,
      failed: false,
    };

    image.onload = () => {
      tileState.loaded = true;
      setTileVersion((prev) => prev + 1);
    };
    let attemptedFallback = false;
    image.onerror = () => {
      if (!attemptedFallback) {
        attemptedFallback = true;
        image.src = `https://tile.openstreetmap.org/${z}/${x}/${y}.png`;
        return;
      }
      tileState.failed = true;
      setTileVersion((prev) => prev + 1);
    };
    image.crossOrigin = 'anonymous';
    image.src = `https://a.basemaps.cartocdn.com/${
      theme === 'DARK' ? 'dark_nolabels' : 'light_nolabels'
    }/${z}/${x}/${y}.png`;

    tileCacheRef.current.set(key, tileState);
    return tileState;
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const isCpuRenderMode = computeMode === 'CPU_ONLY';
    const ctx = canvas.getContext(
      '2d',
      isCpuRenderMode
        ? { alpha: false, desynchronized: false, willReadFrequently: true }
        : { alpha: false, desynchronized: true }
    );
    if (!ctx) return;

    const width = canvas.width;
    const height = canvas.height;
    const centerX = width / 2;
    const centerY = height / 2;
    const scale = getRadarScaleFromLatitude(mapCenter.lat, mapZoom);
    const monoCanvasFont =
      '"JetBrains Mono", "D2Coding", "Consolas", "ARGUS Korean", "Malgun Gothic", monospace';
    const koreanCanvasFont =
      '"ARGUS Korean", "Noto Sans CJK KR", "Apple SD Gothic Neo", "Malgun Gothic", sans-serif';
    const isDarkTheme = mapTheme === 'DARK';
    const isSpeedPriorityMode = detectionMode === 'SPEED';
    const lowDetailMode = isSpeedPriorityMode && isDragging;
    const showDistrictLabels =
      !lowDetailMode && (mapLabelLevel === 'DISTRICT' || mapLabelLevel === 'EMD');
    const showEmdLabels = !lowDetailMode && mapLabelLevel === 'EMD';
    const tileFilter = isCpuRenderMode
      ? 'none'
      : isDarkTheme
        ? 'grayscale(100%) brightness(28%) contrast(125%)'
        : 'grayscale(45%) brightness(92%) contrast(108%)';
    const tileAlpha = isDarkTheme ? DARK_TILE_ALPHA : LIGHT_TILE_ALPHA;
    const shouldRenderBasemapTiles = isDarkTheme || SHOW_BASEMAP_IN_LIGHT_THEME;
    const overlayColor = isDarkTheme ? TACTICAL_DARK_OVERLAY : TACTICAL_LIGHT_OVERLAY;
    const baseFill = isDarkTheme ? '#0b0f14' : '#dfe8ee';
    const ringColor = isDarkTheme ? 'rgba(74, 255, 128, 0.52)' : 'rgba(21, 94, 45, 0.52)';
    const ringLabelColor = isDarkTheme ? 'rgba(187, 255, 204, 0.98)' : 'rgba(20, 83, 45, 0.96)';
    const utmGridStyle = isDarkTheme ? UTM_GRID_THEME_STYLE.DARK : UTM_GRID_THEME_STYLE.LIGHT;
    const minorGridLineWidth = mapZoom >= 15 ? 1.2 : utmGridStyle.minorLineWidth;
    const airspaceStroke = isDarkTheme ? '#a855f7' : 'rgba(20, 20, 20, 0.64)';
    const seaStroke = isDarkTheme ? '#22d3ee' : 'rgba(18, 18, 18, 0.72)';
    const boundaryStroke = isDarkTheme ? '#7dd3fc' : 'rgba(8, 8, 8, 0.82)';
    const territorialLabelColor = isDarkTheme ? 'rgba(125, 211, 252, 0.88)' : 'rgba(0, 0, 0, 0.92)';
    const airspaceLabelColor = isDarkTheme ? 'rgba(168, 85, 247, 0.75)' : 'rgba(0, 0, 0, 0.92)';
    const emdStroke = isDarkTheme ? 'rgba(2, 8, 12, 0.92)' : 'rgba(255, 255, 255, 0.98)';
    const emdFill = isDarkTheme ? 'rgba(202, 237, 255, 0.9)' : 'rgba(8, 12, 20, 0.92)';
    const mapPrimaryText = isDarkTheme ? '#f8fafc' : '#0b1220';
    const mapMutedText = isDarkTheme ? '#94a3b8' : '#334155';
    const candidateInfoText = isDarkTheme ? '#fbbf24' : '#92400e';
    const provinceFontSize = 17;
    const districtFontSize = 12;
    const emdFontSize = 10;
    const ringLabelFontSize = 24;
    const ringLabelYOffset = Math.max(14, ringLabelFontSize + 2);
    const provinceLabelDistanceX = 46;
    const provinceLabelDistanceY = 18;
    const districtLabelDistanceX = 34;
    const districtLabelDistanceY = 13;
    const emdLabelDistanceX = 30;
    const emdLabelDistanceY = 12;

    const worldViewCenter = projectLatLonToWorld(mapViewCenter.lat, mapViewCenter.lon, mapZoom);
    const worldRadarCenter = projectLatLonToWorld(mapCenter.lat, mapCenter.lon, mapZoom);
    const radarCenterCanvas = {
      x: centerX + (worldRadarCenter.x - worldViewCenter.x),
      y: centerY + (worldRadarCenter.y - worldViewCenter.y),
    };
    const topLeftWorldX = worldViewCenter.x - width / 2;
    const topLeftWorldY = worldViewCenter.y - height / 2;
    const worldTileCount = 2 ** mapZoom;
    const boundarySignature = `${officialBoundaryLines.length}:${
      officialBoundaryLines[0]?.points.length ?? 0
    }:${officialBoundaryLines[officialBoundaryLines.length - 1]?.points.length ?? 0}`;
    const seaSignature = `${officialSeaLines.length}:${
      officialSeaLines[0]?.points.length ?? 0
    }:${officialSeaLines[officialSeaLines.length - 1]?.points.length ?? 0}`;
    const airspaceSignature = `${officialAirspaceLines.length}:${
      officialAirspaceLines[0]?.points.length ?? 0
    }:${officialAirspaceLines[officialAirspaceLines.length - 1]?.points.length ?? 0}`;
    const labelSignature = `${officialProvinceLabels.length}:${officialDistrictLabels.length}:${officialEmdLabels.length}`;
    const staticLayerKey = [
      width,
      height,
      mapTheme,
      mapLabelLevel,
      mapZoom,
      mapCenter.lat.toFixed(6),
      mapCenter.lon.toFixed(6),
      mapViewCenter.lat.toFixed(6),
      mapViewCenter.lon.toFixed(6),
      computeMode,
      tileVersion,
      fontsReady ? 1 : 0,
      officialDataLoaded ? 1 : 0,
      officialSourceLabel,
      boundarySignature,
      seaSignature,
      airspaceSignature,
      labelSignature,
      showUtmGrid || showMgrsLabels
        ? utmGridData.viewportSignature
        : `${UTM_GRID_LAYER_SIGNATURE}:off`,
      isSpeedPriorityMode ? 1 : 0,
      lowDetailMode ? 1 : 0,
    ].join('|');

    if (!staticLayerCanvasRef.current) {
      staticLayerCanvasRef.current = document.createElement('canvas');
    }

    const staticCanvas = staticLayerCanvasRef.current;
    if (!staticCanvas) return;
    if (staticCanvas.width !== width || staticCanvas.height !== height) {
      staticCanvas.width = width;
      staticCanvas.height = height;
      staticLayerKeyRef.current = '';
    }

    const staticCtx = staticCanvas.getContext(
      '2d',
      isCpuRenderMode
        ? { alpha: false, desynchronized: false, willReadFrequently: true }
        : { alpha: false, desynchronized: true }
    );
    const shouldRenderStaticLayer =
      !isSpeedPriorityMode || !staticCtx || staticLayerKeyRef.current !== staticLayerKey;

    let hasVisibleTile = false;
    const startTileX = Math.floor(topLeftWorldX / TILE_SIZE);
    const endTileX = Math.floor((topLeftWorldX + width) / TILE_SIZE);
    const startTileY = Math.floor(topLeftWorldY / TILE_SIZE);
    const endTileY = Math.floor((topLeftWorldY + height) / TILE_SIZE);

    const toCanvasPointFromGeo = (lat: number, lon: number) => {
      const worldPoint = projectLatLonToWorld(lat, lon, mapZoom);
      return {
        x: centerX + (worldPoint.x - worldViewCenter.x),
        y: centerY + (worldPoint.y - worldViewCenter.y),
      };
    };

    if (!shouldRenderStaticLayer) {
      ctx.clearRect(0, 0, width, height);
      ctx.drawImage(staticCanvas, 0, 0, width, height);
    } else {
      ctx.clearRect(0, 0, width, height);
      ctx.fillStyle = baseFill;
      ctx.fillRect(0, 0, width, height);

      if (shouldRenderBasemapTiles) {
        for (let tileY = startTileY - 1; tileY <= endTileY + 1; tileY += 1) {
          if (tileY < 0 || tileY >= worldTileCount) continue;

          for (let tileX = startTileX - 1; tileX <= endTileX + 1; tileX += 1) {
            const wrappedTileX = ((tileX % worldTileCount) + worldTileCount) % worldTileCount;
            const tile = requestTile(mapTheme, mapZoom, wrappedTileX, tileY);
            if (!tile.loaded || tile.failed) continue;

            const drawX = tileX * TILE_SIZE - topLeftWorldX;
            const drawY = tileY * TILE_SIZE - topLeftWorldY;
            ctx.save();
            ctx.filter = tileFilter;
            ctx.globalAlpha = tileAlpha;
            ctx.drawImage(tile.image, drawX, drawY, TILE_SIZE, TILE_SIZE);
            ctx.restore();
            hasVisibleTile = true;
          }
        }
      }

      if (!hasVisibleTile) {
        ctx.fillStyle = isDarkTheme ? '#05080d' : '#dfe8ee';
        ctx.fillRect(0, 0, width, height);
      }

      ctx.fillStyle = hasVisibleTile && shouldRenderBasemapTiles
        ? overlayColor
        : isDarkTheme
          ? 'rgba(6, 12, 18, 0.72)'
          : 'rgba(8, 18, 30, 0.1)';
      ctx.fillRect(0, 0, width, height);

      if (!hasVisibleTile && shouldRenderBasemapTiles) {
        ctx.save();
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.font = `700 24px ${monoCanvasFont}`;
        ctx.fillStyle = isDarkTheme ? 'rgba(125, 211, 252, 0.9)' : 'rgba(15, 23, 42, 0.82)';
        ctx.fillText('Map Loading', centerX, centerY);
        ctx.restore();
      }
    }

    const drawGeoPolyline = (
      points: GeoPoint[],
      strokeStyle: string,
      lineWidth: number,
      dash: number[] = [],
      alpha = 1
    ) => {
      if (points.length < 2) return;
      ctx.save();
      ctx.strokeStyle = strokeStyle;
      ctx.lineWidth = lineWidth;
      ctx.globalAlpha = alpha;
      ctx.setLineDash(dash);
      const start = toCanvasPointFromGeo(points[0].lat, points[0].lon);
      ctx.beginPath();
      ctx.moveTo(start.x, start.y);
      points.slice(1).forEach((point) => {
        const canvasPoint = toCanvasPointFromGeo(point.lat, point.lon);
        ctx.lineTo(canvasPoint.x, canvasPoint.y);
      });
      ctx.stroke();
      ctx.restore();
    };

    if (shouldRenderStaticLayer) {
      // Dynamic UTM meter grid (source: argus-utm-grid, layers: argus-utm-10km / argus-utm-1km).
      // Draw first to keep it below tactical tracks/icons/radar markers.
      if (showUtmGrid) {
        const shouldDrawMinorGrid = mapZoom >= 11 && utmGridData.minorLines.length > 0;
        if (shouldDrawMinorGrid) {
          utmGridData.minorLines.forEach((line) => {
            drawGeoPolyline(
              line.points,
              utmGridStyle.minorLineColor,
              minorGridLineWidth,
              utmGridStyle.minorLineDash,
              1
            );
          });
        }

        utmGridData.majorLines.forEach((line) => {
          drawGeoPolyline(
            line.points,
            utmGridStyle.majorLineColor,
            utmGridStyle.majorLineWidth,
            utmGridStyle.majorLineDash,
            1
          );
        });
      }

      const shouldDrawMgrsBoundaries = mapZoom >= 8 && utmGridData.mgrsBoundaryLines.length > 0;
      if (shouldDrawMgrsBoundaries) {
        utmGridData.mgrsBoundaryLines.forEach((line) => {
          drawGeoPolyline(
            line.points,
            utmGridStyle.mgrsBoundaryLineColor,
            utmGridStyle.mgrsBoundaryLineWidth,
            utmGridStyle.mgrsBoundaryLineDash,
            1
          );
        });
      }

      if (showMgrsLabels && mapZoom >= 8 && utmGridData.mgrs100kmLabels.length > 0) {
        const mgrsFontSize =
          mapZoom >= 12 ? utmGridStyle.mgrsLabelFontSizeZoomed : utmGridStyle.mgrsLabelFontSize;
        const mgrsCoordFontSize = utmGridStyle.mgrsCoordFontSize;
        const showSixDigitCoords = mapZoom >= 12;
        const drawSpacedLabelLeft = (text: string, x: number, y: number, spacing: number) => {
          const chars = Array.from(text);
          if (chars.length === 0) return;
          let cursorX = x;
          chars.forEach((char) => {
            ctx.strokeText(char, cursorX, y);
            ctx.fillText(char, cursorX, y);
            cursorX += ctx.measureText(char).width + spacing;
          });
        };

        ctx.save();
        ctx.font = `600 ${mgrsFontSize}px ${monoCanvasFont}`;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.lineWidth = 1.2;
        ctx.strokeStyle = utmGridStyle.mgrsLabelStroke;
        ctx.fillStyle = utmGridStyle.mgrsLabelFill;

        utmGridData.mgrs100kmLabels.forEach((label) => {
          const canvasPoint = toCanvasPointFromGeo(label.point.lat, label.point.lon);
          const estimatedMainWidth = mgrsFontSize * 2.4;
          const leftMargin = 8;
          const rightMargin = estimatedMainWidth + 12;
          const topMargin = showSixDigitCoords ? mgrsFontSize * 0.7 : mgrsFontSize * 0.55;
          const bottomMargin = showSixDigitCoords
            ? mgrsFontSize + mgrsCoordFontSize + 10
            : mgrsFontSize * 0.55;
          if (
            canvasPoint.x < leftMargin ||
            canvasPoint.x > width - rightMargin ||
            canvasPoint.y < topMargin ||
            canvasPoint.y > height - bottomMargin
          ) {
            return;
          }
          const mainLabelY = showSixDigitCoords ? canvasPoint.y - mgrsFontSize * 0.34 : canvasPoint.y;
          drawSpacedLabelLeft(
            label.label,
            canvasPoint.x,
            mainLabelY,
            utmGridStyle.mgrsLabelLetterSpacing
          );

          if (showSixDigitCoords && label.sixDigit) {
            ctx.font = `500 ${mgrsCoordFontSize}px ${monoCanvasFont}`;
            ctx.lineWidth = 1;
            ctx.strokeStyle = utmGridStyle.mgrsCoordStroke;
            ctx.fillStyle = utmGridStyle.mgrsCoordFill;
            const coordY = mainLabelY + mgrsFontSize * 0.82;
            ctx.strokeText(label.sixDigit, canvasPoint.x, coordY);
            ctx.fillText(label.sixDigit, canvasPoint.x, coordY);
            ctx.font = `600 ${mgrsFontSize}px ${monoCanvasFont}`;
            ctx.lineWidth = 1.2;
            ctx.strokeStyle = utmGridStyle.mgrsLabelStroke;
            ctx.fillStyle = utmGridStyle.mgrsLabelFill;
          }
        });
        ctx.restore();
      }

      // Draw range rings (normalized display for requested radar scale labels)
      ctx.strokeStyle = ringColor;
      ctx.lineWidth = 1.5;
      const rangeRingsKm = [15, 10, 5, 3, 2, 1];
      const maxRangeKm = MAX_RANGE_KM;
      const maxRingRadiusPx = RADAR_UNITS_MAX * scale;
      rangeRingsKm.forEach((rangeKm) => {
        const radiusPx = (rangeKm / maxRangeKm) * maxRingRadiusPx;
        ctx.beginPath();
        ctx.arc(radarCenterCanvas.x, radarCenterCanvas.y, radiusPx, 0, Math.PI * 2);
        ctx.stroke();

        // Label
        ctx.fillStyle = ringLabelColor;
        ctx.font = `400 ${ringLabelFontSize}px ${monoCanvasFont}`;
        ctx.fillText(
          `${rangeKm}km`,
          radarCenterCanvas.x + 6,
          radarCenterCanvas.y - radiusPx + ringLabelYOffset
        );
      });

      // Tactical boundary overlays (official local GeoJSON preferred)
      const boundaryLineSet =
        officialBoundaryLines.length > 0
          ? officialBoundaryLines
          : [
              { points: KOREA_MAINLAND_BOUNDARY },
              { points: JEJU_BOUNDARY },
              { points: ULLEUNG_BOUNDARY },
            ];
      const seaLineSet =
        officialSeaLines.length > 0 ? officialSeaLines : [{ points: TERRITORIAL_SEA_LINE }];
      const airspaceLineSet =
        officialAirspaceLines.length > 0 ? officialAirspaceLines : [{ points: AIRSPACE_LINE }];

      airspaceLineSet.forEach((line) => drawGeoPolyline(line.points, airspaceStroke, 1.2, [8, 4], 0.5));
      seaLineSet.forEach((line) => drawGeoPolyline(line.points, seaStroke, 1.4, [4, 3], 0.65));
      boundaryLineSet.forEach((line) => drawGeoPolyline(line.points, boundaryStroke, 1.6, [], 0.84));

      ctx.fillStyle = territorialLabelColor;
      ctx.font = `700 ${Math.max(provinceFontSize, districtFontSize)}px ${koreanCanvasFont}`;
      const territorialLabel = toCanvasPointFromGeo(33.2, 125.0);
      ctx.fillText('영해 경계', territorialLabel.x, territorialLabel.y);
      ctx.fillStyle = airspaceLabelColor;
      const airspaceLabel = toCanvasPointFromGeo(39.1, 123.6);
      ctx.fillText('영공 경계', airspaceLabel.x, airspaceLabel.y);
    }

    const topLeft = unprojectWorldToLatLon(topLeftWorldX, topLeftWorldY, mapZoom);
    const bottomRight = unprojectWorldToLatLon(topLeftWorldX + width, topLeftWorldY + height, mapZoom);
    const minLat = Math.min(topLeft.lat, bottomRight.lat) - 0.03;
    const maxLat = Math.max(topLeft.lat, bottomRight.lat) + 0.03;
    const minLon = Math.min(topLeft.lon, bottomRight.lon) - 0.03;
    const maxLon = Math.max(topLeft.lon, bottomRight.lon) + 0.03;

    const boundaryLabelByName = new Map<string, { point: GeoPoint; size: number }>();
    officialBoundaryLines.forEach((line) => {
      if (!line.name) return;
      const centroid = toCentroid(line.points);
      if (!centroid) return;
      const current = boundaryLabelByName.get(line.name);
      if (!current || line.points.length > current.size) {
        boundaryLabelByName.set(line.name, { point: centroid, size: line.points.length });
      }
    });
    const fallbackProvinceLabels = Array.from(boundaryLabelByName.entries()).map(([name, value]) => ({
      name,
      point: value.point,
    }));

    const provinceLabels =
      officialProvinceLabels.length > 0 ? officialProvinceLabels : fallbackProvinceLabels;
    const districtLabels = removeSejongCrossLayerDuplicate(officialDistrictLabels, provinceLabels);

    const drawLabelLayer = (
      labels: GeoLabel[],
      options: {
        enabled: boolean;
        minZoom: number;
        baseDensity: number;
        fontSize: number;
        overlapX: number;
        overlapY: number;
        cullOverlap?: boolean;
      }
    ) => {
      if (!options.enabled || mapZoom < options.minZoom || labels.length === 0) return;
      const densityStep = Math.max(1, options.baseDensity);
      const placed: Array<{ x: number; y: number }> = [];

      labels.forEach((label, index) => {
        if (index % densityStep !== 0) return;
        if (
          label.point.lat < minLat ||
          label.point.lat > maxLat ||
          label.point.lon < minLon ||
          label.point.lon > maxLon
        ) {
          return;
        }

        const canvasPoint = toCanvasPointFromGeo(label.point.lat, label.point.lon);
        if (
          canvasPoint.x < -20 ||
          canvasPoint.x > width + 20 ||
          canvasPoint.y < -20 ||
          canvasPoint.y > height + 20
        ) {
          return;
        }

        if (options.cullOverlap !== false) {
          const isOverlapping = placed.some(
            (existing) =>
              Math.abs(existing.x - canvasPoint.x) < options.overlapX &&
              Math.abs(existing.y - canvasPoint.y) < options.overlapY
          );
          if (isOverlapping) return;
        }

        placed.push(canvasPoint);
        ctx.save();
        ctx.font = `600 ${options.fontSize}px ${koreanCanvasFont}`;
        ctx.textAlign = 'center';
        ctx.strokeStyle = emdStroke;
        ctx.lineWidth = 2;
        ctx.strokeText(label.name, canvasPoint.x, canvasPoint.y);
        ctx.fillStyle = emdFill;
        ctx.fillText(label.name, canvasPoint.x, canvasPoint.y);
        ctx.restore();
      });
    };

    if (shouldRenderStaticLayer) {
      drawLabelLayer(provinceLabels, {
        enabled: true,
        minZoom: 7,
        baseDensity: 1,
        fontSize: provinceFontSize,
        overlapX: provinceLabelDistanceX,
        overlapY: provinceLabelDistanceY,
        cullOverlap: false,
      });
      drawLabelLayer(districtLabels, {
        enabled: showDistrictLabels,
        minZoom: 9,
        baseDensity: 1,
        fontSize: districtFontSize,
        overlapX: districtLabelDistanceX,
        overlapY: districtLabelDistanceY,
        cullOverlap: true,
      });
      drawLabelLayer(officialEmdLabels, {
        enabled: showEmdLabels,
        minZoom: 11,
        baseDensity: mapZoom >= 13 ? 1 : mapZoom === 12 ? 2 : mapZoom === 11 ? 3 : 5,
        fontSize: emdFontSize,
        overlapX: emdLabelDistanceX,
        overlapY: emdLabelDistanceY,
        cullOverlap: true,
      });

      // Draw center crosshair (sensor position)
      ctx.strokeStyle = 'rgba(6, 182, 212, 0.6)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(radarCenterCanvas.x - 10, radarCenterCanvas.y);
      ctx.lineTo(radarCenterCanvas.x + 10, radarCenterCanvas.y);
      ctx.moveTo(radarCenterCanvas.x, radarCenterCanvas.y - 10);
      ctx.lineTo(radarCenterCanvas.x, radarCenterCanvas.y + 10);
      ctx.stroke();

      // Draw corner brackets at sensor
      const bracketSize = 20;
      ctx.strokeStyle = 'rgba(6, 182, 212, 0.5)';
      ctx.lineWidth = 2;
      // Top-left
      ctx.beginPath();
      ctx.moveTo(radarCenterCanvas.x - bracketSize, radarCenterCanvas.y - bracketSize + 5);
      ctx.lineTo(radarCenterCanvas.x - bracketSize, radarCenterCanvas.y - bracketSize);
      ctx.lineTo(radarCenterCanvas.x - bracketSize + 5, radarCenterCanvas.y - bracketSize);
      ctx.stroke();
      // Top-right
      ctx.beginPath();
      ctx.moveTo(radarCenterCanvas.x + bracketSize - 5, radarCenterCanvas.y - bracketSize);
      ctx.lineTo(radarCenterCanvas.x + bracketSize, radarCenterCanvas.y - bracketSize);
      ctx.lineTo(radarCenterCanvas.x + bracketSize, radarCenterCanvas.y - bracketSize + 5);
      ctx.stroke();
      // Bottom-left
      ctx.beginPath();
      ctx.moveTo(radarCenterCanvas.x - bracketSize, radarCenterCanvas.y + bracketSize - 5);
      ctx.lineTo(radarCenterCanvas.x - bracketSize, radarCenterCanvas.y + bracketSize);
      ctx.lineTo(radarCenterCanvas.x - bracketSize + 5, radarCenterCanvas.y + bracketSize);
      ctx.stroke();
      // Bottom-right
      ctx.beginPath();
      ctx.moveTo(radarCenterCanvas.x + bracketSize - 5, radarCenterCanvas.y + bracketSize);
      ctx.lineTo(radarCenterCanvas.x + bracketSize, radarCenterCanvas.y + bracketSize);
      ctx.lineTo(radarCenterCanvas.x + bracketSize, radarCenterCanvas.y + bracketSize - 5);
      ctx.stroke();

      if (isSpeedPriorityMode && staticCtx) {
        staticCtx.clearRect(0, 0, width, height);
        staticCtx.drawImage(canvas, 0, 0, width, height);
        staticLayerKeyRef.current = staticLayerKey;
      }
    }

    // Draw objects (ID by default, full details on hover/selection)
    const focusedObjectId = selectedObjectId ?? hoveredObjectId;
    const hasFocusedObject = Boolean(focusedObjectId);
    const objectsByPriority = [...objects].sort((a, b) => {
      const score = (obj: DetectedObject) => {
        if (obj.id === selectedObjectId) return 100;
        if (obj.id === hoveredObjectId) return 90;
        if (obj.riskLevel === 'CRITICAL') return 80;
        if (obj.riskLevel === 'HIGH') return 70;
        if (obj.riskLevel === 'MEDIUM') return 60;
        if (obj.status === 'CANDIDATE') return 10;
        return 20;
      };
      return score(a) - score(b);
    });
    const placedIdLabels: Array<{ x: number; y: number; w: number; h: number }> = [];

    objectsByPriority.forEach((obj) => {
      const currentPoint = obj.geoPosition
        ? toCanvasPointFromGeo(obj.geoPosition.lat, obj.geoPosition.lon)
        : {
            x: radarCenterCanvas.x + obj.position.x * scale,
            y: radarCenterCanvas.y - obj.position.y * scale,
          };
      const x = currentPoint.x;
      const y = currentPoint.y;

      const tone = getTrackTone(obj);
      const color = TACTICAL_TRACK_COLORS[tone];
      const isSelected = obj.id === selectedObjectId;
      const isHovered = obj.id === hoveredObjectId;
      const isFocused = isSelected || isHovered;
      const isCandidate = obj.status === 'CANDIDATE';
      const focusAlpha = hasFocusedObject && !isFocused ? 0.34 : 1;
      const { boxWidth, boxHeight } = getTrackMarkerBoxSize(obj, scale);

      // Draw track history trail
      if (obj.geoTrackHistory && obj.geoTrackHistory.length > 1) {
        ctx.save();
        ctx.strokeStyle = isCandidate ? mapMutedText : color;
        ctx.lineWidth = isSelected ? 2.4 : 1.8;
        ctx.globalAlpha = focusAlpha * (isCandidate ? 0.18 : 0.34);
        const firstPoint = toCanvasPointFromGeo(obj.geoTrackHistory[0].lat, obj.geoTrackHistory[0].lon);
        ctx.beginPath();
        ctx.moveTo(firstPoint.x, firstPoint.y);
        obj.geoTrackHistory.forEach((point) => {
          const plotPoint = toCanvasPointFromGeo(point.lat, point.lon);
          ctx.lineTo(plotPoint.x, plotPoint.y);
        });
        ctx.stroke();
        ctx.restore();
      } else if (obj.trackHistory.length > 1) {
        ctx.save();
        ctx.strokeStyle = isCandidate ? mapMutedText : color;
        ctx.lineWidth = isSelected ? 2.4 : 1.8;
        ctx.globalAlpha = focusAlpha * (isCandidate ? 0.18 : 0.34);
        ctx.beginPath();
        const firstPoint = obj.trackHistory[0];
        ctx.moveTo(
          radarCenterCanvas.x + firstPoint.x * scale,
          radarCenterCanvas.y - firstPoint.y * scale
        );
        obj.trackHistory.forEach((point) => {
          ctx.lineTo(radarCenterCanvas.x + point.x * scale, radarCenterCanvas.y - point.y * scale);
        });
        ctx.stroke();
        ctx.restore();
      }

      // Draw predicted path
      if (obj.geoPredictedPath && obj.geoPredictedPath.length > 0) {
        ctx.save();
        ctx.strokeStyle = isCandidate ? mapMutedText : color;
        ctx.lineWidth = 1.1;
        ctx.setLineDash([4, 4]);
        ctx.globalAlpha = focusAlpha * (isCandidate ? 0.22 : 0.46);
        ctx.beginPath();
        ctx.moveTo(x, y);
        obj.geoPredictedPath.forEach((point) => {
          const plotPoint = toCanvasPointFromGeo(point.lat, point.lon);
          ctx.lineTo(plotPoint.x, plotPoint.y);
        });
        ctx.stroke();
        ctx.restore();
      } else if (obj.predictedPath && obj.predictedPath.length > 0) {
        ctx.save();
        ctx.strokeStyle = isCandidate ? mapMutedText : color;
        ctx.lineWidth = 1.1;
        ctx.setLineDash([4, 4]);
        ctx.globalAlpha = focusAlpha * (isCandidate ? 0.22 : 0.46);
        ctx.beginPath();
        ctx.moveTo(x, y);
        obj.predictedPath.forEach((point) => {
          ctx.lineTo(radarCenterCanvas.x + point.x * scale, radarCenterCanvas.y - point.y * scale);
        });
        ctx.stroke();
        ctx.restore();
      }

      // Draw velocity vector
      const arrowLength = Math.min(100, Math.max(10, obj.speed * scale * 3));
      const fallbackArrowAngle = Math.atan2(-obj.velocity.y, obj.velocity.x);
      let arrowAngle = fallbackArrowAngle;
      if (obj.geoPredictedPath && obj.geoPredictedPath.length > 0) {
        const firstPredicted = toCanvasPointFromGeo(
          obj.geoPredictedPath[0].lat,
          obj.geoPredictedPath[0].lon
        );
        arrowAngle = Math.atan2(firstPredicted.y - y, firstPredicted.x - x);
      }
      const arrowEndX = x + Math.cos(arrowAngle) * arrowLength;
      const arrowEndY = y + Math.sin(arrowAngle) * arrowLength;
      ctx.save();
      ctx.strokeStyle = isCandidate ? mapMutedText : color;
      ctx.lineWidth = isFocused ? 2.2 : 1.7;
      ctx.globalAlpha = focusAlpha * (isCandidate ? 0.28 : 0.58);
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(arrowEndX, arrowEndY);
      ctx.stroke();
      const headSize = 7;
      ctx.beginPath();
      ctx.moveTo(arrowEndX, arrowEndY);
      ctx.lineTo(
        arrowEndX - headSize * Math.cos(arrowAngle - Math.PI / 6),
        arrowEndY - headSize * Math.sin(arrowAngle - Math.PI / 6)
      );
      ctx.moveTo(arrowEndX, arrowEndY);
      ctx.lineTo(
        arrowEndX - headSize * Math.cos(arrowAngle + Math.PI / 6),
        arrowEndY - headSize * Math.sin(arrowAngle + Math.PI / 6)
      );
      ctx.stroke();
      ctx.restore();

      // Draw bounding box
      ctx.save();
      ctx.strokeStyle = isCandidate ? mapMutedText : color;
      ctx.lineWidth = isSelected ? 3.2 : isHovered ? 2.6 : 1.8;
      ctx.globalAlpha = focusAlpha;
      if (isCandidate) {
        ctx.setLineDash([3, 3]);
      }
      if (tone === 'THREAT' && !isCandidate && !isCpuRenderMode) {
        ctx.shadowColor = '#ef4444';
        ctx.shadowBlur = 10;
      }
      if (isFocused && !isCpuRenderMode) {
        ctx.shadowColor = color;
        ctx.shadowBlur = 16;
      }
      ctx.strokeRect(x - boxWidth / 2, y - boxHeight / 2, boxWidth, boxHeight);
      ctx.restore();

      // Draw object marker (center dot)
      ctx.save();
      ctx.fillStyle = isCandidate ? mapMutedText : color;
      ctx.globalAlpha = focusAlpha;
      ctx.beginPath();
      ctx.arc(x, y, isSelected ? 5.5 : isHovered ? 4.8 : 3.8, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      // Draw status indicator (NEW/LOST)
      if (obj.status === 'NEW') {
        ctx.save();
        ctx.strokeStyle = '#22c55e';
        ctx.lineWidth = 1.8;
        ctx.globalAlpha = focusAlpha * 0.9;
        ctx.beginPath();
        ctx.arc(x, y, 13, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      } else if (obj.status === 'LOST') {
        ctx.save();
        ctx.strokeStyle = '#ef4444';
        ctx.lineWidth = 1.8;
        ctx.globalAlpha = focusAlpha * 0.6;
        ctx.beginPath();
        ctx.moveTo(x - 10, y - 10);
        ctx.lineTo(x + 10, y + 10);
        ctx.moveTo(x + 10, y - 10);
        ctx.lineTo(x - 10, y + 10);
        ctx.stroke();
        ctx.restore();
      } else if (isCandidate) {
        ctx.save();
        ctx.fillStyle = mapPrimaryText;
        ctx.globalAlpha = focusAlpha;
        ctx.font = `700 15px ${monoCanvasFont}`;
        ctx.fillText('?', x - 4, y - boxHeight / 2 - 6);
        ctx.restore();
      }

      const showDetailLabel = isFocused;
      const showIdLabel = showDetailLabel || mapZoom >= 9;
      if (!showIdLabel) {
        return;
      }

      const labelX = x + boxWidth / 2 + 7;
      const labelY = y - boxHeight / 2 - 5;
      ctx.save();
      const idFontSize = showDetailLabel ? 14 : 12;
      ctx.font = `700 ${idFontSize}px ${monoCanvasFont}`;
      ctx.textAlign = 'left';
      const idWidth = ctx.measureText(obj.id).width;
      const idBox = {
        x: labelX - 2,
        y: labelY - idFontSize,
        w: idWidth + 6,
        h: idFontSize + 4,
      };
      const overlap = !showDetailLabel &&
        placedIdLabels.some(
          (existing) =>
            idBox.x < existing.x + existing.w &&
            idBox.x + idBox.w > existing.x &&
            idBox.y < existing.y + existing.h &&
            idBox.y + idBox.h > existing.y
        );

      if (!overlap || isFocused) {
        placedIdLabels.push(idBox);
        if (showDetailLabel) {
          ctx.fillStyle = isDarkTheme ? 'rgba(2, 6, 12, 0.72)' : 'rgba(255, 255, 255, 0.76)';
          ctx.fillRect(labelX - 3, labelY - idFontSize - 1, idWidth + 7, idFontSize + 6);
        }
        ctx.fillStyle = isCandidate ? mapMutedText : mapPrimaryText;
        ctx.globalAlpha = focusAlpha;
        ctx.fillText(obj.id, labelX, labelY);
      }
      ctx.restore();

      if (!showDetailLabel || (overlap && !isFocused)) {
        return;
      }

      ctx.save();
      ctx.fillStyle = isCandidate ? mapMutedText : color;
      ctx.font = `700 13px ${koreanCanvasFont}`;
      ctx.globalAlpha = focusAlpha;
      ctx.fillText(
        `${CLASS_NAMES_KR[obj.class]} ${obj.confidence.toFixed(0)}%`,
        labelX,
        labelY + 16
      );
      if (isCandidate) {
        ctx.fillStyle = candidateInfoText;
        ctx.font = `600 11px ${koreanCanvasFont}`;
        ctx.fillText('(신호 손실 - 추적 유지)', labelX, labelY + 30);
      }
      ctx.restore();
    });

  }, [
    objects,
    selectedObjectId,
    hoveredObjectId,
    isDragging,
    fontsReady,
    mapCenter,
    mapViewCenter,
    mapZoom,
    detectionMode,
    computeMode,
    mapTheme,
    mapLabelLevel,
    showUtmGrid,
    showMgrsLabels,
    utmGridData.viewportSignature,
    tileVersion,
    officialDataLoaded,
    officialSourceLabel,
    officialBoundaryLines,
    officialSeaLines,
    officialAirspaceLines,
    officialProvinceLabels,
    officialDistrictLabels,
    officialEmdLabels,
  ]);

  const pickObjectFromCanvasPoint = (
    canvasX: number,
    canvasY: number,
    canvas: HTMLCanvasElement
  ): DetectedObject | null => {
    const width = canvas.width;
    const height = canvas.height;
    const centerX = width / 2;
    const centerY = height / 2;
    const scale = getRadarScaleFromLatitude(mapCenter.lat, mapZoom);
    const worldViewCenter = projectLatLonToWorld(mapViewCenter.lat, mapViewCenter.lon, mapZoom);
    const worldRadarCenter = projectLatLonToWorld(mapCenter.lat, mapCenter.lon, mapZoom);
    const radarCenterCanvas = {
      x: centerX + (worldRadarCenter.x - worldViewCenter.x),
      y: centerY + (worldRadarCenter.y - worldViewCenter.y),
    };
    const toCanvasPointFromGeo = (lat: number, lon: number) => {
      const worldPoint = projectLatLonToWorld(lat, lon, mapZoom);
      return {
        x: centerX + (worldPoint.x - worldViewCenter.x),
        y: centerY + (worldPoint.y - worldViewCenter.y),
      };
    };

    let picked: DetectedObject | null = null;
    let minDistance = Infinity;

    objects.forEach((obj) => {
      const canvasPoint = obj.geoPosition
        ? toCanvasPointFromGeo(obj.geoPosition.lat, obj.geoPosition.lon)
        : {
            x: radarCenterCanvas.x + obj.position.x * scale,
            y: radarCenterCanvas.y - obj.position.y * scale,
          };
      const x = canvasPoint.x;
      const y = canvasPoint.y;
      const distance = Math.hypot(canvasX - x, canvasY - y);
      const { boxWidth, boxHeight } = getTrackMarkerBoxSize(obj, scale);
      const inBox =
        canvasX >= x - boxWidth / 2 &&
        canvasX <= x + boxWidth / 2 &&
        canvasY >= y - boxHeight / 2 &&
        canvasY <= y + boxHeight / 2;

      if ((inBox || distance < 16) && distance < minDistance) {
        picked = obj;
        minDistance = distance;
      }
    });

    return picked;
  };

  const handleCanvasMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    dragRef.current.dragging = true;
    dragRef.current.moved = false;
    dragRef.current.lastX = e.clientX;
    dragRef.current.lastY = e.clientY;
    setHoveredObjectId(null);
    setIsDragging(true);
  };

  const handleCanvasMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (dragRef.current.dragging) {
      const deltaX = e.clientX - dragRef.current.lastX;
      const deltaY = e.clientY - dragRef.current.lastY;

      if (Math.abs(deltaX) < 0.5 && Math.abs(deltaY) < 0.5) return;
      if (Math.abs(deltaX) + Math.abs(deltaY) > 2) {
        dragRef.current.moved = true;
      }

      dragRef.current.lastX = e.clientX;
      dragRef.current.lastY = e.clientY;

      const world = projectLatLonToWorld(viewCenterRef.current.lat, viewCenterRef.current.lon, mapZoom);
      const nextWorld = {
        x: world.x - deltaX,
        y: world.y - deltaY,
      };
      const nextCenter = clampToKoreaBounds(unprojectWorldToLatLon(nextWorld.x, nextWorld.y, mapZoom));
      viewCenterRef.current = nextCenter;
      setMapViewCenter(nextCenter);
      return;
    }

    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const ratioX = canvas.width / rect.width;
    const ratioY = canvas.height / rect.height;
    const pointerX = (e.clientX - rect.left) * ratioX;
    const pointerY = (e.clientY - rect.top) * ratioY;
    const hoverTarget = pickObjectFromCanvasPoint(pointerX, pointerY, canvas);
    setHoveredObjectId((prev) => (prev === hoverTarget?.id ? prev : hoverTarget?.id ?? null));
  };

  const handleCanvasMouseUp = () => {
    const hadMoved = dragRef.current.moved;
    dragRef.current.dragging = false;
    setIsDragging(false);
    if (hadMoved) {
      window.setTimeout(() => {
        dragRef.current.moved = false;
      }, 0);
    }
  };

  const handleCanvasMouseLeave = () => {
    dragRef.current.moved = false;
    dragRef.current.dragging = false;
    setHoveredObjectId(null);
    setIsDragging(false);
  };

  const handleCanvasWheel = (e: React.WheelEvent<HTMLCanvasElement>) => {
    e.preventDefault();

    const canvas = canvasRef.current;
    if (!canvas) return;

    const zoomStep = e.deltaY < 0 ? 1 : -1;
    const rect = canvas.getBoundingClientRect();
    const ratioX = canvas.width / rect.width;
    const ratioY = canvas.height / rect.height;
    const pointerX = (e.clientX - rect.left) * ratioX;
    const pointerY = (e.clientY - rect.top) * ratioY;
    const offsetX = pointerX - canvas.width / 2;
    const offsetY = pointerY - canvas.height / 2;

    setMapZoom((previousZoom) => {
      const nextZoom = clamp(previousZoom + zoomStep, MIN_MAP_ZOOM, MAX_MAP_ZOOM);
      if (nextZoom === previousZoom) return previousZoom;

      const previousWorldCenter = projectLatLonToWorld(
        viewCenterRef.current.lat,
        viewCenterRef.current.lon,
        previousZoom
      );
      const focusWorldPrevious = {
        x: previousWorldCenter.x + offsetX,
        y: previousWorldCenter.y + offsetY,
      };
      const focusLatLon = unprojectWorldToLatLon(
        focusWorldPrevious.x,
        focusWorldPrevious.y,
        previousZoom
      );
      const focusWorldNext = projectLatLonToWorld(focusLatLon.lat, focusLatLon.lon, nextZoom);
      const nextCenterWorld = {
        x: focusWorldNext.x - offsetX,
        y: focusWorldNext.y - offsetY,
      };
      const nextCenter = clampToKoreaBounds(
        unprojectWorldToLatLon(nextCenterWorld.x, nextCenterWorld.y, nextZoom)
      );
      viewCenterRef.current = nextCenter;
      setMapViewCenter(nextCenter);

      return nextZoom;
    });
  };

  const handleCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (dragRef.current.moved) {
      dragRef.current.moved = false;
      return;
    }

    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const ratioX = canvas.width / rect.width;
    const ratioY = canvas.height / rect.height;
    const clickX = (e.clientX - rect.left) * ratioX;
    const clickY = (e.clientY - rect.top) * ratioY;

    const clickedObject = pickObjectFromCanvasPoint(clickX, clickY, canvas);

    if (clickedObject) {
      onSelectObject(clickedObject.id);
    } else {
      onSelectObject(null);
    }
  };

  const handleRecenterToSite = () => {
    viewCenterRef.current = mapCenter;
    setMapViewCenter(mapCenter);
  };
  const mapUiFontScale = layoutDevConfig.mapFontScale;
  const scaledMapPx = (base: number) => `${(base * mapUiFontScale).toFixed(1)}px`;
  const scaledMapRem = (base: number) => `${(base * mapUiFontScale).toFixed(3)}rem`;

  return (
    <div
      className="argus-map-panel argus-surface h-full w-full bg-[#0b1016] border-r border-cyan-950/50 flex flex-col relative"
      style={{ ['--argus-map-font-scale' as string]: String(layoutDevConfig.mapFontScale) }}
    >
      {/* Header */}
      <div
        className="argus-map-header px-6 border-b border-cyan-950/50"
        style={{
          paddingTop: `${layoutDevConfig.mapHeaderPaddingY}px`,
          paddingBottom: `${layoutDevConfig.mapHeaderPaddingY}px`,
        }}
      >
        <div>
          <h2
            className="argus-map-title text-2xl font-bold text-cyan-300 uppercase tracking-[0.08em]"
            style={{ fontSize: scaledMapRem(1.5) }}
          >
            국지 방공 레이더 데이터 시각화
          </h2>
          <p className="argus-map-subtitle text-sm text-slate-500 mt-1" style={{ fontSize: scaledMapPx(14) }}>
            전술 {mapTheme === 'DARK' ? '다크' : '화이트'} 맵 · 공식 경계/영공/영해 오버레이
            {showUtmGrid ? ` · UTM Grid Z${utmGridData.zone}N (EPSG:${utmGridData.epsg})` : ''}
            {showMgrsLabels ? ' · MGRS 100km/6자리 좌표' : ''}
          </p>
        </div>
        <div className="mt-2 flex items-start justify-between gap-2">
          <p className="argus-map-meta text-xs text-slate-400 break-all" style={{ fontSize: scaledMapPx(12) }}>
            진지(동심원) 좌표 {mapCenter.lat.toFixed(6)}, {mapCenter.lon.toFixed(6)}
            {' · '}지도 중심 {mapViewCenter.lat.toFixed(6)}, {mapViewCenter.lon.toFixed(6)} · 줌 {mapZoom}
            {' · '}
            드래그 이동 / 휠 확대·축소
          </p>
          <button
            type="button"
            onClick={handleRecenterToSite}
            className={`argus-map-recenter-button shrink-0 h-9 min-w-[74px] rounded border px-4 text-sm font-semibold whitespace-nowrap transition-colors ${
              mapTheme === 'LIGHT'
                ? 'border-slate-400 bg-white text-slate-800 hover:bg-slate-100'
                : 'border-cyan-700/70 bg-[#0b1822] text-cyan-200 hover:bg-[#132537]'
            }`}
            style={{ fontSize: scaledMapPx(14) }}
          >
            현 위치
          </button>
        </div>
        <p className={`argus-map-data-status map-data-status mt-1 text-[11px] ${officialDataLoaded ? 'is-loaded' : 'is-warning'}`} style={{ fontSize: scaledMapPx(11) }}>
          지도 데이터: {officialSourceLabel}
          {!officialDataLoaded && ' · 설정에서 지정한 경로에 공식 GeoJSON을 추가하면 자동 반영됩니다.'}
        </p>
        {officialDataLoaded && officialEmdLabels.length === 0 && (
          <p className="argus-map-data-status map-data-status is-warning mt-1 text-[11px]" style={{ fontSize: scaledMapPx(11) }}>
            읍·면·동 라벨용 공식 데이터(emd_labels.geojson)가 없어 현재 시/도 라벨만 표시됩니다.
          </p>
        )}
      </div>

      {/* Canvas */}
      <div ref={canvasContainerRef} className="flex-1 min-h-0 w-full">
        <canvas
          key={`radar-canvas-${computeMode}`}
          ref={canvasRef}
          width={canvasSize.width}
          height={canvasSize.height}
          onMouseDown={handleCanvasMouseDown}
          onMouseMove={handleCanvasMouseMove}
          onMouseUp={handleCanvasMouseUp}
          onMouseLeave={handleCanvasMouseLeave}
          onWheel={handleCanvasWheel}
          onClick={handleCanvasClick}
          className={`${
            isDragging ? 'cursor-grabbing' : hoveredObjectId ? 'cursor-pointer' : 'cursor-grab'
          } touch-none block w-full h-full`}
        />
      </div>

      {/* Legend */}
      <div
        className="argus-map-legend px-6 border-t border-cyan-950/50 bg-[#0d131b] text-sm"
        style={{
          paddingTop: `${layoutDevConfig.mapLegendPaddingY}px`,
          paddingBottom: `${layoutDevConfig.mapLegendPaddingY}px`,
        }}
      >
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <span className="text-cyan-300 text-xs font-semibold uppercase tracking-[0.1em] mr-1 whitespace-nowrap">
            표적 위험 분류
          </span>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 bg-[#38bdf8]" />
            <span className="text-slate-200 font-medium">안전(저위험)</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 bg-[#fbbf24]" />
            <span className="text-slate-200 font-medium">미확인</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 bg-[#fb923c]" />
            <span className="text-slate-200 font-medium">의심</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 bg-[#ef4444]" />
            <span className="text-slate-200 font-medium">위협</span>
          </div>
        </div>
        <div className="mt-2 flex items-center justify-between gap-3 text-xs">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-10 items-center px-0 border-0 bg-transparent shadow-none">
              <img
                src="/a-center.webp"
                alt="육군 인공지능센터 로고"
                className="h-7 w-auto object-contain bg-transparent"
                loading="lazy"
              />
            </div>
            <span className="text-slate-300 font-semibold tracking-[0.02em] truncate">
              육군 인공지능센터
            </span>
          </div>
          <span className="text-slate-300 font-mono whitespace-nowrap">{objects.length} 객체</span>
        </div>
      </div>
    </div>
  );
}
