import { Cache, Mutex } from './cache.ts';
import { settings } from './settings.ts';
import { ApiHttpError, asApiError } from './errors.ts';
import { CreditLimiter } from './limiter.ts';
import type {
  ApiErrorInfo,
  Dataset,
  Quote,
  QuotesResponse,
  SearchHit,
  SeriesPoint,
  SeriesResponse,
} from '../shared/types.ts';

// Les réponses de Twelve Data sont du JSON dont presque tous les nombres sont des chaînes.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Raw = Record<string, any>;

let limiter: CreditLimiter | undefined;
// Créé au premier appel : les réglages ne sont connus qu'une fois l'environnement lu.
const getLimiter = () => (limiter ??= new CreditLimiter(settings.creditsPerMinute, settings.creditsPerDay));
const cache = new Cache();
const quoteLock = new Mutex();

export const credits = () => getLimiter().snapshot();

const SPECS: Record<Dataset, { interval: string; size: number; ttlMs: number }> = {
  m5: { interval: '5min', size: 120, ttlMs: 5 * 60_000 },
  m30: { interval: '30min', size: 150, ttlMs: 15 * 60_000 },
  d1: { interval: '1day', size: 5000, ttlMs: 15 * 60_000 },
  mo1: { interval: '1month', size: 5000, ttlMs: 6 * 3_600_000 },
};

const num = (value: unknown): number | null => {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number.parseFloat(value) : Number.NaN;
  return Number.isFinite(n) ? n : null;
};

/** Traduit une erreur de Twelve Data en erreur compréhensible pour l'interface. */
function mapError(code: unknown, rawMessage: unknown): ApiHttpError {
  const status = typeof code === 'number' ? code : Number.parseInt(String(code ?? ''), 10) || 0;
  const message = String(rawMessage ?? '');
  const m = message.toLowerCase();

  if (status === 401 || m.includes('apikey')) {
    return new ApiHttpError(401, 'invalid_key', 'Clé API Twelve Data invalide ou absente. Vérifie TWELVE_DATA_API_KEY dans le fichier .env.');
  }
  if (status === 429) {
    return m.includes('day')
      ? new ApiHttpError(429, 'daily_limit', 'Limite quotidienne de Twelve Data atteinte. Elle se réinitialise à minuit UTC.')
      : new ApiHttpError(429, 'rate_limited', 'Limite par minute de Twelve Data atteinte. Réessaie dans quelques secondes.', 30);
  }
  if (status === 403 || m.includes('plan') || m.includes('subscription') || m.includes('upgrade') || m.includes('grow') || m.includes('pro ')) {
    return new ApiHttpError(403, 'plan_required', "Ce titre n'est pas inclus dans le plan gratuit de Twelve Data.");
  }
  if (status === 404 || m.includes('not found') || m.includes('invalid symbol')) {
    return new ApiHttpError(404, 'symbol_not_found', 'Symbole introuvable chez Twelve Data.');
  }
  if (status === 400) {
    return new ApiHttpError(400, 'bad_request', `Requête refusée par Twelve Data : ${message.slice(0, 160)}`);
  }
  return new ApiHttpError(502, 'upstream', `Erreur de Twelve Data${message ? ` : ${message.slice(0, 160)}` : '.'}`);
}

async function call(endpoint: string, params: Record<string, string>, cost: number): Promise<Raw> {
  await getLimiter().acquire(cost);

  const url = new URL(`${settings.baseUrl}/${endpoint}`);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  url.searchParams.set('apikey', settings.apiKey);

  let res: Response;
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(15_000), headers: { accept: 'application/json' } });
  } catch {
    // Le message d'origine pourrait contenir l'URL (donc la clé) : on ne le transmet pas.
    throw new ApiHttpError(502, 'network', 'Impossible de joindre Twelve Data (réseau ou délai dépassé).');
  }

  let body: Raw | null = null;
  try {
    body = (await res.json()) as Raw;
  } catch {
    body = null;
  }

  if (body && (body.status === 'error' || (typeof body.code === 'number' && body.code >= 400))) {
    throw mapError(body.code ?? res.status, body.message);
  }
  if (!res.ok || body === null) throw mapError(res.status, '');
  return body;
}

