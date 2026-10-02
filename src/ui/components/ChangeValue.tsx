import { useReducedMotion } from '../hooks';

/**
 * One way to show a change everywhere: the old value muted, an arrow, the new
 * value, and a compact badge (↑ +1). The new value gets a short pulse and a
 * slight lift that lands; colour says whether the change is good (a rise in
 * something bad is not celebrated). Presentation only: the value is already
 * saved when this shows.
 */
export function ChangeValue({
  before,
  after,
  good,
  size = 'md',
  delay = 0,
  format = (n: number) => String(n),
}: {
  before: number;
  after: number;
  /** Whether this change is favourable (defaults to "up is good"). */
  good?: boolean;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  /** Start the pulse after this many ms (staggered lists). */
  delay?: number;
  format?: (n: number) => string;
}) {
  const reduced = useReducedMotion();
  const d = after - before;
  const fav = good ?? d >= 0;
  const tone = d === 0 ? 'flat' : fav ? 'up' : 'down';
  return (
    <span className={`cv cv-${size} cv-${tone} ${reduced ? 'still' : ''}`} style={{ ['--cv-delay' as string]: `${delay}ms` }}>
      <span className="cv-old">{format(before)}</span>
      <span className="cv-arrow" aria-hidden="true">
        →
      </span>
      <span className="sr-only"> to </span>
      <span className="cv-new">{format(after)}</span>
      {d !== 0 && (
        <span className="cv-badge">
          <span aria-hidden="true">{d > 0 ? '↑' : '↓'}</span> {d > 0 ? '+' : '−'}
          {format(Math.abs(d))}
        </span>
      )}
    </span>
  );
}
