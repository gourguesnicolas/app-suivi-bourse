import { useEffect, useMemo } from 'react';
import { BrandMark, MoonIcon, RefreshIcon, SunIcon } from './components/Icons';
import ChartPanel from './components/ChartPanel';
import Notice from './components/Notice';
import QuoteHeader from './components/QuoteHeader';
import StatsPanel from './components/StatsPanel';
import SymbolSearch from './components/SymbolSearch';
import Watchlist from './components/Watchlist';
import { fmtPrice } from './format';
import { MAX_WATCHLIST, usePersisted, useQuotes, useSeries, useStatus, useTheme, useWatchlist } from './hooks';
import { PERIOD_BY_ID, isPeriodId, sliceForPeriod } from './periods';
import type { PeriodId } from './periods';

const anyString = (value: string): value is string => value.length > 0;

export default function App() {
  const [theme, toggleTheme] = useTheme();
  const { symbols, add, remove } = useWatchlist();
  const [storedSymbol, setStoredSymbol] = usePersisted<string>('cotes.selected', symbols[0] ?? '', anyString);
  const [period, setPeriod] = usePersisted<PeriodId>('cotes.period', '1m', isPeriodId);

  // Si le titre mémorisé a été retiré de la liste, on retombe sur le premier.
  const selected = symbols.includes(storedSymbol) ? storedSymbol : (symbols[0] ?? null);

  const quotes = useQuotes(symbols);
  const quote = selected ? quotes.quotes[selected] : undefined;

  const dataset = PERIOD_BY_ID[period].dataset;
  const series = useSeries(selected, dataset);
  // Entre deux rendus, `series.data` peut encore porter sur l'ancien titre ou l'ancien jeu de données.
  const data = series.data && series.data.symbol === selected && series.data.dataset === dataset ? series.data : null;
  const previousClose = quote?.previousClose ?? null;
  const slice = useMemo(
    () => (data ? sliceForPeriod(data.points, period, previousClose) : null),
    [data, period, previousClose],
  );

  const status = useStatus(`${quotes.updatedAt}|${data?.fetchedAt}`);
  const isDemo = status?.mode === 'demo';

  useEffect(() => {
    document.title = selected && quote ? `${selected} ${fmtPrice(quote.price)} — Cotes` : 'Cotes — suivi boursier';
  }, [selected, quote]);

  const pick = (symbol: string) => {
    const result = add(symbol);
    if (result !== 'full') setStoredSymbol(symbol.toUpperCase());
    return result;
  };

  const quoteError = selected ? (quotes.errors[selected]?.message ?? null) : null;
  const chartLoading = selected !== null && !data && !series.error;
  const credits = status?.credits;
  const creditShare = credits ? Math.min(credits.usedToday / credits.dailyLimit, 1) : 0;

  return (
    <div className="app">
      <aside className="sidebar">
        <header className="brand">
          <BrandMark />
          <span className="brand-name">Cotes</span>
          <button
            type="button"
            className="icon-btn"
            onClick={toggleTheme}
            aria-label={theme === 'dark' ? 'Passer au thème clair' : 'Passer au thème sombre'}
            title={theme === 'dark' ? 'Thème clair' : 'Thème sombre'}
          >
            {theme === 'dark' ? <SunIcon /> : <MoonIcon />}
          </button>
        </header>

        <SymbolSearch onPick={pick} />

        <div className="list-head">
          <h2>
            Suivi <span className="count">{symbols.length}/{MAX_WATCHLIST}</span>
          </h2>
          <button
            type="button"
            className={`icon-btn${quotes.loading ? ' is-spinning' : ''}`}
            onClick={() => void quotes.refresh()}
            aria-label="Actualiser les cotes"
            title={quotes.updatedAt ? `Dernière mise à jour : ${new Date(quotes.updatedAt).toLocaleTimeString('fr-CA', { hour: 'numeric', minute: '2-digit' })}` : 'Actualiser'}
            disabled={symbols.length === 0}
          >
            <RefreshIcon />
          </button>
        </div>

        <Watchlist
          symbols={symbols}
          quotes={quotes.quotes}
          errors={quotes.errors}
          selected={selected}
          loading={quotes.loading}
          onSelect={setStoredSymbol}
          onRemove={remove}
        />

        <footer className="sidebar-foot">
          {isDemo ? null : credits ? (
            <>
              <div className="credits">
                <span>Crédits Twelve Data du jour</span>
                <span className="credits-count">
                  {credits.usedToday} / {credits.dailyLimit}
                </span>
              </div>
              <div
                className={`meter${creditShare > 0.85 ? ' is-high' : ''}`}
                role="progressbar"
                aria-label="Crédits Twelve Data utilisés aujourd’hui"
                aria-valuemin={0}
                aria-valuemax={credits.dailyLimit}
                aria-valuenow={credits.usedToday}
              >
                <span style={{ width: `${creditShare * 100}%` }} />
              </div>
              <p className="foot-note">Plan gratuit : cours différés possibles. Remise à zéro à minuit UTC.</p>
            </>
          ) : null}
        </footer>
      </aside>

      <main className="main">
        {isDemo && (
          <Notice tone="info">
            Mode démo : les cours affichés sont fictifs. Ajoute ta clé dans le fichier <code>.env</code> (voir <code>.env.example</code>) pour voir les vrais cours.
          </Notice>
        )}
        {quotes.error && (
          <Notice tone="error" action={{ label: 'Réessayer', onClick: () => void quotes.refresh() }}>
            {quotes.error.message}
          </Notice>
        )}

        {selected ? (
          <>
            <QuoteHeader symbol={selected} quote={quote} loading={quotes.loading} errorMessage={quoteError} />
            <ChartPanel
              symbol={selected}
              period={period}
              onPeriod={setPeriod}
              slice={slice}
              loading={chartLoading}
              error={series.error}
              onRetry={series.retry}
            />
            {quote && <StatsPanel quote={quote} />}
            {data?.stale && (
              <p className="stale-note">
                Twelve Data ne répond pas : ce graphique vient de la dernière copie enregistrée (
                {new Date(data.fetchedAt).toLocaleTimeString('fr-CA', { hour: 'numeric', minute: '2-digit' })}).
              </p>
            )}
          </>
        ) : (
          <div className="empty">
            <h1>Aucun titre suivi</h1>
            <p>Cherche un symbole dans la barre de gauche, par exemple AAPL pour Apple ou VOO pour un FNB qui suit le S&amp;P 500.</p>
          </div>
        )}
      </main>
    </div>
  );
}