// ---------------------------------------------------------------------------
// Cotes
// ---------------------------------------------------------------------------

function parseQuote(raw: Raw): Quote | null {
  const price = num(raw.close);
  if (price === null) return null;
  const previousClose = num(raw.previous_close);
  const fifty = (raw.fifty_two_week ?? {}) as Raw;
  const change = num(raw.change) ?? (previousClose !== null ? price - previousClose : null);
  const changePercent =
    num(raw.percent_change) ?? (previousClose ? ((price - previousClose) / previousClose) * 100 : null);
  return {
    symbol: String(raw.symbol ?? '').toUpperCase(),
    name: String(raw.name ?? raw.symbol ?? ''),
    exchange: String(raw.exchange ?? ''),
    currency: String(raw.currency ?? 'USD'),
    price,
    open: num(raw.open),
    high: num(raw.high),
    low: num(raw.low),
    previousClose,
    change,
    changePercent,
    volume: num(raw.volume),
    fiftyTwoWeekLow: num(fifty.low),
    fiftyTwoWeekHigh: num(fifty.high),
    isMarketOpen: raw.is_market_open === true,
    asOf: String(raw.datetime ?? ''),
  };
}

const toInfo = (err: ApiHttpError): ApiErrorInfo => ({ code: err.code, message: err.message });

export function getQuotes(symbols: string[], force: boolean): Promise<QuotesResponse> {
  // Un seul appel à la fois : deux requêtes simultanées (rechargement de page, double
  // montage en développement) ne dépensent pas deux fois les mêmes crédits.
  return quoteLock.run(() => loadQuotes(symbols, force));
}

async function loadQuotes(symbols: string[], force: boolean): Promise<QuotesResponse> {
  const found = new Map<string, Quote>();
  const errors = new Map<string, ApiHttpError>();
  const missing: string[] = [];
  const now = Date.now();

  for (const symbol of symbols) {
    const hit = cache.peek<Quote>(`q:${symbol}`);
    const fresh = hit && (force ? now - hit.fetchedAt < 30_000 : now < hit.expiresAt);
    if (hit && fresh) found.set(symbol, hit.value);
    else missing.push(symbol);
  }

  for (let i = 0; i < missing.length; i += settings.creditsPerMinute) {
    const chunk = missing.slice(i, i + settings.creditsPerMinute);
    const fallback = (symbol: string, err: ApiHttpError) => {
      const old = cache.peek<Quote>(`q:${symbol}`);
      if (old) found.set(symbol, old.value);
      else errors.set(symbol, err);
    };

    try {
      const data = await call('quote', { symbol: chunk.join(',') }, chunk.length);
      for (const symbol of chunk) {
        // Avec un seul symbole la réponse est l'objet lui-même; avec plusieurs, elle est indexée par symbole.
        const entry = (chunk.length === 1 ? data : data[symbol]) as Raw | undefined;
        if (!entry) {
          fallback(symbol, new ApiHttpError(404, 'symbol_not_found', 'Symbole introuvable chez Twelve Data.'));
        } else if (entry.status === 'error' || typeof entry.code === 'number') {
          fallback(symbol, mapError(entry.code, entry.message));
        } else {
          const quote = parseQuote(entry);
          if (!quote) {
            fallback(symbol, new ApiHttpError(404, 'no_data', 'Aucune cotation disponible pour ce titre.'));
          } else {
            quote.symbol = symbol;
            cache.set(`q:${symbol}`, quote, quote.isMarketOpen ? settings.quoteTtlOpenMs : settings.quoteTtlClosedMs);
            found.set(symbol, quote);
          }
        }
      }
    } catch (err) {
      const apiError = asApiError(err);
      for (const symbol of chunk) fallback(symbol, apiError);
    }
  }

  if (found.size === 0 && errors.size > 0) {
    // Rien à afficher : on laisse remonter la première erreur avec son statut HTTP.
    throw [...errors.values()][0];
  }

  return {
    quotes: symbols.flatMap((s) => {
      const q = found.get(s);
      return q ? [q] : [];
    }),
    errors: Object.fromEntries([...errors].map(([symbol, err]) => [symbol, toInfo(err)])),
    fetchedAt: Date.now(),
  };
}

