import type { ChangeEvent } from 'react';
import type { ApiClientError } from '../api';
import type { AddResult } from '../hooks';
import type { AmountMode, HoldingDraft, ScenarioDraft } from '../simulation';
import { parseNumber } from '../simulation';
import { CloseIcon } from './Icons';
import SymbolSearch from './SymbolSearch';

export const MAX_HOLDINGS = 10;

interface Props {
  /** « a » ou « b » : sert aux couleurs et aux libellés. */
  slot: 'a' | 'b';
  scenario: ScenarioDraft;
  onChange: (scenario: ScenarioDraft) => void;
  pending: string[];
  errors: Record<string, ApiClientError>;
  /** Remplace ce scénario par une copie de l'autre (pratique pour ne changer qu'un détail). */
  onCopyOther: (() => void) | null;
  otherName: string;
  newId: () => string;
}

const MODE_LABELS: Record<AmountMode, string> = { amount: 'Montant', shares: 'Parts' };

function valueProblem(h: HoldingDraft): string | null {
  const value = parseNumber(h.value);
  if (h.value.trim() === '') return h.mode === 'amount' ? 'Indique un montant.' : 'Indique un nombre de parts.';
  if (value === null || value <= 0) return h.mode === 'amount' ? 'Montant invalide.' : 'Nombre de parts invalide.';
  return null;
}

function feeProblem(h: HoldingDraft): string | null {
  const fee = parseNumber(h.fee);
  return h.fee.trim() !== '' && (fee === null || fee < 0 || fee >= 100) ? 'Frais invalides (de 0 à 99 %).' : null;
}

export default function ScenarioEditor({ slot, scenario, onChange, pending, errors, onCopyOther, otherName, newId }: Props) {
  const letter = slot.toUpperCase();
  const update = (id: string, patch: Partial<HoldingDraft>) =>
    onChange({ ...scenario, holdings: scenario.holdings.map((h) => (h.id === id ? { ...h, ...patch } : h)) });

  const add = (symbol: string, name: string): AddResult => {
    const upper = symbol.toUpperCase();
    if (scenario.holdings.some((h) => h.symbol === upper)) return 'exists';
    if (scenario.holdings.length >= MAX_HOLDINGS) return 'full';
    onChange({
      ...scenario,
      holdings: [...scenario.holdings, { id: newId(), symbol: upper, name, mode: 'amount', value: '1000', fee: '' }],
    });
    return 'added';
  };

  return (
    <section className={`scenario scenario-${slot}`} aria-label={`Scénario ${letter}`}>
      <header className="scenario-head">
        <span className="scenario-badge" aria-hidden="true">
          {letter}
        </span>
        <label className="scenario-name">
          <span className="sr-only">Nom du scénario {letter}</span>
          <input
            value={scenario.name}
            maxLength={40}
            placeholder={`Scénario ${letter}`}
            onChange={(e: ChangeEvent<HTMLInputElement>) => onChange({ ...scenario, name: e.target.value })}
          />
        </label>
        {onCopyOther && (
          <button type="button" className="btn btn-small" onClick={onCopyOther} title={`Remplacer par une copie de « ${otherName} »`}>
            Copier {slot === 'a' ? 'B' : 'A'}
          </button>
        )}
      </header>

      <SymbolSearch
        onPick={(symbol, hit) => add(symbol, hit.name)}
        placeholder="Ajouter une action, un FNB…"
        fullMessage={`Un scénario compte au plus ${MAX_HOLDINGS} titres.`}
      />

      {scenario.holdings.length === 0 ? (
        <p className="scenario-empty">Aucun titre. Cherche un symbole pour composer ce portefeuille.</p>
      ) : (
        <ul className="holdings">
          {scenario.holdings.map((h) => {
            const badValue = valueProblem(h);
            const badFee = feeProblem(h);
            const problem = badValue ?? badFee;
            const error = errors[h.symbol];
            const loading = pending.includes(h.symbol);
            return (
              <li key={h.id} className="holding">
                <div className="holding-id">
                  <span className="holding-symbol">{h.symbol}</span>
                  <span className="holding-name">{h.name}</span>
                  <button
                    type="button"
                    className="holding-remove"
                    onClick={() => onChange({ ...scenario, holdings: scenario.holdings.filter((x) => x.id !== h.id) })}
                    aria-label={`Retirer ${h.symbol} du scénario ${letter}`}
                    title="Retirer"
                  >
                    <CloseIcon />
                  </button>
                </div>

                <div className="holding-fields">
                  <div className="seg" role="group" aria-label={`Saisir ${h.symbol} en montant ou en parts`}>
                    {(Object.keys(MODE_LABELS) as AmountMode[]).map((mode) => (
                      <button
                        key={mode}
                        type="button"
                        className="seg-btn"
                        aria-pressed={h.mode === mode}
                        onClick={() => h.mode !== mode && update(h.id, { mode, value: mode === 'amount' ? '1000' : '10' })}
                      >
                        {MODE_LABELS[mode]}
                      </button>
                    ))}
                  </div>
                  <label className="field">
                    <span className="field-label">{h.mode === 'amount' ? 'Montant investi' : 'Nombre de parts'}</span>
                    <span className="field-box">
                      <input
                        inputMode="decimal"
                        autoComplete="off"
                        value={h.value}
                        aria-invalid={badValue !== null}
                        onChange={(e: ChangeEvent<HTMLInputElement>) => update(h.id, { value: e.target.value })}
                      />
                      {h.mode === 'amount' && <span className="field-unit">$</span>}
                    </span>
                  </label>
                  <label className="field field-fee">
                    <span className="field-label">Frais annuels</span>
                    <span className="field-box">
                      <input
                        inputMode="decimal"
                        autoComplete="off"
                        placeholder="0"
                        value={h.fee}
                        aria-invalid={badFee !== null}
                        title="Frais de gestion annuels (RFG) du fonds. 0 pour une action."
                        onChange={(e: ChangeEvent<HTMLInputElement>) => update(h.id, { fee: e.target.value })}
                      />
                      <span className="field-unit">%</span>
                    </span>
                  </label>
                </div>

                {(problem || error || loading) && (
                  <p className={`holding-note${problem || error ? ' is-error' : ''}`} role={problem || error ? 'alert' : undefined}>
                    {problem ?? error?.message ?? 'Chargement de l’historique…'}
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
