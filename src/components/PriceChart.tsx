import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent, PointerEvent } from 'react';
import { fmtPrice, fmtTime } from '../format';
import type { DateStyle, Tone } from '../format';
import type { ChartPoint, SliceKind } from '../periods';

interface Props {
  points: ChartPoint[];
  baseline: number | null;
  kind: SliceKind;
  tone: Tone;
  label: string;
  hoverIndex: number | null;
  onHover: (index: number | null) => void;
  /** Change quand le titre ou la période change : relance l'animation de tracé. */
  revealKey: string;
}

const MARGIN = { top: 14, right: 66, bottom: 28, left: 6 };
const DAY = 86_400;

const clamp = (n: number, min: number, max: number) => Math.min(Math.max(n, min), max);

function niceTicks(min: number, max: number, wanted: number): number[] {
  const span = max - min || Math.abs(max) * 0.02 || 1;
  const raw = span / Math.max(wanted, 1);
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const normalized = raw / magnitude;
  const step = (normalized < 1.5 ? 1 : normalized < 3 ? 2 : normalized < 7 ? 5 : 10) * magnitude;
  const ticks: number[] = [];
  for (let v = Math.ceil(min / step) * step; v <= max + step * 1e-9; v += step) {
    ticks.push(Number(v.toPrecision(12)));
  }
  return ticks;
}

type Unit = 'hour' | 'day' | 'week' | 'month' | 'year';

/** Identifiant du « seau » calendaire (heure, jour, semaine, mois, année) qui contient `time`. Heures lues en UTC, voir format.ts. */
function bucket(time: number, unit: Unit): number {
  switch (unit) {
    case 'hour':
      return Math.floor(time / 3600);
    case 'day':
      return Math.floor(time / DAY);
    case 'week':
      return Math.floor((time / DAY + 3) / 7); // les semaines commencent le lundi
    case 'month': {
      const d = new Date(time * 1000);
      return d.getUTCFullYear() * 12 + d.getUTCMonth();
    }
    case 'year':
      return new Date(time * 1000).getUTCFullYear();
  }
}

function pickUnit(kind: SliceKind, spanDays: number): { unit: Unit; style: DateStyle } {
  if (kind === 'intraday') return spanDays <= 1.5 ? { unit: 'hour', style: 'hour' } : { unit: 'day', style: 'weekdayDay' };
  if (spanDays <= 45) return { unit: 'week', style: 'dayShort' };
  if (spanDays <= 1100) return { unit: 'month', style: spanDays > 400 ? 'monthYear' : 'monthShort' };
  return { unit: 'year', style: 'year' };
}

/**
 * Repères de l'axe horizontal posés sur des débuts de période (heures rondes, lundis, 1er du mois,
 * 1er janvier) plutôt qu'à intervalles arbitraires, puis espacés pour tenir dans la largeur.
 */
function buildXTicks(points: ChartPoint[], kind: SliceKind, count: number, x: (i: number) => number) {
  const first = points[0];
  const last = points[points.length - 1];
  if (!first || !last || points.length < 2) return [];
  const { unit, style } = pickUnit(kind, (last.time - first.time) / DAY);

  const candidates: number[] = [];
  // Séances : la première barre est bien un début de journée. Ailleurs, la fenêtre commence en cours de période.
  if (kind === 'intraday' && unit === 'day') candidates.push(0);
  let previous = bucket(first.time, unit);
  for (let i = 1; i < points.length; i++) {
    const p = points[i];
    if (!p) continue;
    const current = bucket(p.time, unit);
    if (current !== previous) {
      candidates.push(i);
      previous = current;
    }
  }

  const step = Math.max(1, Math.ceil(candidates.length / count));
  return candidates
    .filter((_, k) => k % step === 0)
    .flatMap((index) => {
      const p = points[index];
      if (!p) return [];
      const px = x(index);
      return [{ x: px, label: fmtTime(p.time, style), anchor: px - MARGIN.left < 26 ? ('start' as const) : ('middle' as const) }];
    });
}

export function hoverLabel(time: number, kind: SliceKind): string {
  if (kind === 'intraday') return fmtTime(time, 'fullTime');
  if (kind === 'monthly') return fmtTime(time, 'monthYear');
  return fmtTime(time, 'full');
}