// ---------------------------------------------------------------------------
// Historique
// ---------------------------------------------------------------------------

function parseSeries(symbol: string, dataset: Dataset, data: Raw): Omit<SeriesResponse, 'fetchedAt' | 'stale'> {
  const values = Array.isArray(data.values) ? (data.values as Raw[]) : [];
  const points: SeriesPoint[] = [];
  for (const v of values) {
    const c = num(v.close);
    if (c !== null && typeof v.datetime === 'string') points.push({ t: v.datetime, c });
  }
  if (points.length === 0) {
    throw new ApiHttpError(404, 'no_data', 'Aucune donnée disponible pour ce titre sur cette période.');
  }
  points.sort((a, b) => (a.t < b.t ? -1 : a.t > b.t ? 1 : 0));
  const meta = (data.meta ?? {}) as Raw;
  return {
    symbol,
    dataset,
    currency: String(meta.currency ?? 'USD'),
    timezone: String(meta.exchange_timezone ?? 'America/New_York'),
    points,
  };
}

export async function getSeries(symbol: string, dataset: Dataset, force: boolean): Promise<SeriesResponse> {
  const spec = SPECS[dataset];
  // Bourse fermée : l'historique ne bouge plus, on le garde plus longtemps.
  const ttl = () => {
    const quote = cache.peek<Quote>(`q:${symbol}`)?.value;
    return quote && !quote.isMarketOpen ? 60 * 60_000 : spec.ttlMs;
  };
  const result = await cache.remember(
    `s:${dataset}:${symbol}`,
    ttl,
    async () => {
      const data = await call(
        'time_series',
        { symbol, interval: spec.interval, outputsize: String(spec.size) },
        1,
      );
      return parseSeries(symbol, dataset, data);
    },
    force,
  );
  return { ...result.value, fetchedAt: result.fetchedAt, stale: result.stale };
}

// ---------------------------------------------------------------------------
// Recherche
// ---------------------------------------------------------------------------

export async function searchSymbols(query: string): Promise<SearchHit[]> {
  const result = await cache.remember(`search:${query.toLowerCase()}`, 24 * 3_600_000, async () => {
    const data = await call('symbol_search', { symbol: query, outputsize: '25', show_plan: 'true' }, 1);
    const rows = Array.isArray(data.data) ? (data.data as Raw[]) : [];
    const seen = new Set<string>();
    const hits: SearchHit[] = [];

    for (const row of rows) {
      const symbol = String(row.symbol ?? '').toUpperCase();
      if (!symbol) continue;
      const exchange = String(row.exchange ?? '');
      const key = `${symbol}|${exchange}`;
      if (seen.has(key)) continue;
      seen.add(key);

      const type = String(row.instrument_type ?? '');
      const country = String(row.country ?? '');
      // `show_plan` ajoute le plan minimal requis; à défaut, on se rabat sur « titre américain, forex ou crypto ».
      const plan = (row.access as Raw | undefined)?.plan;
      const available =
        typeof plan === 'string' ? plan.toLowerCase() === 'basic' : country === 'United States' || /currency/i.test(type);

      hits.push({
        symbol,
        name: String(row.instrument_name ?? symbol),
        exchange,
        type,
        country,
        currency: String(row.currency ?? ''),
        available,
      });
    }

    // Les titres accessibles d'abord, pour ne pas enterrer un résultat utile.
    return [...hits.filter((h) => h.available), ...hits.filter((h) => !h.available)].slice(0, 10);
  });
  return result.value;
}
