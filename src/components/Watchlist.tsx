import type { ApiErrorInfo, Quote } from '../../shared/types';
import { fmtPercent, fmtPrice, toneOf } from '../format';
import { Arrow, CloseIcon } from './Icons';
import RangeBar from './RangeBar';

interface Props {
  symbols: string[];
  quotes: Record<string, Quote>;
  errors: Record<string, ApiErrorInfo>;
  selected: string | null;
  loading: boolean;
  onSelect: (symbol: string) => void;
  onRemove: (symbol: string) => void;
}

export default function Watchlist({ symbols, quotes, errors, selected, loading, onSelect, onRemove }: Props) {
  if (symbols.length === 0) {
    return <p className="watchlist-empty">Ta liste est vide. Cherche un symbole pour commencer.</p>;
  }

  return (
    <ul className="watchlist" aria-label="Titres suivis">
      {symbols.map((symbol) => {
        const quote = quotes[symbol];
        const error = errors[symbol];
        const tone = toneOf(quote?.change);
        const isSelected = symbol === selected;
        return (
          <li key={symbol} className={`row${isSelected ? ' is-selected' : ''}`}>
            <button type="button" className="row-main" onClick={() => onSelect(symbol)} aria-current={isSelected ? 'true' : undefined}>
              <span className="row-id">
                <span className="row-symbol">{symbol}</span>
                <span className="row-name">{quote?.name ?? (error ? error.message : loading ? 'Chargement…' : '—')}</span>
              </span>
              {quote ? (
                <span className="row-quote">
                  <span className="row-price">{fmtPrice(quote.price)}</span>
                  <span className={`row-delta tone-${tone}`}>
                    <Arrow tone={tone} />
                    {fmtPercent(quote.changePercent, false)}
                    <span className="sr-only">{tone === 'up' ? ', en hausse' : tone === 'down' ? ', en baisse' : ', inchangé'}</span>
                  </span>
                </span>
              ) : (
                <span className="row-quote">
                  <span className={`row-price${loading ? ' is-loading' : ''}`}>—</span>
                </span>
              )}
              {quote && <RangeBar compact low={quote.low} high={quote.high} value={quote.price} label={`Fourchette du jour de ${symbol}`} />}
            </button>
            <button type="button" className="row-remove" onClick={() => onRemove(symbol)} aria-label={`Retirer ${symbol} de la liste`} title="Retirer de la liste">
              <CloseIcon />
            </button>
          </li>
        );
      })}
    </ul>
  );
}
