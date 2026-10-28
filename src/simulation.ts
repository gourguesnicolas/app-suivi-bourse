/**
 * Moteur de la simulation boursière : à partir des historiques de cours, calcule la valeur
 * de chaque portefeuille jour après jour (ou mois après mois), frais de gestion déduits.
 * Aucune dépendance à React : tout se teste et se raisonne à part.
 */
import type { Dataset, SeriesResponse } from '../shared/types';

const DAY_MS = 86_400_000;
const YEAR_DAYS = 365.25;

/** Au-delà, l'historique quotidien (5 000 barres) ne suffit plus pour toutes les catégories de titres. */
export const DAILY_MAX_YEARS = 13;

export type AmountMode = 'amount' | 'shares';

/** Un placement tel que saisi dans le formulaire (les nombres restent du texte pour la saisie). */
export interface HoldingDraft {
  id: string;
  symbol: string;
  name: string;
  mode: AmountMode;
  /** Montant investi ou nombre de parts (fractions permises). */
  value: string;
  /** Frais de gestion annuels, en pourcentage (0,03 pour 0,03 %). */
  fee: string;
}

export interface ScenarioDraft {
  name: string;
  holdings: HoldingDraft[];
}

export interface HoldingResult {
  id: string;
  symbol: string;
  currency: string;
  shares: number;
  startPrice: number;
  endPrice: number;
  initial: number;
  final: number;
  /** Rendement total, frais déduits, en pourcentage. */
  returnPct: number;
  feePct: number;
  /** Valeur perdue à cause des frais (valeur finale sans frais − avec frais). */
  feesCost: number;
}

export interface ScenarioResult {
  name: string;
  /** Valeur du portefeuille, frais déduits, à chaque date de `SimResult.days`. */
  values: number[];
  initial: number;
  final: number;
  gain: number;
  returnPct: number;
  /** Rendement annualisé composé; null si la période fait moins d'un an. */
  annualPct: number | null;
  feesCost: number;
  /** Frais moyens pondérés par le montant investi au départ. */
  weightedFeePct: number;
  /** Plus forte baisse entre un sommet et un creux, en pourcentage (négatif). */
  maxDrawdownPct: number;
  currency: string;
  mixedCurrencies: boolean;
  holdings: HoldingResult[];
}

export interface SimResult {
  /** Jours UTC depuis 1970 (un par date de cotation). */
  days: number[];
  startDay: number;
  endDay: number;
  years: number;
  /** Titres dont l'historique commence après la date choisie : la simulation part plus tard. */
  lateStarts: { symbol: string; firstDay: number }[];
  scenarios: (ScenarioResult | null)[];
}

interface PricePoint {
  day: number;
  c: number;
}

export const toDay = (date: string) => Math.floor(Date.parse(`${date.slice(0, 10)}T00:00:00Z`) / DAY_MS);
export const fromDay = (day: number) => new Date(day * DAY_MS).toISOString().slice(0, 10);
export const todayDay = () => toDay(new Date().toISOString());

