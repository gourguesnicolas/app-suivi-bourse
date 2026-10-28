import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { fmtMoney, fmtPercent, fmtPrice, fmtShares, fmtTime, toneOf } from '../format';
import type { SliceKind } from '../periods';
import type { ScenarioResult, SimResult } from '../simulation';
import { Arrow } from './Icons';
import SimChart from './SimChart';
import type { SimLine } from './SimChart';

interface Props {
  result: SimResult;
  kind: SliceKind;
}

type ChartMode = 'value' | 'percent';

const SLOTS = ['a', 'b'] as const;
const dayLabel = (day: number) => fmtTime(day * 86_400, 'full');

function Signed({ value, children }: { value: number | null; children: string }) {
  const tone = toneOf(value);
  return (
    <span className={`signed tone-${tone}`}>
      <Arrow tone={tone} />
      {children}
    </span>
  );
}

export default function SimResults({ result, kind }: Props) {
  const [mode, setMode] = useState<ChartMode>('value');
  const [hover, setHover] = useState<number | null>(null);

  const present = useMemo(
    () =>
      SLOTS.flatMap((slot, i) => {
        const scenario = result.scenarios[i];
        return scenario ? [{ slot, scenario }] : [];
      }),
    [result],
  );
  const currency = present[0]?.scenario.currency ?? 'USD';
  const sameCurrency = present.every((p) => p.scenario.currency === currency && !p.scenario.mixedCurrencies);

  // Deux devises différentes ne s'additionnent pas sur un même axe : on passe alors en pourcentage.
  const effectiveMode: ChartMode = sameCurrency ? mode : 'percent';
  const lines = useMemo<SimLine[]>(
    () =>
      present.map(({ slot, scenario }) => ({
        key: slot,
        values: effectiveMode === 'value' ? scenario.values : scenario.values.map((v) => (v / scenario.initial - 1) * 100),
      })),
    [present, effectiveMode],
  );
  const formatAxis = useCallback(
    (v: number) => (effectiveMode === 'value' ? fmtMoney(v, currency, true) : fmtPercent(Math.round(v))),
    [effectiveMode, currency],
  );

  useEffect(() => setHover(null), [result]);

  const index = hover ?? result.days.length - 1;
  const day = result.days[index] ?? result.endDay;
  const span = `${dayLabel(result.startDay)} → ${dayLabel(result.endDay)}`;
  const yearsText = `${new Intl.NumberFormat('fr-CA', { maximumFractionDigits: 1 }).format(result.years)} an${result.years >= 2 ? 's' : ''}`;

  const rows: { label: string; hint?: string; render: (s: ScenarioResult) => ReactNode }[] = [
    { label: 'Investi au départ', render: (s) => fmtMoney(s.initial, s.currency) },
    { label: 'Valeur finale', render: (s) => <strong>{fmtMoney(s.final, s.currency)}</strong> },
    { label: 'Gain', render: (s) => <Signed value={s.gain}>{fmtMoney(s.gain, s.currency)}</Signed> },
    { label: 'Rendement total', render: (s) => <Signed value={s.returnPct}>{fmtPercent(s.returnPct)}</Signed> },
    {
      label: 'Rendement annualisé',
      hint: 'Taux de croissance annuel composé, frais déduits.',
      render: (s) => (s.annualPct === null ? '—' : <Signed value={s.annualPct}>{fmtPercent(s.annualPct)}</Signed>),
    },
    {
      label: 'Frais moyens',
      hint: 'Frais de gestion annuels, pondérés par le montant investi.',
      render: (s) => fmtPercent(s.weightedFeePct, false),
    },
    {
      label: 'Coût des frais',
      hint: 'Ce que le portefeuille vaudrait de plus à la fin sans frais de gestion.',
      render: (s) => fmtMoney(s.feesCost, s.currency),
    },
    {
      label: 'Pire baisse',
      hint: 'Plus forte chute entre un sommet et le creux qui a suivi.',
      render: (s) => <Signed value={s.maxDrawdownPct}>{fmtPercent(s.maxDrawdownPct)}</Signed>,
    },
  ];

  return (
    <section className="sim-results" aria-label="Résultats de la simulation">
      <div className="sim-results-head">
        <div>
          <h2>Résultats</h2>
          <p className="sim-span">
            {span} · {yearsText}
          </p>
        </div>
        <div className="seg" role="group" aria-label="Afficher le graphique">
          <button
            type="button"
            className="seg-btn"
            aria-pressed={effectiveMode === 'value'}
            disabled={!sameCurrency}
            onClick={() => setMode('value')}
          >
            Valeur
          </button>
          <button type="button" className="seg-btn" aria-pressed={effectiveMode === 'percent'} onClick={() => setMode('percent')}>
            Rendement
          </button>
        </div>
      </div>

      <div className="sim-readout" aria-live="off">
        <span className="readout-date">{hover !== null ? dayLabel(day) : `Fin de la période · ${dayLabel(day)}`}</span>
        {present.map(({ slot, scenario }) => {
          const value = scenario.values[index] ?? scenario.final;
          const pct = (value / scenario.initial - 1) * 100;
          return (
            <span key={slot} className="sim-readout-item">
              <span className={`swatch swatch-${slot}`} aria-hidden="true" />
              <span className="sim-readout-name">{scenario.name}</span>
              <span className="sim-readout-value">{fmtMoney(value, scenario.currency)}</span>
              <Signed value={pct}>{fmtPercent(pct)}</Signed>
            </span>
          );
        })}
      </div>

      <div className="chart-box">
        <SimChart
          days={result.days}
          lines={lines}
          kind={kind}
          baseline={effectiveMode === 'percent' ? 0 : present.length === 1 ? (present[0]?.scenario.initial ?? null) : null}
          formatAxis={formatAxis}
          label={`Évolution ${present.length > 1 ? 'des deux portefeuilles' : 'du portefeuille'} du ${span}`}
          hoverIndex={hover}
          onHover={setHover}
          revealKey={`${result.startDay}-${result.endDay}-${effectiveMode}-${present.length}`}
        />
      </div>
      {!sameCurrency && (
        <p className="chart-foot">
          Les titres ne sont pas tous dans la même devise : le graphique montre le rendement en pourcentage, sans conversion de change.
        </p>
      )}

      <div className="table-wrap">
        <table className="sim-table">
          <thead>
            <tr>
              <th scope="col">
                <span className="sr-only">Mesure</span>
              </th>
              {present.map(({ slot, scenario }) => (
                <th key={slot} scope="col">
                  <span className={`swatch swatch-${slot}`} aria-hidden="true" />
                  {scenario.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.label}>
                <th scope="row" title={row.hint}>
                  {row.label}
                </th>
                {present.map(({ slot, scenario }) => (
                  <td key={slot}>{row.render(scenario)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="sim-details">
        {present.map(({ slot, scenario }) => (
          <section key={slot} className="sim-detail" aria-label={`Détail de ${scenario.name}`}>
            <h3>
              <span className={`swatch swatch-${slot}`} aria-hidden="true" />
              {scenario.name}
              {scenario.mixedCurrencies && <span className="hit-badge">Devises mixtes</span>}
            </h3>
            <div className="table-wrap">
              <table className="holding-table">
                <thead>
                  <tr>
                    <th scope="col">Titre</th>
                    <th scope="col">Parts</th>
                    <th scope="col">Cours</th>
                    <th scope="col">Valeur finale</th>
                    <th scope="col">Rendement</th>
                    <th scope="col">Frais</th>
                  </tr>
                </thead>
                <tbody>
                  {scenario.holdings.map((h) => (
                    <tr key={h.id}>
                      <th scope="row">{h.symbol}</th>
                      <td>{fmtShares(h.shares)}</td>
                      <td className="nowrap">
                        {fmtPrice(h.startPrice)} → {fmtPrice(h.endPrice)}
                      </td>
                      <td>
                        {fmtMoney(h.final, h.currency)}
                        <span className="cell-sub">sur {fmtMoney(h.initial, h.currency)}</span>
                      </td>
                      <td>
                        <Signed value={h.returnPct}>{fmtPercent(h.returnPct)}</Signed>
                      </td>
                      <td>
                        {fmtPercent(h.feePct, false)}
                        {h.feesCost > 0 && <span className="cell-sub">−{fmtMoney(h.feesCost, h.currency)}</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        ))}
      </div>
    </section>
  );
}
