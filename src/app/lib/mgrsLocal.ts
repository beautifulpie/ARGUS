const MGRS_LAT_BANDS = 'CDEFGHJKLMNPQRSTUVWX';
const MGRS_COLUMN_SETS = ['ABCDEFGH', 'JKLMNPQR', 'STUVWXYZ', 'ABCDEFGH', 'JKLMNPQR', 'STUVWXYZ'];
const MGRS_ROW_SETS = [
  'ABCDEFGHJKLMNPQRSTUV',
  'FGHJKLMNPQRSTUVABCDE',
  'ABCDEFGHJKLMNPQRSTUV',
  'FGHJKLMNPQRSTUVABCDE',
  'ABCDEFGHJKLMNPQRSTUV',
  'FGHJKLMNPQRSTUVABCDE',
];

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const toUtmZone = (lon: number) => {
  const normalized = ((lon + 180) % 360 + 360) % 360 - 180;
  return clamp(Math.floor((normalized + 180) / 6) + 1, 1, 60);
};

const toLatitudeBand = (lat: number) => {
  const clamped = clamp(lat, -80, 84);
  const index = clamp(Math.floor((clamped + 80) / 8), 0, MGRS_LAT_BANDS.length - 1);
  return MGRS_LAT_BANDS[index];
};

const get100kColumnLetter = (zone: number, easting: number) => {
  const setIndex = ((zone - 1) % 6 + 6) % 6;
  const columns = MGRS_COLUMN_SETS[setIndex];
  const raw = Math.floor(easting / 100000);
  const normalized = ((raw - 1) % columns.length + columns.length) % columns.length;
  return columns[normalized];
};

const get100kRowLetter = (zone: number, northing: number) => {
  const setIndex = ((zone - 1) % 6 + 6) % 6;
  const rows = MGRS_ROW_SETS[setIndex];
  const raw = Math.floor(northing / 100000);
  const normalized = ((raw % rows.length) + rows.length) % rows.length;
  return rows[normalized];
};

const zeroPad = (value: number, length: number) => {
  const normalized = Math.max(0, Math.floor(value));
  return String(normalized).padStart(length, '0');
};

export interface UtmProjectResult {
  easting: number;
  northing: number;
}

export type UtmProjector = (lat: number, lon: number, zone: number) => UtmProjectResult;

export const encodeMgrsFromUtm = (
  zone: number,
  lat: number,
  easting: number,
  northing: number,
  precision = 5
) => {
  const safeZone = clamp(Math.floor(zone), 1, 60);
  const band = toLatitudeBand(lat);
  const col = get100kColumnLetter(safeZone, easting);
  const row = get100kRowLetter(safeZone, northing);
  const clampedPrecision = clamp(Math.floor(precision), 0, 5);
  const eastingRemainder = Math.floor(easting % 100000);
  const northingRemainder = Math.floor(northing % 100000);
  const divisor = 10 ** (5 - clampedPrecision);
  const scaledEasting = clampedPrecision > 0 ? Math.floor(eastingRemainder / divisor) : 0;
  const scaledNorthing = clampedPrecision > 0 ? Math.floor(northingRemainder / divisor) : 0;
  const eastingDigits = clampedPrecision > 0 ? zeroPad(scaledEasting, clampedPrecision) : '';
  const northingDigits = clampedPrecision > 0 ? zeroPad(scaledNorthing, clampedPrecision) : '';

  return `${safeZone}${band}${col}${row}${eastingDigits}${northingDigits}`;
};

export const encodeMgrsFromLatLon = (
  lat: number,
  lon: number,
  projector: UtmProjector,
  zoneHint?: number,
  precision = 5
) => {
  const zone = zoneHint ? clamp(Math.floor(zoneHint), 1, 60) : toUtmZone(lon);
  const utm = projector(lat, lon, zone);
  return encodeMgrsFromUtm(zone, lat, utm.easting, utm.northing, precision);
};

export const extract100kIdFromMgrs = (mgrs: string) => {
  const match = mgrs.trim().toUpperCase().match(/^\d{1,2}[C-HJ-NP-X]([A-HJ-NP-Z]{2})/);
  return match?.[1] ?? '';
};

export const extractSixDigitFromMgrs = (mgrs: string) => {
  const match = mgrs
    .trim()
    .toUpperCase()
    .match(/^\d{1,2}[C-HJ-NP-X][A-HJ-NP-Z]{2}(\d{3})(\d{3})/);
  if (!match) return '';
  return `${match[1]} ${match[2]}`;
};
