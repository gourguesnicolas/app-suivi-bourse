import type { Dataset, SeriesPoint } from '../shared/types';

export type PeriodId = '1d' | '5d' | '1m' | '3m' | '6m' | 'ytd' | '1y' | '3y' | '5y' | '7y' | '10y' | 'max';

export interface PeriodDef {
  id: PeriodId;
  /** Texte du bouton. */
  label: string;
  /** Nom complet (info-bulle et lecteurs d'écran). */
  title: string;
  /** Fin de phrase pour la performance : « +4,2 % sur 3 mois ». */
  summary: string;
  dataset: Dataset;
  /** Fenêtre en mois pour les périodes calculées sur l'historique quotidien. */
  months?: number;
}

const nb = ' '; // espace insécable : « 1 j » ne se coupe jamais en deux lignes

export const PERIODS: readonly PeriodDef[] = [
  { id: '1d', label: `1${nb}j`, title: '1 jour (dernière séance)', summary: 'depuis la clôture précédente', dataset: 'm5' },
  { id: '5d', label: `5${nb}j`, title: '5 jours', summary: 'sur 5 jours', dataset: 'm30' },
  { id: '1m', label: `1${nb}m`, title: '1 mois', summary: 'sur 1 mois', dataset: 'd1', months: 1 },
  { id: '3m', label: `3${nb}m`, title: '3 mois', summary: 'sur 3 mois', dataset: 'd1', months: 3 },
  { id: '6m', label: `6${nb}m`, title: '6 mois', summary: 'sur 6 mois', dataset: 'd1', months: 6 },
  { id: 'ytd', label: 'CA', title: 'Cumul annuel (depuis le 1er janvier)', summary: 'depuis le 1er janvier', dataset: 'd1' },
  { id: '1y', label: `1${nb}a`, title: '1 an', summary: 'sur 1 an', dataset: 'd1', months: 12 },
  { id: '3y', label: `3${nb}a`, title: '3 ans', summary: 'sur 3 ans', dataset: 'd1', months: 36 },
  { id: '5y', label: `5${nb}a`, title: '5 ans', summary: 'sur 5 ans', dataset: 'd1', months: 60 },
  { id: '7y', label: `7${nb}a`, title: '7 ans', summary: 'sur 7 ans', dataset: 'd1', months: 84 },
  { id: '10y', label: `10${nb}a`, title: '10 ans', summary: 'sur 10 ans', dataset: 'd1', months: 120 },
  { id: 'max', label: 'Max', title: 'Historique complet', summary: "depuis le début de l'historique", dataset: 'mo1' },
];

export const PERIOD_BY_ID = Object.fromEntries(PERIODS.map((p) => [p.id, p])) as Record<PeriodId, PeriodDef>;

export const isPeriodId = (value: string): value is PeriodId => value in PERIOD_BY_ID;

export type SliceKind = 'intraday' | 'daily' | 'monthly';

export interface ChartPoint {
  /** Secondes Unix. L'heure de la bourse est lue comme de l'UTC pour éviter toute conversion de fuseau. */
  time: number;
  value: number;
}

export interface PeriodSlice {
  points: ChartPoint[];
  /** Valeur de référence de la performance (clôture précédente, début de période, etc.). */
  baseline: number | null;
  kind: SliceKind;
}

export function pointTime(t: string): number {
  const iso = t.length > 10 ? `${t.replace(' ', 'T')}Z` : `${t}T00:00:00Z`;
  return Date.parse(iso) / 1000;
}

/** Soustrait des mois à une date « AAAA-MM-JJ » en ramenant le jour au dernier du mois au besoin (31 mars − 1 mois = 28 février). */
export function subtractMonths(date: string, months: number): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const total = y * 12 + (m - 1) - months;
  const year = Math.floor(total / 12);
  const month = total - year * 12;
  const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(Math.min(d, daysInMonth)).padStart(2, '0')}`;
}

const toChart = (p: SeriesPoint): ChartPoint => ({ time: pointTime(p.t), value: p.c });

/**
 * Découpe un jeu de données dans la fenêtre d'une période et détermine la valeur de référence.
 * La fenêtre se calcule à partir de la dernière donnée reçue, pas de l'horloge : le résultat
 * reste juste le week-end, les jours fériés et pour les titres qui ne cotent plus.
 */
export function sliceForPeriod(points: SeriesPoint[], period: PeriodId, previousClose: number | null): PeriodSlice {
  const def = PERIOD_BY_ID[period];
  const last = points[points.length - 1];
  if (!last) return { points: [], baseline: null, kind: 'daily' };
  const lastDate = last.t.slice(0, 10);

  if (period === '1d') {
    const day = points.filter((p) => p.t.startsWith(lastDate));
    return { points: day.map(toChart), baseline: previousClose ?? day[0]?.c ?? null, kind: 'intraday' };
  }

  if (period === '5d') {
    const days = [...new Set(points.map((p) => p.t.slice(0, 10)))].slice(-5);
    const keep = new Set(days);
    const week = points.filter((p) => keep.has(p.t.slice(0, 10)));
    return { points: week.map(toChart), baseline: week[0]?.c ?? null, kind: 'intraday' };
  }

  if (period === 'max') {
    return { points: points.map(toChart), baseline: points[0]?.c ?? null, kind: 'monthly' };
  }

  const from = period === 'ytd' ? `${lastDate.slice(0, 4)}-01-01` : subtractMonths(lastDate, def.months ?? 1);
  const start = points.findIndex((p) => p.t.slice(0, 10) >= from);
  const first = start === -1 ? points.length - 1 : start;
  // La dernière clôture avant la fenêtre sert de référence (ex. la clôture du 31 décembre pour « CA »).
  const before = first > 0 ? points[first - 1] : undefined;
  const windowPoints = points.slice(first);
  const baseline = before?.c ?? windowPoints[0]?.c ?? null;
  return {
    points: (before ? [before, ...windowPoints] : windowPoints).map(toChart),
    baseline,
    kind: 'daily',
  };
}

export interface Performance {
  change: number;
  percent: number;
}

export function performance(value: number, baseline: number | null): Performance | null {
  if (baseline === null || baseline === 0) return null;
  return { change: value - baseline, percent: ((value - baseline) / baseline) * 100 };
}