export default function PriceChart({ points, baseline, kind, tone, label, hoverIndex, onHover, revealKey }: Props) {
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

  const n = points.length;
  const plotW = Math.max(size.width - MARGIN.left - MARGIN.right, 10);
  const plotH = Math.max(size.height - MARGIN.top - MARGIN.bottom, 10);

  const geometry = useMemo(() => {
    if (n === 0) return null;
    let min = Infinity;
    let max = -Infinity;
    for (const p of points) {
      if (p.value < min) min = p.value;
      if (p.value > max) max = p.value;
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

    let line = '';
    for (let i = 0; i < n; i++) {
      const p = points[i];
      if (p) line += `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`;
    }
    const bottom = MARGIN.top + plotH;
    const area = `${line}L${x(n - 1).toFixed(1)},${bottom}L${x(0).toFixed(1)},${bottom}Z`;

    const yTicks = niceTicks(lo, hi, Math.round(plotH / 64));
    const step = yTicks.length > 1 ? (yTicks[1] ?? 0) - (yTicks[0] ?? 0) : 1;
    const stepDecimals = clamp(-Math.floor(Math.log10(step || 1)), 0, 6);
    const digits = Math.max(stepDecimals, hi < 100 ? 2 : 0);

    const xTicks = buildXTicks(points, kind, clamp(Math.floor(plotW / 96), 2, 8), x);

    return {
      x,
      y,
      line,
      area,
      bottom,
      yTicks: yTicks.map((v) => ({ y: y(v), label: fmtPrice(v, digits) })),
      xTicks,
      digits,
    };
  }, [points, baseline, kind, n, plotW, plotH]);

  const ready = geometry !== null && size.width > 0 && size.height > 0;
  const last = points[n - 1];
  const hovered = hoverIndex !== null ? points[hoverIndex] : undefined;

  const handlePointer = (event: PointerEvent<SVGRectElement>) => {
    if (n === 0) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const ratio = clamp((event.clientX - rect.left) / rect.width, 0, 1);
    onHover(n === 1 ? 0 : Math.round(ratio * (n - 1)));
  };

  const handleKey = (event: KeyboardEvent<HTMLDivElement>) => {
    if (n === 0) return;
    const current = hoverIndex ?? n - 1;
    let next: number | null;
    if (event.key === 'ArrowLeft') next = Math.max(current - 1, 0);
    else if (event.key === 'ArrowRight') next = Math.min(current + 1, n - 1);
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
      className={`chart tone-${tone}`}
      tabIndex={0}
      role="group"
      aria-label={`${label}. Flèches gauche et droite pour parcourir les valeurs, Échap pour revenir.`}
      onKeyDown={handleKey}
      onBlur={() => onHover(null)}
    >
      {ready && geometry && (
        <svg width={size.width} height={size.height} aria-hidden="true">
          <defs>
            <linearGradient id="chart-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" style={{ stopColor: 'var(--trend)', stopOpacity: 0.26 }} />
              <stop offset="100%" style={{ stopColor: 'var(--trend)', stopOpacity: 0 }} />
            </linearGradient>
          </defs>

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

          <path key={`a-${revealKey}`} className="chart-area" d={geometry.area} fill="url(#chart-fill)" />
          <path key={`l-${revealKey}`} className="chart-line" d={geometry.line} pathLength={1} fill="none" />

          {last && !hovered && <circle className="end-dot" cx={geometry.x(n - 1)} cy={geometry.y(last.value)} r="4" />}

          {hovered && hoverIndex !== null && (
            <g>
              <line className="cross" x1={geometry.x(hoverIndex)} x2={geometry.x(hoverIndex)} y1={MARGIN.top} y2={geometry.bottom} />
              <circle className="hover-dot" cx={geometry.x(hoverIndex)} cy={geometry.y(hovered.value)} r="5" />
              <g transform={`translate(${MARGIN.left + plotW + 4}, ${geometry.y(hovered.value) - 10})`}>
                <rect className="tag" width="58" height="20" rx="5" />
                <text className="tag-text" x="29" y="10" dy="0.34em" textAnchor="middle">
                  {fmtPrice(hovered.value)}
                </text>
              </g>
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
