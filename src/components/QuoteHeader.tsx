import type { Quote } from '../../shared/types';
import { fmtChange, fmtPercent, fmtPrice, fmtTime, toneOf } from '../format';
import { pointTime } from '../periods';
import { Arrow } from './Icons';

interface Props {
  symbol: string;
  quote: Quote | undefined;
  loading: boolean;
  errorMessage: string | null;
}

function asOfLabel(asOf: string): string {
  if (!asOf) return '';
  const time = pointTime(asOf.length > 10 ? asOf : asOf.slice(0, 10));
  return Number.isFinite(time) ? fmtTime(time, asOf.length > 10 ? 'fullTime' : 'full') : '';
}

export default function QuoteHeader({ symbol, quote, loading, errorMessage }: Props) {
  if (!quote) {
    return (
      <header className="quote">
        <div className="quote-id">
          <h1 className="quote-name">{symbol}</h1>
          <p className="quote-meta">{errorMessage ?? (loading ? 'Chargement de la cote…' : 'Cote indisponible')}</p>
        </div>
        <div className="quote-price">
          <span className={`price${loading ? ' is-loading' : ''}`}>—</span>
        </div>
      </header>
    );
  }

  const tone = toneOf(quote.change);
  const when = asOfLabel(quote.asOf);

  return (
    <header className="quote">
      <div className="quote-id">
        <h1 className="quote-name">{quote.name}</h1>
        <p className="quote-meta">
          <span className="ticker">{quote.symbol}</span>
          <span>{quote.exchange}</span>
          <span>{quote.currency}</span>
          <span className={`market ${quote.isMarketOpen ? 'is-open' : 'is-closed'}`}>
            <span className="market-dot" aria-hidden="true" />
            {quote.isMarketOpen ? 'Marché ouvert' : 'Marché fermé'}
          </span>
        </p>
      </div>
      <div className="quote-price">
        <span className="price">{fmtPrice(quote.price)}</span>
        <span className={`delta tone-${tone}`}>
          <Arrow tone={tone} />
          <span>
            {fmtChange(quote.change)} ({fmtPercent(quote.changePercent)})
          </span>
          <span className="delta-when">{quote.isMarketOpen ? 'aujourd’hui' : 'dernière séance'}</span>
        </span>
        {when && <span className="as-of">Cote du {when}</span>}
      </div>
    </header>
  );
}
