import { useCallback, useEffect, useRef, useState } from 'react';
import type { ApiErrorInfo, Dataset, Quote, SeriesResponse, StatusResponse } from '../shared/types';
import { ApiClientError, api } from './api';

// ---------------------------------------------------------------------------
// Thème
// ---------------------------------------------------------------------------

export type Theme = 'light' | 'dark';
const THEME_KEY = 'cotes.theme';

export function useTheme(): [Theme, () => void] {
  const [theme, setTheme] = useState<Theme>(() => (document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light'));

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  const toggle = useCallback(() => {
    setTheme((current) => {
      const next: Theme = current === 'dark' ? 'light' : 'dark';
      try {
        localStorage.setItem(THEME_KEY, next);
      } catch {
        /* stockage indisponible : le choix vaut pour cette session seulement */
      }
      return next;
    });
  }, []);

  return [theme, toggle];
}

// ---------------------------------------------------------------------------
// Préférences mémorisées dans le navigateur
// ---------------------------------------------------------------------------

export function usePersisted<T extends string>(
  key: string,
  initial: T,
  isValid: (value: string) => value is T,
): [T, (value: T) => void] {
  const [value, setValue] = useState<T>(() => {
    try {
      const stored = localStorage.getItem(key);
      if (stored !== null && isValid(stored)) return stored;
    } catch {
      /* ignoré */
    }
    return initial;
  });

  const update = useCallback(
    (next: T) => {
      setValue(next);
      try {
        localStorage.setItem(key, next);
      } catch {
        /* ignoré */
      }
    },
    [key],
  );

  return [value, update];
}

export const MAX_WATCHLIST = 10;
const WATCHLIST_KEY = 'cotes.watchlist.v1';
const DEFAULT_WATCHLIST = ['AAPL', 'MSFT', 'NVDA', 'VOO', 'QQQ', 'SPY'];

function readWatchlist(): string[] {
  try {
    const raw = localStorage.getItem(WATCHLIST_KEY);
    if (raw !== null) {
      const parsed: unknown = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return [...new Set(parsed.filter((s): s is string => typeof s === 'string'))].slice(0, MAX_WATCHLIST);
      }
    }
  } catch {
    /* liste illisible : on repart de la liste par défaut */
  }
  return DEFAULT_WATCHLIST;
}

export type AddResult = 'added' | 'exists' | 'full';

export function useWatchlist() {
  const [symbols, setSymbols] = useState<string[]>(readWatchlist);

  useEffect(() => {
    try {
      localStorage.setItem(WATCHLIST_KEY, JSON.stringify(symbols));
    } catch {
      /* ignoré */
    }
  }, [symbols]);

  const add = (symbol: string): AddResult => {
    const upper = symbol.toUpperCase();
    if (symbols.includes(upper)) return 'exists';
    if (symbols.length >= MAX_WATCHLIST) return 'full';
    setSymbols([...symbols, upper]);
    return 'added';
  };
  const remove = (symbol: string) => setSymbols((list) => list.filter((s) => s !== symbol));

  return { symbols, add, remove };
}

// ---------------------------------------------------------------------------
// Données
// ---------------------------------------------------------------------------

interface QuotesState {
  quotes: Record<string, Quote>;
  errors: Record<string, ApiErrorInfo>;
  error: ApiClientError | null;
  loading: boolean;
  updatedAt: number | null;
}

/** Charge les cotes de la liste de suivi et les rafraîchit chaque minute (le serveur gère le cache et les crédits). */
export function useQuotes(symbols: string[]) {
  const key = symbols.join(',');
  const [state, setState] = useState<QuotesState>({
    quotes: {},
    errors: {},
    error: null,
    loading: symbols.length > 0,
    updatedAt: null,
  });
  const latest = useRef(0);

  const load = useCallback(
    async (force: boolean) => {
      if (!key) return;
      const id = ++latest.current;
      setState((s) => ({ ...s, loading: true }));
      try {
        const res = await api.quotes(key.split(','), force);
        if (id !== latest.current) return; // une requête plus récente a pris le relais
        const quotes: Record<string, Quote> = {};
        for (const q of res.quotes) quotes[q.symbol] = q;
        setState((s) => ({
          quotes: { ...s.quotes, ...quotes },
          errors: res.errors,
          error: null,
          loading: false,
          updatedAt: res.fetchedAt,
        }));
      } catch (err) {
        if (id !== latest.current) return;
        setState((s) => ({ ...s, loading: false, error: err as ApiClientError }));
      }
    },
    [key],
  );

  useEffect(() => {
    if (!key) {
      setState((s) => ({ ...s, loading: false, error: null }));
      return;
    }
    void load(false);
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') void load(false);
    }, 60_000);
    const onVisible = () => {
      if (document.visibilityState === 'visible') void load(false);
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [key, load]);

  const refresh = useCallback(() => load(true), [load]);
  return { ...state, refresh };
}

interface SeriesState {
  data: SeriesResponse | null;
  loading: boolean;
  error: ApiClientError | null;
}

const seriesCache = new Map<string, { data: SeriesResponse; at: number }>();
const SERIES_FRESH_MS = 60_000;

/** Charge un jeu de données historique. Passer d'une période à l'autre dans le même jeu est instantané. */
export function useSeries(symbol: string | null, dataset: Dataset) {
  const [state, setState] = useState<SeriesState>({ data: null, loading: false, error: null });
  const [attempt, setAttempt] = useState(0);
  const autoRetries = useRef(0);

  useEffect(() => {
    autoRetries.current = 0;
  }, [symbol, dataset]);

  useEffect(() => {
    if (!symbol) {
      setState({ data: null, loading: false, error: null });
      return;
    }
    const key = `${symbol}:${dataset}`;
    const cached = seriesCache.get(key);
    setState(cached ? { data: cached.data, loading: false, error: null } : { data: null, loading: true, error: null });
    if (cached && Date.now() - cached.at < SERIES_FRESH_MS) return;

    const controller = new AbortController();
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    api
      .series(symbol, dataset, false, controller.signal)
      .then((data) => {
        autoRetries.current = 0;
        seriesCache.set(key, { data, at: Date.now() });
        setState({ data, loading: false, error: null });
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        // Si on a déjà une copie à afficher, on la garde plutôt que de montrer une erreur.
        setState((s) => ({ data: s.data, loading: false, error: s.data ? null : (err as ApiClientError) }));
        // Limite par minute : on réessaie seul dès que le serveur l'estime possible.
        const apiError = err as ApiClientError;
        if (apiError.code === 'rate_limited' && autoRetries.current < 3) {
          autoRetries.current += 1;
          retryTimer = setTimeout(() => setAttempt((n) => n + 1), Math.max(apiError.retryAfter ?? 15, 5) * 1000);
        }
      });
    return () => {
      controller.abort();
      clearTimeout(retryTimer);
    };
  }, [symbol, dataset, attempt]);

  const retry = useCallback(() => {
    if (symbol) seriesCache.delete(`${symbol}:${dataset}`);
    setAttempt((n) => n + 1);
  }, [symbol, dataset]);

  return { ...state, retry };
}

export function useStatus(refreshToken: unknown) {
  const [status, setStatus] = useState<StatusResponse | null>(null);

  useEffect(() => {
    let alive = true;
    const run = () => {
      api
        .status()
        .then((s) => {
          if (alive) setStatus(s);
        })
        .catch(() => undefined);
    };
    run();
    const timer = setInterval(run, 20_000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [refreshToken]);

  return status;
}
