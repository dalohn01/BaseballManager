import type { ReactNode } from 'react';
import type { EffectRecord } from '../../domain/state';
import type { ReasonEntry } from '../../domain/types';
import { money, signed } from '../format';

export function Panel({ title, children, className = '', action }: { title?: string; children: ReactNode; className?: string; action?: ReactNode }) {
  return (
    <section className={`panel ${className}`}>
      {title && (
        <header className="panel-head">
          <h2>{title}</h2>
          {action}
        </header>
      )}
      <div className="panel-body">{children}</div>
    </section>
  );
}

export function Ribbon({ children }: { children: ReactNode }) {
  return <span className="ribbon">{children}</span>;
}

export function Meter({
  label,
  value,
  caption,
  max = 100,
  tone = 'slate',
  reasons,
  display,
}: {
  label: string;
  value: number;
  caption?: string;
  max?: number;
  tone?: 'slate' | 'blue' | 'warn';
  reasons?: ReasonEntry[];
  /** Text to show instead of the raw number (e.g. a cash amount). */
  display?: string;
}) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  const body = (
    <>
      <div className="meter-row">
        <span className="meter-label">{label}</span>
        <span className="meter-value">{display ?? Math.round(value)}</span>
      </div>
      <div className="meter-track" role="meter" aria-valuemin={0} aria-valuemax={max} aria-valuenow={Math.round(value)} aria-label={label}>
        <div className={`meter-fill tone-${tone}`} style={{ width: `${pct}%` }} />
      </div>
      {caption && <div className="meter-caption">{caption}</div>}
    </>
  );
  if (!reasons || reasons.length === 0) return <div className="meter">{body}</div>;
  return (
    <details className="meter meter-details">
      <summary>{body}</summary>
      <ReasonList reasons={reasons} />
    </details>
  );
}

export function ReasonList({ reasons }: { reasons: ReasonEntry[] }) {
  return (
    <ul className="reasons">
      {reasons.slice(0, 6).map((r, i) => (
        <li key={i}>
          <span className={`delta ${r.delta > 0 ? 'pos' : 'neg'}`}>{signed(r.delta)}</span>
          <span>{r.text}</span>
          <span className="muted small">R{r.round}</span>
        </li>
      ))}
    </ul>
  );
}

export function RatingBar({ value, max = 100 }: { value: number; max?: number }) {
  return (
    <div className="rating-track" aria-hidden="true">
      <div className="rating-fill" style={{ width: `${(value / max) * 100}%` }} />
    </div>
  );
}

function formatValue(e: EffectRecord, v: number) {
  if (e.format === 'cash') return money(v);
  if (e.outOf) return `${v}/${e.outOf}`;
  return String(v);
}

/** Before → after list. Positive/negative is judged per stat (fatigue up is bad). */
export function EffectList({ effects, limit }: { effects: EffectRecord[]; limit?: number }) {
  const shown = limit ? effects.slice(0, limit) : effects;
  if (shown.length === 0) return <p className="muted">No measurable changes.</p>;
  return (
    <ul className="effects">
      {shown.map((e, i) => {
        const up = e.after > e.before;
        const good = e.stat === 'fatigue' ? !up : up;
        const delta = e.after - e.before;
        return (
          <li key={i} className={good ? 'good' : 'bad'}>
            <span className="eff-target">{e.targetLabel}</span>
            <span className="eff-stat">{e.statLabel}</span>
            <span className="eff-values">
              {formatValue(e, e.before)} <span aria-hidden="true">→</span>
              <span className="sr-only"> to </span> <strong>{formatValue(e, e.after)}</strong>
            </span>
            <span className={`eff-delta ${good ? 'pos' : 'neg'}`}>{e.format === 'cash' ? (delta > 0 ? '+' : '−') + money(Math.abs(delta)).replace('−', '') : signed(delta)}</span>
          </li>
        );
      })}
    </ul>
  );
}
