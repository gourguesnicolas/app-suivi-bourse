/**
 * Routes de l'API, indépendantes de la plateforme : le serveur Node (server/index.ts)
 * et le Worker Cloudflare (worker/index.ts) les appellent avec une URL et reçoivent
 * un statut, un corps JSON et des en-têtes.
 */
import * as demo from './demo.ts';
import { ApiHttpError, asApiError } from './errors.ts';
import { settings } from './settings.ts';
import * as live from './twelvedata.ts';
import type { ApiErrorBody, Dataset, StatusResponse } from '../shared/types.ts';

export interface ApiResult {
  status: number;
  body: unknown;
  headers: Record<string, string>;
  /**
   * Durée (en secondes) pendant laquelle la réponse peut être resservie telle quelle.
   * Le Worker s'en sert pour le cache de Cloudflare, partagé entre toutes ses instances.
   */
  cacheSeconds: number;
}

const DATASETS: readonly string[] = ['m5', 'm30', 'd1', 'mo1'] satisfies Dataset[];
const SYMBOL_RE = /^[A-Z0-9][A-Z0-9.\-/:^_]{0,19}$/;
const MAX_SYMBOLS = 20;

const provider = () => (settings.demo ? demo : live);

function parseSymbol(raw: string | null): string {
  const symbol = (raw ?? '').trim().toUpperCase();
  if (!SYMBOL_RE.test(symbol)) throw new ApiHttpError(400, 'bad_request', 'Symbole invalide.');
  return symbol;
}

function parseSymbols(raw: string | null): string[] {
  const list = [...new Set((raw ?? '').split(',').map((s) => s.trim().toUpperCase()).filter(Boolean))];
  if (list.length === 0 || list.length > MAX_SYMBOLS || !list.every((s) => SYMBOL_RE.test(s))) {
    throw new ApiHttpError(400, 'bad_request', `Liste de symboles invalide (1 à ${MAX_SYMBOLS} symboles).`);
  }
  return list;
}

/** Durée de cache de l'historique, par jeu de données (même rythme que le cache du serveur). */
const SERIES_CACHE_SECONDS: Record<Dataset, number> = { m5: 300, m30: 900, d1: 900, mo1: 6 * 3600 };
/** Copie de secours, erreur partielle ou rafraîchissement forcé : on ne la garde pas longtemps. */
const SHORT_CACHE_SECONDS = 30;

async function route(url: URL): Promise<{ body: unknown; cacheSeconds: number }> {
  const params = url.searchParams;
  const p = provider();
  const force = params.get('force') === '1';
  switch (url.pathname) {
    case '/api/status': {
      const status: StatusResponse = { mode: settings.demo ? 'demo' : 'live', credits: p.credits() };
      return { body: status, cacheSeconds: 0 };
    }
    case '/api/search': {
      const q = (params.get('q') ?? '').trim();
      if (q.length < 1 || q.length > 40) throw new ApiHttpError(400, 'bad_request', 'Recherche invalide.');
      return { body: { hits: await p.searchSymbols(q) }, cacheSeconds: 24 * 3600 };
    }
    case '/api/quotes': {
      const res = await p.getQuotes(parseSymbols(params.get('symbols')), force);
      const open = res.quotes.some((q) => q.isMarketOpen);
      const ttl = open ? settings.quoteTtlOpenMs : settings.quoteTtlClosedMs;
      const partial = Object.keys(res.errors).length > 0;
      return { body: res, cacheSeconds: force || partial ? SHORT_CACHE_SECONDS : Math.round(ttl / 1000) };
    }
    case '/api/series': {
      const dataset = params.get('dataset') ?? '';
      if (!DATASETS.includes(dataset)) throw new ApiHttpError(400, 'bad_request', 'Jeu de données invalide.');
      const res = await p.getSeries(parseSymbol(params.get('symbol')), dataset as Dataset, force);
      const ttl = force || res.stale ? SHORT_CACHE_SECONDS : SERIES_CACHE_SECONDS[dataset as Dataset];
      return { body: res, cacheSeconds: ttl };
    }
    default:
      throw new ApiHttpError(404, 'not_found', 'Route inconnue.');
  }
}

export async function handleApi(url: URL): Promise<ApiResult> {
  try {
    const { body, cacheSeconds } = await route(url);
    return { status: 200, body, headers: {}, cacheSeconds };
  } catch (err) {
    const apiError = asApiError(err);
    if (apiError.code === 'internal') console.error(err);
    const body: ApiErrorBody = { error: apiError.message, code: apiError.code };
    const headers: Record<string, string> = {};
    if (apiError.retryAfter !== undefined) {
      body.retryAfter = apiError.retryAfter;
      headers['retry-after'] = String(apiError.retryAfter);
    }
    return { status: apiError.status, body, headers, cacheSeconds: 0 };
  }
}
