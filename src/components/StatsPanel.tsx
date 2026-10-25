import type { Quote } from '../../shared/types';
import { fmtPrice, fmtVolume } from '../format';
import RangeBar from './RangeBar';

export default function StatsPanel({ quote }: { quote: Quote }) {
  const stats: { label: string; value: string }[] = [
    { label: 'Ouverture', value: fmtPrice(quote.open) },
    { label: 'Clôture précédente', value: fmtPrice(quote.previousClose) },
    { label: 'Volume', value: fmtVolume(quote.volume) },
    { label: 'Bourse', value: quote.exchange || '—' },
  ];

  return (
    <section className="stats" aria-label="Statistiques de la séance">
      <dl className="stat-list">
        {stats.map((stat) => (
          <div className="stat" key={stat.label}>
            <dt>{stat.label}</dt>
            <dd>{stat.value}</dd>
          </div>
        ))}
      </dl>

      <div className="ranges">
        <div className="range-row">
          <span className="range-label">Fourchette du jour</span>
          <RangeBar low={quote.low} high={quote.high} value={quote.price} label="Fourchette du jour" />
          <span className="range-ends">
            <span>{fmtPrice(quote.low)}</span>
            <span>{fmtPrice(quote.high)}</span>
          </span>
        </div>
        <div className="range-row">
          <span className="range-label">Fourchette sur 52 semaines</span>
          <RangeBar low={quote.fiftyTwoWeekLow} high={quote.fiftyTwoWeekHigh} value={quote.price} label="Fourchette sur 52 semaines" />
          <span className="range-ends">
            <span>{fmtPrice(quote.fiftyTwoWeekLow)}</span>
            <span>{fmtPrice(quote.fiftyTwoWeekHigh)}</span>
          </span>
        </div>
      </div>
    </section>
  );
}
