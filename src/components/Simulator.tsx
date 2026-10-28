import { useEffect, useMemo, useState } from 'react';
import type { ChangeEvent } from 'react';
import { useSeriesSet } from '../hooks';
import { subtractMonths } from '../periods';
import type { ScenarioDraft } from '../simulation';
import { DAILY_MAX_YEARS, datasetFor, fromDay, isMonthly, simulate, todayDay } from '../simulation';
import Notice from './Notice';
import ScenarioEditor from './ScenarioEditor';
import SimResults from './SimResults';

interface SimState {
  start: string;
  end: string;
  dividends: boolean;
  scenarios: [ScenarioDraft, ScenarioDraft];
}

const STORAGE_KEY = 'cotes.simulation.v1';
const PRESETS = [1, 5, 10, 20, 30];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

let counter = 0;
const newId = () => `${Date.now().toString(36)}-${(counter++).toString(36)}`;

function defaultState(): SimState {
  const today = fromDay(todayDay());
  return {
    start: subtractMonths(today, 120),
    end: today,
    dividends: true,
    scenarios: [
      {
        name: 'S&P 500',
        holdings: [{ id: newId(), symbol: 'VOO', name: 'Vanguard S&P 500 ETF', mode: 'amount', value: '10000', fee: '0,03' }],
      },
      {
        name: 'Nasdaq 100',
        holdings: [{ id: newId(), symbol: 'QQQ', name: 'Invesco QQQ Trust', mode: 'amount', value: '10000', fee: '0,20' }],
      },
    ],
  };
}

function isScenario(value: unknown): value is ScenarioDraft {
  const s = value as ScenarioDraft | null;
  return (
    typeof s === 'object' &&
    s !== null &&
    typeof s.name === 'string' &&
    Array.isArray(s.holdings) &&
    s.holdings.every(
      (h) =>
        typeof h.id === 'string' &&
        typeof h.symbol === 'string' &&
        typeof h.name === 'string' &&
        (h.mode === 'amount' || h.mode === 'shares') &&
        typeof h.value === 'string' &&
        typeof h.fee === 'string',
    )
  );
}

function readState(): SimState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw !== null) {
      const s = JSON.parse(raw) as Partial<SimState>;
      if (
        typeof s.start === 'string' &&
        DATE_RE.test(s.start) &&
        typeof s.end === 'string' &&
        DATE_RE.test(s.end) &&
        typeof s.dividends === 'boolean' &&
        Array.isArray(s.scenarios) &&
        s.scenarios.length === 2 &&
        s.scenarios.every(isScenario)
      ) {
        return s as SimState;
      }
    }
  } catch {
    /* simulation illisible : on repart des valeurs par défaut */
  }
  return defaultState();
}

