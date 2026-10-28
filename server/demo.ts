/**
 * Mode démo : fabrique des cours fictifs mais plausibles, sans réseau ni clé API.
 * Les données sont déterministes (même graine = même courbe) et se terminent à la
 * dernière séance de semaine. Elles ne reflètent PAS le marché réel.
 */
import { settings } from './settings.ts';
import { ApiHttpError } from './errors.ts';
import type { Dataset, Quote, QuotesResponse, SearchHit, SeriesPoint, SeriesResponse } from '../shared/types.ts';

interface Instrument {
  symbol: string;
  name: string;
  exchange: string;
  type: string;
  base: number;
  vol: number;
  volume: number;
}

const stock = (symbol: string, name: string, exchange: string, base: number, vol: number, volume: number): Instrument => ({
  symbol,
  name,
  exchange,
  type: 'Common Stock',
  base,
  vol,
  volume,
});
const etf = (symbol: string, name: string, exchange: string, base: number, vol: number, volume: number): Instrument => ({
  symbol,
  name,
  exchange,
  type: 'ETF',
  base,
  vol,
  volume,
});

const CATALOG: Instrument[] = [
  stock('AAPL', 'Apple Inc.', 'NASDAQ', 231.4, 0.0125, 52_000_000),
  stock('MSFT', 'Microsoft Corporation', 'NASDAQ', 428.7, 0.0115, 21_000_000),
  stock('NVDA', 'NVIDIA Corporation', 'NASDAQ', 141.2, 0.02, 190_000_000),
  stock('AMZN', 'Amazon.com, Inc.', 'NASDAQ', 197.6, 0.014, 38_000_000),
  stock('GOOGL', 'Alphabet Inc.', 'NASDAQ', 172.9, 0.0135, 24_000_000),
  stock('META', 'Meta Platforms, Inc.', 'NASDAQ', 585.3, 0.017, 12_000_000),
  stock('TSLA', 'Tesla, Inc.', 'NASDAQ', 251.8, 0.026, 85_000_000),
  stock('NFLX', 'Netflix, Inc.', 'NASDAQ', 742.1, 0.017, 3_400_000),
  stock('AMD', 'Advanced Micro Devices, Inc.', 'NASDAQ', 158.4, 0.021, 45_000_000),
  stock('JPM', 'JPMorgan Chase & Co.', 'NYSE', 214.5, 0.012, 9_000_000),
  stock('KO', 'The Coca-Cola Company', 'NYSE', 68.3, 0.0085, 14_000_000),
  stock('DIS', 'The Walt Disney Company', 'NYSE', 96.7, 0.015, 9_500_000),
  etf('VOO', 'Vanguard S&P 500 ETF', 'NYSE Arca', 524.6, 0.0092, 5_800_000),
  etf('SPY', 'SPDR S&P 500 ETF Trust', 'NYSE Arca', 572.4, 0.0092, 62_000_000),
  etf('QQQ', 'Invesco QQQ Trust', 'NASDAQ', 495.8, 0.0115, 38_000_000),
  etf('VTI', 'Vanguard Total Stock Market ETF', 'NYSE Arca', 282.1, 0.0095, 3_700_000),
  etf('IWM', 'iShares Russell 2000 ETF', 'NYSE Arca', 221.3, 0.0135, 27_000_000),
  etf('VEA', 'Vanguard FTSE Developed Markets ETF', 'NYSE Arca', 50.2, 0.0098, 11_000_000),
  etf('BND', 'Vanguard Total Bond Market ETF', 'NASDAQ', 72.4, 0.0032, 5_900_000),
];

/** Quelques titres canadiens pour montrer comment l'interface traite les titres hors plan gratuit. */
const PAID_ONLY: SearchHit[] = [
  { symbol: 'XEQT', name: 'iShares Core Equity ETF Portfolio', exchange: 'TSX', type: 'ETF', country: 'Canada', currency: 'CAD', available: false },
  { symbol: 'SHOP', name: 'Shopify Inc.', exchange: 'TSX', type: 'Common Stock', country: 'Canada', currency: 'CAD', available: false },
  { symbol: 'RY', name: 'Royal Bank of Canada', exchange: 'TSX', type: 'Common Stock', country: 'Canada', currency: 'CAD', available: false },
];

