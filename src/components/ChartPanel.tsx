import { useEffect, useMemo, useState } from 'react';
import { fmtChange, fmtPercent, fmtPrice, fmtTime, toneOf } from '../format';
import { PERIOD_BY_ID, performance } from '../periods';
import type { PeriodId, PeriodSlice } from '../periods';
import type { ApiClientError } from '../api';
import { Arrow } from './Icons';
import PeriodSelector from './PeriodSelector';
import PriceChart, { hoverLabel } from './PriceChart';

interface Props {
  symbol: string;
  period: PeriodId;
  onPeriod: (period: PeriodId) => void;
  slice: PeriodSlice | null;
  loading: boolean;
  error: ApiClientError | null;
  onRetry: () => void;
}

export default function ChartPanel({ symbol, period, onPeriod, slice, loading, error, onRetry }: Props) {
  const [hover, setHover] = useState<number | null>(null);
  const def = PERIOD_BY_ID[period];

  // Un autre titre ou une autre période : l'ancien repère n'a plus de sens.
  useEffect(() => setHover(null), [symbol, period]);

  const points = slice?.points ?? [];
  const baseline = slice?.baseline ?? null;
  const last = points[points.length - 1];
  const shown = (hover !== null ? points[hover] : undefined) ?? last;
  const perf = shown ? performance(shown.value, baseline) : null;
  const tone = toneOf(perf?.change);

  const chartLabel = useMemo(() => {
    if (!last || !points[0]) return `Graphique de ${symbol}`;
    const first = points[0];
    return `Graphique du cours de ${symbol} sur ${def.title.toLowerCase()}, de ${fmtPrice(first.value)} à ${fmtPrice(last.value)}`;
  }, [symbol, def.title, points, last]);

  return (
    <section className="chart-panel" aria-label={`Cours de ${symbol}`}>
      <PeriodSelector value={period} onChange={onPeriod} />

      <div className={`readout tone-${tone}`} aria-live="off">
        {shown && slice ? (
          <>
            <span className="readout-date">{hover !== null ? hoverLabel(shown.time, slice.kind) : `Dernière cote · ${hoverLabel(shown.time, slice.kind)}`}</span>
            <span className="readout-value">{fmtPrice(shown.value)}</span>
            {perf ? (
              <span className="readout-delta">
                <Arrow tone={tone} />
                <span>
                  {fmtChange(perf.change)} ({fmtPercent(perf.percent)})
                </span>
                <span className="readout-when">{hover !== null ? 'depuis le début de la période' : def.summary}</span>
              </span>
            ) : null}
          </>
        ) : (
          <span className="readout-date">&nbsp;</span>
        )}
      </div>

      <div className="chart-box" aria-busy={loading}>
        {slice && points.length > 0 && !error && (
          <PriceChart
            points={points}
            baseline={baseline}
            kind={slice.kind}
            tone={tone}
            label={chartLabel}
            hoverIndex={hover}
            onHover={setHover}
            revealKey={`${symbol}-${period}`}
          />
        )}
        {loading && !slice && (
          <div className="chart-state" role="status">
            <span className="skeleton-line" />
            <span>Chargement du graphique…</span>
          </div>
        )}
        {error && !slice && (
          <div className="chart-state" role="alert">
            <p>{error.message}</p>
            {error.code !== 'plan_required' && error.code !== 'symbol_not_found' && (
              <button type="button" className="btn" onClick={onRetry}>
                Réessayer
              </button>
            )}
          </div>
        )}
        {!loading && !error && slice && points.length === 0 && (
          <div className="chart-state">
            <p>Aucune donnée pour cette période.</p>
          </div>
        )}
      </div>
      <p className="chart-foot">
        {slice && points[0] && last
          ? `${fmtTime(points[0].time, slice.kind === 'intraday' ? 'fullTime' : 'full')} → ${fmtTime(last.time, slice.kind === 'intraday' ? 'fullTime' : 'full')}${slice.kind === 'intraday' ? ' · heure de la bourse' : ''}`
          : ''}
      </p>
    </section>
  );
}
