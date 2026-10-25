import type { CSSProperties } from 'react';

interface Props {
  low: number | null;
  high: number | null;
  value: number;
  /** Version fine pour les lignes de la liste de suivi. */
  compact?: boolean;
  label: string;
}

/** Barre « bas — haut » avec un repère à la position du cours actuel. */
export default function RangeBar({ low, high, value, compact, label }: Props) {
  const valid = low !== null && high !== null && high > low;
  const position = valid ? Math.min(Math.max((value - low) / (high - low), 0), 1) * 100 : 50;
  return (
    <div
      className={`range${compact ? ' range-compact' : ''}${valid ? '' : ' range-empty'}`}
      style={{ '--pos': `${position}%` } as CSSProperties}
      role="img"
      aria-label={valid ? `${label} : le cours est à ${Math.round(position)} % de la fourchette` : `${label} : indisponible`}
    >
      <span className="range-track" />
      {valid && <span className="range-dot" />}
    </div>
  );
}