// ---------------------------------------------------------------------------
// Générateur pseudo-aléatoire déterministe
// ---------------------------------------------------------------------------

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function gaussian(rng: () => number): () => number {
  return () => {
    const u = Math.max(rng(), 1e-12);
    const v = rng();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const isoDate = (d: Date) => d.toISOString().slice(0, 10);

function lastWeekday(): Date {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  while (d.getUTCDay() === 0 || d.getUTCDay() === 6) d.setUTCDate(d.getUTCDate() - 1);
  return d;
}

// ---------------------------------------------------------------------------
// Séries
// ---------------------------------------------------------------------------

interface Daily {
  date: string;
  close: number;
}

interface Session {
  date: string;
  open: number;
  volume: number;
  bars: { t: string; c: number }[];
}

const N_DAILY = 6500; // environ 25 ans
const BARS_PER_SESSION = 78; // 9 h 30 à 16 h, par tranches de 5 minutes
const SESSIONS = 6;

const dailyCache = new Map<string, Daily[]>();
const sessionCache = new Map<string, Session[]>();

function getDaily(inst: Instrument): Daily[] {
  const end = lastWeekday();
  const key = `${inst.symbol}:${isoDate(end)}`;
  const cached = dailyCache.get(key);
  if (cached) return cached;

  const dates: string[] = [];
  const d = new Date(end);
  while (dates.length < N_DAILY) {
    if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6) dates.push(isoDate(d));
    d.setUTCDate(d.getUTCDate() - 1);
  }
  dates.reverse();

  const rng = mulberry32(hash(inst.symbol));
  const normal = gaussian(rng);
  const phase = rng() * Math.PI * 2;
  const mu = 0.0003;
  let price = 100;
  const raw: number[] = [];
  for (let i = 0; i < N_DAILY; i++) {
    const sigma = inst.vol * (0.75 + 0.55 * (0.5 + 0.5 * Math.sin(i / 170 + phase)));
    price *= Math.exp(mu - 0.5 * sigma * sigma + sigma * normal());
    raw.push(price);
  }
  const scale = inst.base / (raw[raw.length - 1] ?? 1);
  const series = dates.map((date, i) => ({ date, close: round2((raw[i] ?? 1) * scale) }));
  dailyCache.set(key, series);
  return series;
}

function getSessions(inst: Instrument): Session[] {
  const daily = getDaily(inst);
  const key = `${inst.symbol}:${daily[daily.length - 1]?.date}`;
  const cached = sessionCache.get(key);
  if (cached) return cached;

  const sessions: Session[] = [];
  for (let i = daily.length - SESSIONS; i < daily.length; i++) {
    const today = daily[i];
    const yesterday = daily[i - 1];
    if (!today || !yesterday) continue;

    const rng = mulberry32(hash(inst.symbol + today.date));
    const normal = gaussian(rng);
    const open = round2(yesterday.close * (1 + 0.002 * normal()));
    const walk = [0];
    for (let k = 1; k <= BARS_PER_SESSION; k++) walk.push((walk[k - 1] ?? 0) + normal());
    const end = walk[BARS_PER_SESSION] ?? 0;
    const step = (open * inst.vol * 0.9) / Math.sqrt(BARS_PER_SESSION);

    const bars: { t: string; c: number }[] = [];
    for (let j = 0; j < BARS_PER_SESSION; j++) {
      const k = j + 1;
      // Pont brownien : part de l'ouverture et se termine exactement à la clôture du jour.
      const value = open + (today.close - open) * (k / BARS_PER_SESSION) + step * ((walk[k] ?? 0) - (k / BARS_PER_SESSION) * end);
      const minutes = 9 * 60 + 30 + j * 5;
      const hh = String(Math.floor(minutes / 60)).padStart(2, '0');
      const mm = String(minutes % 60).padStart(2, '0');
      bars.push({ t: `${today.date} ${hh}:${mm}:00`, c: round2(value) });
    }
    sessions.push({ date: today.date, open, volume: Math.round(inst.volume * (0.7 + 0.6 * rng())), bars });
  }
  sessionCache.set(key, sessions);
  return sessions;
}

function monthly(daily: Daily[]): SeriesPoint[] {
  const out: SeriesPoint[] = [];
  for (const d of daily) {
    const last = out[out.length - 1];
    if (last && last.t.slice(0, 7) === d.date.slice(0, 7)) {
      last.t = d.date;
      last.c = d.close;
    } else {
      out.push({ t: d.date, c: d.close });
    }
  }
  return out;
}

function findInstrument(symbol: string): Instrument {
  const inst = CATALOG.find((i) => i.symbol === symbol.toUpperCase());
  if (!inst) {
    throw new ApiHttpError(
      404,
      'symbol_not_found',
      `« ${symbol} » n'existe pas en mode démo. Titres disponibles : ${CATALOG.map((i) => i.symbol).join(', ')}.`,
    );
  }
  return inst;
}

// ---------------------------------------------------------------------------
// Points d'entrée (même signature que twelvedata.ts)
// ---------------------------------------------------------------------------

export const credits = () => ({ usedToday: 0, dailyLimit: settings.creditsPerDay, perMinute: settings.creditsPerMinute });

function quoteFor(inst: Instrument): Quote {
  const daily = getDaily(inst);
  const sessions = getSessions(inst);
  const session = sessions[sessions.length - 1];
  const lastBar = session?.bars[session.bars.length - 1];
  if (!session || !lastBar) throw new ApiHttpError(500, 'internal', 'Données de démonstration indisponibles.');

  const price = lastBar.c;
  const previousClose = daily[daily.length - 2]?.close ?? price;
  const closes = session.bars.map((b) => b.c);
  const year = daily.slice(-252).map((d) => d.close);
  return {
    symbol: inst.symbol,
    name: inst.name,
    exchange: inst.exchange,
    currency: 'USD',
    price,
    open: session.open,
    high: round2(Math.max(session.open, ...closes)),
    low: round2(Math.min(session.open, ...closes)),
    previousClose,
    change: round2(price - previousClose),
    changePercent: Math.round(((price - previousClose) / previousClose) * 10_000) / 100,
    volume: session.volume,
    fiftyTwoWeekLow: Math.min(...year),
    fiftyTwoWeekHigh: Math.max(...year),
    isMarketOpen: false,
    asOf: session.date,
  };
}

export async function getQuotes(symbols: string[], _force: boolean): Promise<QuotesResponse> {
  const quotes: Quote[] = [];
  const errors: QuotesResponse['errors'] = {};
  for (const symbol of symbols) {
    try {
      quotes.push(quoteFor(findInstrument(symbol)));
    } catch (err) {
      const e = err as ApiHttpError;
      errors[symbol] = { code: e.code, message: e.message };
    }
  }
  if (quotes.length === 0 && symbols.length > 0) {
    const first = errors[symbols[0] ?? ''];
    throw new ApiHttpError(404, first?.code ?? 'symbol_not_found', first?.message ?? 'Symbole introuvable.');
  }
  return { quotes, errors, fetchedAt: Date.now() };
}

export async function getSeries(symbol: string, dataset: Dataset, _force: boolean): Promise<SeriesResponse> {
  const inst = findInstrument(symbol);
  const daily = getDaily(inst);
  const sessions = getSessions(inst);

  let points: SeriesPoint[];
  if (dataset === 'm5') {
    points = sessions.slice(-2).flatMap((s) => s.bars.map((b) => ({ t: b.t, c: b.c })));
  } else if (dataset === 'm30') {
    points = sessions.flatMap((s) => {
      const out: SeriesPoint[] = [];
      for (let i = 0; i < s.bars.length; i += 6) {
        const first = s.bars[i];
        const last = s.bars[Math.min(i + 5, s.bars.length - 1)];
        if (first && last) out.push({ t: first.t, c: last.c });
      }
      return out;
    });
  } else if (dataset === 'd1' || dataset === 'd1a') {
    points = daily.slice(-2800).map((d) => ({ t: d.date, c: d.close }));
  } else {
    points = monthly(daily);
  }
  if (dataset === 'd1a' || dataset === 'mo1a') {
    // Rendement total fictif : environ 1,5 % de dividendes par an, réinvestis.
    const last = points[points.length - 1];
    const end = last ? Date.parse(last.t.slice(0, 10)) : 0;
    points = points.map((p) => ({ t: p.t, c: p.c * 1.015 ** ((Date.parse(p.t.slice(0, 10)) - end) / (365.25 * 86_400_000)) }));
  }

  return {
    symbol: inst.symbol,
    dataset,
    currency: 'USD',
    timezone: 'America/New_York',
    points,
    fetchedAt: Date.now(),
    stale: false,
  };
}

export async function searchSymbols(query: string): Promise<SearchHit[]> {
  const q = query.trim().toLowerCase();
  const matches = (symbol: string, name: string) => symbol.toLowerCase().startsWith(q) || name.toLowerCase().includes(q);
  const available: SearchHit[] = CATALOG.filter((i) => matches(i.symbol, i.name)).map((i) => ({
    symbol: i.symbol,
    name: i.name,
    exchange: i.exchange,
    type: i.type,
    country: 'United States',
    currency: 'USD',
    available: true,
  }));
  const paid = PAID_ONLY.filter((h) => matches(h.symbol, h.name));
  return [...available, ...paid].slice(0, 10);
}
