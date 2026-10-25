import type {
  ApiErrorBody,
  Dataset,
  QuotesResponse,
  SearchResponse,
  SeriesResponse,
  StatusResponse,
} from '../shared/types';

/** Adresse de l'API : vide en local (même serveur), l'adresse du Worker une fois sur GitHub Pages. */
const API_BASE = __API_BASE__;

export class ApiClientError extends Error {
  status: number;
  code: string;
  retryAfter: number | undefined;

  constructor(status: number, code: string, message: string, retryAfter?: number) {
    super(message);
    this.name = 'ApiClientError';
    this.status = status;
    this.code = code;
    this.retryAfter = retryAfter;
  }
}

async function get<T>(path: string, params: Record<string, string>, signal?: AbortSignal): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}?${new URLSearchParams(params)}`, { signal });
  } catch (err) {
    if (signal?.aborted) throw err;
    throw new ApiClientError(
      0,
      'network',
      API_BASE
        ? 'Le Worker de l’API ne répond pas. Vérifie qu’il est déployé et que API_BASE pointe vers lui.'
        : 'Le serveur local ne répond pas. Vérifie qu’il est démarré (npm run dev).',
    );
  }
  const body = (await res.json().catch(() => null)) as (T & Partial<ApiErrorBody>) | null;
  if (!res.ok) {
    throw new ApiClientError(res.status, body?.code ?? 'http', body?.error ?? `Erreur ${res.status}`, body?.retryAfter);
  }
  if (body === null) throw new ApiClientError(res.status, 'http', 'Réponse illisible du serveur.');
  return body;
}

export const api = {
  status: (signal?: AbortSignal) => get<StatusResponse>('/api/status', {}, signal),
  search: (q: string, signal?: AbortSignal) => get<SearchResponse>('/api/search', { q }, signal),
  quotes: (symbols: string[], force = false, signal?: AbortSignal) =>
    get<QuotesResponse>('/api/quotes', { symbols: symbols.join(','), ...(force ? { force: '1' } : {}) }, signal),
  series: (symbol: string, dataset: Dataset, force = false, signal?: AbortSignal) =>
    get<SeriesResponse>('/api/series', { symbol, dataset, ...(force ? { force: '1' } : {}) }, signal),
};
