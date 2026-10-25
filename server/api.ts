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

async function route(url: URL): Promise<unknown> {
  const params = url.searchParams;
  const p = provider();
  switch (url.pathname) {
    case '/api/status': {
      const status: StatusResponse = { mode: settings.demo ? 'demo' : 'live', credits: p.credits() };
      return status;
    }
    case '/api/search': {
      const q = (params.get('q') ?? '').trim();
      if (q.length < 1 || q.length > 40) throw new ApiHttpError(400, 'bad_request', 'Recherche invalide.');
      return { hits: await p.searchSymbols(q) };
    }
    case '/api/quotes':
      return p.getQuotes(parseSymbols(params.get('symbols')), params.get('force') === '1');
    case '/api/series': {
      const dataset = params.get('dataset') ?? '';
      if (!DATASETS.includes(dataset)) throw new ApiHttpError(400, 'bad_request', 'Jeu de données invalide.');
      return p.getSeries(parseSymbol(params.get('symbol')), dataset as Dataset, params.get('force') === '1');
    }
    default:
      throw new ApiHttpError(404, 'not_found', 'Route inconnue.');
  }
}

export async function handleApi(url: URL): Promise<ApiResult> {
  try {
    return { status: 200, body: await route(url), headers: {} };
  } catch (err) {
    const apiError = asApiError(err);
    if (apiError.code === 'internal') console.error(err);
    const body: ApiErrorBody = { error: apiError.message, code: apiError.code };
    const headers: Record<string, string> = {};
    if (apiError.retryAfter !== undefined) {
      body.retryAfter = apiError.retryAfter;
      headers['retry-after'] = String(apiError.retryAfter);
    }
    return { status: apiError.status, body, headers };
  }
}
