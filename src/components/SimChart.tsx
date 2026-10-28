import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent, PointerEvent } from 'react';
import type { ChartPoint, SliceKind } from '../periods';
import { MARGIN, buildXTicks, clamp, niceTicks } from './PriceChart';

export interface SimLine {
  /** « a » ou « b » : choisit la couleur de la courbe (voir .sim-line-a / .sim-line-b). */
  key: string;
  values: number[];
}

interface Props {
  /** Jours UTC depuis 1970, communs à toutes les courbes. */
  days: number[];
  lines: SimLine[];
  kind: SliceKind;
  baseline: number | null;
  formatAxis: (value: number) => string;
  label: string;
  hoverIndex: number | null;
  onHover: (index: number | null) => void;
  revealKey: string;
}

/** Graphique à plusieurs courbes pour comparer des portefeuilles (même mise en page que PriceChart). */
export default function SimChart({ days, lines, kind, baseline, formatAxis, label, hoverIndex, onHover, revealKey }: Props) {
  const wrap = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });

  useLayoutEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const measure = () => setSize({ width: el.clientWidth, height: el.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const n = days.length;
  const plotW = Math.max(size.width - MARGIN.left - MARGIN.right, 10);
  const plotH = Math.max(size.height - MARGIN.top - MARGIN.bottom, 10);

  const geometry = useMemo(() => {
    if (n === 0 || lines.length === 0) return null;
    let min = Infinity;
    let max = -Infinity;
    for (const line of lines) {
      for (const v of line.values) {
        if (v < min) min = v;
        if (v > max) max = v;
      }
    }
    if (baseline !== null) {
      min = Math.min(min, baseline);
      max = Math.max(max, baseline);
    }
    const pad = (max - min || Math.abs(max) * 0.02 || 1) * 0.08;
    const lo = min - pad;
    const hi = max + pad;

    const x = (i: number) => MARGIN.left + (n === 1 ? plotW / 2 : (i / (n - 1)) * plotW);
    const y = (v: number) => MARGIN.top + (1 - (v - lo) / (hi - lo)) * plotH;

    const paths = lines.map((line) => {
      let d = '';
      for (let i = 0; i < n; i++) {
        const v = line.values[i];
        if (v !== undefined) d += `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(v).toFixed(1)}`;
      }
      return { key: line.key, d };
    });

    const timePoints: ChartPoint[] = days.map((day) => ({ time: day * 86_400, value: 0 }));
    return {
      x,
      y,
      paths,
      bottom: MARGIN.top + plotH,
      yTicks: niceTicks(lo, hi, Math.round(plotH / 64)).map((v) => ({ y: y(v), label: formatAxis(v) })),
      xTicks: buildXTicks(timePoints, kind, clamp(Math.floor(plotW / 96), 2, 8), x),
    };
  }, [days, lines, kind, baseline, formatAxis, n, plotW, plotH]);

  const ready = geometry !== null && size.width > 0 && size.height > 0;

  const handlePointer = (event: PointerEvent<SVGRectElement>) => {
    if (n === 0) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const ratio = clamp((event.clientX - rect.left) / rect.width, 0, 1);
    onHover(n === 1 ? 0 : Math.round(ratio * (n - 1)));
  };

  const handleKey = (event: KeyboardEvent<HTMLDivElement>) => {
    if (n === 0) return;
    const current = hoverIndex ?? n - 1;
    // Les historiques quotidiens comptent des milliers de points : Pg préc./Pg suiv. sautent d'un mois environ.
    const big = kind === 'monthly' ? 12 : 21;
    let next: number | null;
    if (event.key === 'ArrowLeft') next = Math.max(current - 1, 0);
    else if (event.key === 'ArrowRight') next = Math.min(current + 1, n - 1);
    else if (event.key === 'PageDown') next = Math.max(current - big, 0);
    else if (event.key === 'PageUp') next = Math.min(current + big, n - 1);
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = n - 1;
    else if (event.key === 'Escape') next = null;
    else return;
    event.preventDefault();
    onHover(next);
  };

  return (
    <div
      ref={wrap}
      className="chart"
      tabIndex={0}
      role="group"
      aria-label={`${label}. Flèches gauche et droite pour parcourir les valeurs, Échap pour revenir.`}
      onKeyDown={handleKey}
      onBlur={() => onHover(null)}
    >
      {ready && geometry && (
        <svg width={size.width} height={size.height} aria-hidden="true">
          {geometry.yTicks.map((tick) => (
            <g key={tick.label + tick.y}>
              <line className="grid" x1={MARGIN.left} x2={MARGIN.left + plotW} y1={tick.y} y2={tick.y} />
              <text className="axis-label" x={MARGIN.left + plotW + 10} y={tick.y} dy="0.32em">
                {tick.label}
              </text>
            </g>
          ))}
          {geometry.xTicks.map((tick) => (
            <text key={tick.x} className="axis-label" x={tick.x} y={geometry.bottom + 18} textAnchor={tick.anchor}>
              {tick.label}
            </text>
          ))}

          {baseline !== null && (
            <line className="baseline" x1={MARGIN.left} x2={MARGIN.left + plotW} y1={geometry.y(baseline)} y2={geometry.y(baseline)} />
          )}

          {geometry.paths.map((path) => (
            <path key={`${path.key}-${revealKey}`} className={`chart-line sim-line-${path.key}`} d={path.d} pathLength={1} fill="none" />
          ))}

          {hoverIndex !== null && hoverIndex < n && (
            <g>
              <line className="cross" x1={geometry.x(hoverIndex)} x2={geometry.x(hoverIndex)} y1={MARGIN.top} y2={geometry.bottom} />
              {lines.map((line) => {
                const v = line.values[hoverIndex];
                return v === undefined ? null : (
                  <circle key={line.key} className={`hover-dot sim-dot-${line.key}`} cx={geometry.x(hoverIndex)} cy={geometry.y(v)} r="5" />
                );
              })}
            </g>
          )}

          <rect
            className="hit"
            x={MARGIN.left}
            y={MARGIN.top}
            width={plotW}
            height={plotH}
            onPointerMove={handlePointer}
            onPointerDown={handlePointer}
            onPointerLeave={() => onHover(null)}
          />
        </svg>
      )}
    </div>
  );
}
