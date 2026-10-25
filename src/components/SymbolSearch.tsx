import { useEffect, useId, useRef, useState } from 'react';
import type { ChangeEvent, KeyboardEvent } from 'react';
import type { SearchHit } from '../../shared/types';
import { api } from '../api';
import type { AddResult } from '../hooks';
import { MAX_WATCHLIST } from '../hooks';
import { typeLabel } from '../format';
import { SearchIcon } from './Icons';

interface Props {
  onPick: (symbol: string) => AddResult;
}

type Phase = 'idle' | 'loading' | 'error';

const firstAvailable = (hits: SearchHit[], from = 0, direction = 1): number => {
  for (let i = from; i >= 0 && i < hits.length; i += direction) {
    if (hits[i]?.available) return i;
  }
  return -1;
};

export default function SymbolSearch({ onPick }: Props) {
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [phase, setPhase] = useState<Phase>('idle');
  const [message, setMessage] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [note, setNote] = useState<string | null>(null);
  const listId = useId();
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const q = query.trim();
    if (q === '') {
      setHits([]);
      setPhase('idle');
      setActive(-1);
      return;
    }
    setPhase('loading');
    const controller = new AbortController();
    const timer = setTimeout(() => {
      api
        .search(q, controller.signal)
        .then((res) => {
          setHits(res.hits);
          setActive(firstAvailable(res.hits));
          setPhase('idle');
          setMessage('');
        })
        .catch((err: unknown) => {
          if (controller.signal.aborted) return;
          setPhase('error');
          setMessage(err instanceof Error ? err.message : 'Recherche impossible.');
        });
    }, 300);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query]);

  useEffect(() => {
    const onDown = (event: globalThis.PointerEvent) => {
      if (root.current && event.target instanceof Node && !root.current.contains(event.target)) setOpen(false);
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, []);

  const choose = (hit: SearchHit | undefined) => {
    if (!hit || !hit.available) return;
    const result = onPick(hit.symbol);
    if (result === 'full') {
      setNote(`Ta liste est pleine (${MAX_WATCHLIST} titres). Retire un titre pour en ajouter un autre.`);
      return;
    }
    setNote(null);
    setQuery('');
    setOpen(false);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setOpen(true);
      const next = firstAvailable(hits, active + 1, 1);
      if (next !== -1) setActive(next);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      const prev = firstAvailable(hits, active - 1, -1);
      if (prev !== -1) setActive(prev);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      // Pendant une recherche en cours, les résultats affichés sont ceux de la frappe précédente : on n'en choisit aucun.
      if (phase === 'idle') choose(hits[active]);
    } else if (event.key === 'Escape') {
      setOpen(false);
    }
  };

  const showList = open && query.trim() !== '';

  return (
    <div className="search" ref={root}>
      <label className="search-field">
        <SearchIcon />
        <span className="sr-only">Rechercher un titre</span>
        <input
          type="search"
          role="combobox"
          aria-expanded={showList}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={active >= 0 ? `${listId}-${active}` : undefined}
          placeholder="Rechercher un titre (AAPL, VOO…)"
          autoComplete="off"
          spellCheck={false}
          value={query}
          onChange={(e: ChangeEvent<HTMLInputElement>) => {
            setQuery(e.target.value);
            setOpen(true);
            setNote(null);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
        />
      </label>

      {note && <p className="search-note">{note}</p>}

      {showList && (
        <ul className={`search-list${phase === 'loading' ? ' is-stale' : ''}`} id={listId} role="listbox" aria-label="Résultats de recherche">
          {phase === 'loading' && hits.length === 0 && <li className="search-status">Recherche…</li>}
          {phase === 'error' && <li className="search-status">{message}</li>}
          {phase === 'idle' && hits.length === 0 && <li className="search-status">Aucun résultat pour « {query.trim()} ».</li>}
          {hits.map((hit, index) => (
            <li
              key={`${hit.symbol}-${hit.exchange}`}
              id={`${listId}-${index}`}
              role="option"
              aria-selected={index === active}
              aria-disabled={!hit.available}
              className={`hit-row${index === active ? ' is-active' : ''}${hit.available ? '' : ' is-disabled'}`}
              onPointerEnter={() => hit.available && setActive(index)}
              onClick={() => choose(hit)}
            >
              <span className="hit-symbol">{hit.symbol}</span>
              <span className="hit-name">{hit.name}</span>
              <span className="hit-meta">
                {[hit.exchange, typeLabel(hit.type)].filter(Boolean).join(' · ')}
                {!hit.available && <span className="hit-badge">Plan payant</span>}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