/** Lit un nombre saisi en français (virgule ou point décimal, espaces ignorées). */
export function parseNumber(text: string): number | null {
  const cleaned = text.replace(/[\s  $%]/g, '').replace(',', '.');
  if (cleaned === '') return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

/** Jeu de données à demander au serveur selon la date de début et le choix des dividendes. */
export function datasetFor(start: string, dividends: boolean): Dataset {
  const monthly = todayDay() - toDay(start) > DAILY_MAX_YEARS * YEAR_DAYS;
  if (monthly) return dividends ? 'mo1a' : 'mo1';
  return dividends ? 'd1a' : 'd1';
}

export const isMonthly = (dataset: Dataset) => dataset === 'mo1' || dataset === 'mo1a';

/**
 * Convertit une série en points datés. Une barre mensuelle est datée du 1er du mois, mais sa
 * clôture est celle de la fin du mois : on la date donc du dernier jour du mois (ou d'aujourd'hui).
 */
function pricePoints(series: SeriesResponse, today: number): PricePoint[] {
  const monthly = isMonthly(series.dataset);
  return series.points.map((p) => {
    if (!monthly) return { day: toDay(p.t), c: p.c };
    const [y, m] = p.t.split('-').map(Number) as [number, number];
    const monthEnd = Math.floor(Date.UTC(y, m, 0) / DAY_MS);
    return { day: Math.min(monthEnd, today), c: p.c };
  });
}

/** Parcourt une série en avançant dans le temps et renvoie le dernier cours connu à chaque date. */
class Cursor {
  private i = 0;
  constructor(private readonly points: PricePoint[]) {}
  at(day: number): number | null {
    while (this.i + 1 < this.points.length && (this.points[this.i + 1]?.day ?? Infinity) <= day) this.i++;
    const p = this.points[this.i];
    return p && p.day <= day ? p.c : null;
  }
}

export interface ValidHolding {
  id: string;
  symbol: string;
  mode: AmountMode;
  value: number;
  feePct: number;
}

/** Les placements complets d'un scénario (symbole, quantité positive, frais entre 0 et 100 %). */
export function validHoldings(scenario: ScenarioDraft): ValidHolding[] {
  return scenario.holdings.flatMap((h) => {
    const value = parseNumber(h.value);
    const fee = parseNumber(h.fee) ?? 0;
    if (!h.symbol || value === null || value <= 0 || fee < 0 || fee >= 100) return [];
    return [{ id: h.id, symbol: h.symbol, mode: h.mode, value, feePct: fee }];
  });
}

export type SimOutcome = { ok: true; result: SimResult } | { ok: false; message: string };

/**
 * Simule les scénarios sur la même période. La date de départ réelle est la plus tardive entre la
 * date choisie et le premier cours de chaque titre, pour que les deux scénarios restent comparables.
 */
export function simulate(scenarios: ScenarioDraft[], series: Record<string, SeriesResponse>, start: string, end: string): SimOutcome {
  const today = todayDay();
  const inputs = scenarios.map(validHoldings);
  const symbols = [...new Set(inputs.flat().map((h) => h.symbol))];
  if (symbols.length === 0) return { ok: false, message: 'Ajoute au moins un titre avec un montant pour lancer la simulation.' };

  const points = new Map<string, PricePoint[]>();
  for (const symbol of symbols) {
    const s = series[symbol];
    if (!s || s.points.length === 0) return { ok: false, message: `Historique de ${symbol} indisponible.` };
    points.set(symbol, pricePoints(s, today));
  }

  const wantedStart = toDay(start);
  let startDay = wantedStart;
  let lastData = -Infinity;
  const lateStarts: SimResult['lateStarts'] = [];
  for (const [symbol, pts] of points) {
    const first = pts[0]?.day ?? Infinity;
    if (first > wantedStart) lateStarts.push({ symbol, firstDay: first });
    startDay = Math.max(startDay, first);
    lastData = Math.max(lastData, pts[pts.length - 1]?.day ?? -Infinity);
  }
  const endDay = Math.min(toDay(end), lastData);
  if (endDay <= startDay) {
    return { ok: false, message: 'La période choisie ne contient pas assez de cours. Choisis une date de fin plus tardive.' };
  }

  // Calendrier commun : toutes les dates de cotation de la période, plus la date de départ.
  const daySet = new Set<number>([startDay, endDay]);
  for (const pts of points.values()) {
    for (const p of pts) if (p.day > startDay && p.day < endDay) daySet.add(p.day);
  }
  const days = [...daySet].sort((a, b) => a - b);
  const years = (endDay - startDay) / YEAR_DAYS;

  // Cours de chaque titre à chaque date, calculé une fois pour tous les scénarios.
  const prices = new Map<string, number[]>();
  for (const [symbol, pts] of points) {
    const cursor = new Cursor(pts);
    let previous = pts[0]?.c ?? 0;
    prices.set(
      symbol,
      days.map((day) => {
        previous = cursor.at(day) ?? previous;
        return previous;
      }),
    );
  }

  const results = inputs.map((holdings, index): ScenarioResult | null => {
    if (holdings.length === 0) return null;
    const values = new Array<number>(days.length).fill(0);
    const holdingResults: HoldingResult[] = [];
    const currencies = new Set<string>();

    for (const h of holdings) {
      const row = prices.get(h.symbol) ?? [];
      const startPrice = row[0] ?? 0;
      const endPrice = row[row.length - 1] ?? 0;
      if (startPrice <= 0) continue;
      const shares = h.mode === 'amount' ? h.value / startPrice : h.value;
      const fee = h.feePct / 100;
      // Les frais courent chaque jour : la valeur est multipliée par (1 − frais) par année écoulée.
      for (let i = 0; i < days.length; i++) {
        const elapsed = ((days[i] ?? startDay) - startDay) / YEAR_DAYS;
        values[i] = (values[i] ?? 0) + shares * (row[i] ?? 0) * (1 - fee) ** elapsed;
      }
      const initial = shares * startPrice;
      const gross = shares * endPrice;
      const final = gross * (1 - fee) ** years;
      const currency = series[h.symbol]?.currency || 'USD';
      currencies.add(currency);
      holdingResults.push({
        id: h.id,
        symbol: h.symbol,
        currency,
        shares,
        startPrice,
        endPrice,
        initial,
        final,
        returnPct: (final / initial - 1) * 100,
        feePct: h.feePct,
        feesCost: gross - final,
      });
    }
    if (holdingResults.length === 0) return null;

    const initial = holdingResults.reduce((sum, h) => sum + h.initial, 0);
    const final = holdingResults.reduce((sum, h) => sum + h.final, 0);
    let peak = -Infinity;
    let maxDrawdown = 0;
    for (const v of values) {
      peak = Math.max(peak, v);
      if (peak > 0) maxDrawdown = Math.min(maxDrawdown, v / peak - 1);
    }

    return {
      name: scenarios[index]?.name.trim() || `Scénario ${String.fromCharCode(65 + index)}`,
      values,
      initial,
      final,
      gain: final - initial,
      returnPct: (final / initial - 1) * 100,
      annualPct: years >= 1 ? ((final / initial) ** (1 / years) - 1) * 100 : null,
      feesCost: holdingResults.reduce((sum, h) => sum + h.feesCost, 0),
      weightedFeePct: holdingResults.reduce((sum, h) => sum + h.feePct * h.initial, 0) / initial,
      maxDrawdownPct: maxDrawdown * 100,
      currency: [...currencies][0] ?? 'USD',
      mixedCurrencies: currencies.size > 1,
      holdings: holdingResults,
    };
  });

  return { ok: true, result: { days, startDay, endDay, years, lateStarts, scenarios: results } };
}