export default function Simulator() {
  const [state, setState] = useState<SimState>(readState);
  const today = fromDay(todayDay());

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      /* ignoré */
    }
  }, [state]);

  const { start, end, dividends, scenarios } = state;
  const dataset = datasetFor(start, dividends);
  const monthly = isMonthly(dataset);
  const symbols = useMemo(() => scenarios.flatMap((s) => s.holdings.map((h) => h.symbol)), [scenarios]);
  const series = useSeriesSet(symbols, dataset);

  const datesOk = DATE_RE.test(start) && DATE_RE.test(end) && start < end;
  const ready = datesOk && series.pending.length === 0 && Object.keys(series.errors).length === 0;
  const outcome = useMemo(() => (ready ? simulate(scenarios, series.data, start, end) : null), [ready, scenarios, start, end, series.data]);

  const setScenario = (index: 0 | 1, scenario: ScenarioDraft) =>
    setState((s) => {
      const next: [ScenarioDraft, ScenarioDraft] = [...s.scenarios];
      next[index] = scenario;
      return { ...s, scenarios: next };
    });
  const copy = (from: 0 | 1, to: 0 | 1) => {
    const source = scenarios[from];
    setScenario(to, { name: `${source.name} (copie)`.slice(0, 40), holdings: source.holdings.map((h) => ({ ...h, id: newId() })) });
  };

  const preset = (years: number) => setState((s) => ({ ...s, start: subtractMonths(today, years * 12), end: today }));
  const activePreset = end === today ? PRESETS.find((y) => subtractMonths(today, y * 12) === start) : undefined;
  const errorCount = Object.keys(series.errors).length;

  return (
    <div className="sim">
      <header className="sim-head">
        <h1>Simulation</h1>
        <p>Compose jusqu’à deux portefeuilles, choisis une période et compare ce qu’ils seraient devenus, frais de gestion déduits.</p>
      </header>

      <section className="sim-period" aria-label="Période simulée">
        <div className="sim-dates">
          <label className="field">
            <span className="field-label">Début</span>
            <span className="field-box">
              <input
                type="date"
                value={start}
                min="1970-01-01"
                max={end || today}
                required
                onChange={(e: ChangeEvent<HTMLInputElement>) => setState((s) => ({ ...s, start: e.target.value }))}
              />
            </span>
          </label>
          <label className="field">
            <span className="field-label">Fin</span>
            <span className="field-box">
              <input
                type="date"
                value={end}
                min={start}
                max={today}
                required
                onChange={(e: ChangeEvent<HTMLInputElement>) => setState((s) => ({ ...s, end: e.target.value }))}
              />
            </span>
          </label>
          <div className="seg sim-presets" role="group" aria-label="Périodes jusqu’à aujourd’hui">
            {PRESETS.map((years) => (
              <button key={years} type="button" className="seg-btn" aria-pressed={activePreset === years} onClick={() => preset(years)}>
                {years}&nbsp;a
              </button>
            ))}
          </div>
        </div>

        <label className="check">
          <input type="checkbox" checked={dividends} onChange={(e) => setState((s) => ({ ...s, dividends: e.target.checked }))} />
          <span>Réinvestir les dividendes</span>
        </label>

        <p className="sim-note">
          {monthly
            ? `Au-delà de ${DAILY_MAX_YEARS} ans, la simulation utilise les cours de fin de mois.`
            : 'Simulation sur les cours de clôture quotidiens.'}{' '}
          {dividends ? 'Les dividendes sont réinvestis dans le même titre.' : 'Les dividendes sont ignorés (rendement du cours seulement).'}{' '}
          Chaque nouveau titre coûte un crédit Twelve Data.
        </p>
      </section>

      <div className="sim-scenarios">
        {([0, 1] as const).map((index) => {
          const other = index === 0 ? 1 : 0;
          const otherScenario = scenarios[other];
          return (
            <ScenarioEditor
              key={index}
              slot={index === 0 ? 'a' : 'b'}
              scenario={scenarios[index]}
              onChange={(s) => setScenario(index, s)}
              pending={series.pending}
              errors={series.errors}
              onCopyOther={otherScenario.holdings.length > 0 ? () => copy(other, index) : null}
              otherName={otherScenario.name}
              newId={newId}
            />
          );
        })}
      </div>

      {!datesOk ? (
        <Notice tone="error">La date de début doit précéder la date de fin.</Notice>
      ) : errorCount > 0 ? (
        <Notice tone="error" action={{ label: 'Réessayer', onClick: series.retry }}>
          {errorCount === 1 ? 'Un titre n’a pas pu être chargé' : `${errorCount} titres n’ont pas pu être chargés`} (détail sous chaque
          titre). Retire-les ou réessaie.
        </Notice>
      ) : series.pending.length > 0 ? (
        <div className="sim-loading" role="status">
          <span className="skeleton-line" />
          <span>
            {series.waiting
              ? 'Limite par minute de Twelve Data atteinte : reprise automatique dans quelques secondes…'
              : `Chargement des historiques (${series.pending.join(', ')})…`}
          </span>
        </div>
      ) : outcome && !outcome.ok ? (
        <Notice tone="info">{outcome.message}</Notice>
      ) : outcome?.ok ? (
        <>
          {outcome.result.lateStarts.length > 0 && (
            <Notice tone="info">
              La simulation commence le {fromDay(outcome.result.startDay)} :{' '}
              {outcome.result.lateStarts.map((l) => `${l.symbol} (historique depuis le ${fromDay(l.firstDay)})`).join(', ')}. Les deux
              scénarios partent de la même date pour rester comparables.
            </Notice>
          )}
          <SimResults result={outcome.result} kind={monthly ? 'monthly' : 'daily'} />
          <p className="sim-note">
            Rendements passés, calculés avec les données de Twelve Data. Les frais de gestion sont déduits chaque jour au prorata. Les
            impôts, les commissions de courtage et les taux de change ne sont pas pris en compte.
          </p>
        </>
      ) : null}
    </div>
  );
}
