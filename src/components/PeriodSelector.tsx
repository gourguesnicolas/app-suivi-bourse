import { useLayoutEffect, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { PERIODS } from '../periods';
import type { PeriodId } from '../periods';

interface Props {
  value: PeriodId;
  onChange: (period: PeriodId) => void;
}

/** Règle graduée des périodes : une pastille glisse vers la période choisie. */
export default function PeriodSelector({ value, onChange }: Props) {
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  const track = useRef<HTMLDivElement>(null);
  const [thumb, setThumb] = useState<{ left: number; width: number } | null>(null);
  const activeIndex = PERIODS.findIndex((p) => p.id === value);

  useLayoutEffect(() => {
    const measure = () => {
      const el = buttons.current[activeIndex];
      if (el) setThumb({ left: el.offsetLeft, width: el.offsetWidth });
    };
    measure();
    const observer = new ResizeObserver(measure);
    if (track.current) observer.observe(track.current);
    return () => observer.disconnect();
  }, [activeIndex]);

  useLayoutEffect(() => {
    buttons.current[activeIndex]?.scrollIntoView({ inline: 'center', block: 'nearest' });
  }, [activeIndex]);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    let next = activeIndex;
    if (event.key === 'ArrowRight') next = (activeIndex + 1) % PERIODS.length;
    else if (event.key === 'ArrowLeft') next = (activeIndex - 1 + PERIODS.length) % PERIODS.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = PERIODS.length - 1;
    else return;
    event.preventDefault();
    const target = PERIODS[next];
    if (!target) return;
    onChange(target.id);
    buttons.current[next]?.focus();
  };

  return (
    <div className="periods" role="tablist" aria-label="Période du graphique" onKeyDown={onKeyDown}>
      <div className="periods-track" ref={track}>
        {thumb && <span className="periods-thumb" style={{ transform: `translateX(${thumb.left}px)`, width: thumb.width }} aria-hidden="true" />}
        {PERIODS.map((period, index) => {
          const selected = period.id === value;
          return (
            <button
              key={period.id}
              ref={(el: HTMLButtonElement | null) => {
                buttons.current[index] = el;
              }}
              type="button"
              role="tab"
              aria-selected={selected}
              aria-label={period.title}
              title={period.title}
              tabIndex={selected ? 0 : -1}
              className={`period${selected ? ' is-active' : ''}`}
              onClick={() => onChange(period.id)}
            >
              {period.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
