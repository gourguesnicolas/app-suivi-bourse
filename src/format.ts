const LOCALE = 'fr-CA';

const numberFormats = new Map<string, Intl.NumberFormat>();
function numberFormat(options: Intl.NumberFormatOptions): Intl.NumberFormat {
  const key = JSON.stringify(options);
  let format = numberFormats.get(key);
  if (!format) {
    format = new Intl.NumberFormat(LOCALE, options);
    numberFormats.set(key, format);
  }
  return format;
}

const dateFormats = new Map<string, Intl.DateTimeFormat>();
function dateFormat(options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = JSON.stringify(options);
  let format = dateFormats.get(key);
  if (!format) {
    // Les heures de la série sont déjà à l'heure de la bourse : on les lit donc en « UTC » sans conversion.
    format = new Intl.DateTimeFormat(LOCALE, { ...options, timeZone: 'UTC' });
    dateFormats.set(key, format);
  }
  return format;
}

/** Nombre de décimales raisonnable selon l'ordre de grandeur du cours. */
export function decimalsFor(value: number): number {
  const abs = Math.abs(value);
  return abs >= 1 ? 2 : abs >= 0.01 ? 4 : 6;
}

export function fmtPrice(value: number | null | undefined, decimals?: number): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  const d = decimals ?? decimalsFor(value);
  return numberFormat({ minimumFractionDigits: d, maximumFractionDigits: d }).format(value);
}

/** Variation avec signe explicite (+1,23 ou -1,23). */
export function fmtChange(value: number | null | undefined, decimals?: number): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  const d = decimals ?? decimalsFor(value);
  return numberFormat({ minimumFractionDigits: d, maximumFractionDigits: d, signDisplay: 'exceptZero' }).format(value);
}

/** `value` est exprimé en pourcentage (1,5 pour 1,5 %). */
export function fmtPercent(value: number | null | undefined, signed = true): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  return numberFormat({
    style: 'percent',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
    signDisplay: signed ? 'exceptZero' : 'auto',
  }).format(value / 100);
}

export function fmtVolume(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  return numberFormat({ notation: 'compact', maximumFractionDigits: 1 }).format(value);
}

export type DateStyle = 'hour' | 'dayShort' | 'weekdayDay' | 'monthShort' | 'monthYear' | 'year' | 'full' | 'fullTime';

const DATE_OPTIONS: Record<DateStyle, Intl.DateTimeFormatOptions> = {
  hour: { hour: 'numeric' },
  dayShort: { day: 'numeric', month: 'short' },
  weekdayDay: { weekday: 'short', day: 'numeric' },
  monthShort: { month: 'short' },
  monthYear: { month: 'short', year: 'numeric' },
  year: { year: 'numeric' },
  full: { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' },
  fullTime: { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' },
};

/** `seconds` : secondes Unix où l'heure de la bourse est lue comme de l'UTC (voir periods.ts). */
export function fmtTime(seconds: number, style: DateStyle): string {
  return dateFormat(DATE_OPTIONS[style]).format(new Date(seconds * 1000));
}

export type Tone = 'up' | 'down' | 'flat';

export function toneOf(value: number | null | undefined): Tone {
  if (value === null || value === undefined || !Number.isFinite(value) || Math.abs(value) < 1e-9) return 'flat';
  return value > 0 ? 'up' : 'down';
}

const TYPE_LABELS: Record<string, string> = {
  'Common Stock': 'Action',
  ETF: 'FNB',
  'Exchange-Traded Fund': 'FNB',
  'Digital Currency': 'Crypto',
  'Physical Currency': 'Devise',
  Index: 'Indice',
  REIT: 'FPI',
};

export function typeLabel(type: string): string {
  return TYPE_LABELS[type] ?? type;
}
