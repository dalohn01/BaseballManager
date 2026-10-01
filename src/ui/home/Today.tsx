import { useEffect, useRef, useState } from 'react';
import { dateOf, longDate, seasonDayOf, weekStrip, WEEKDAYS, MONTHS } from '../../domain/seasonDates';
import { dayStack, previewText, type Folder } from '../../presentation/dayStack';
import { Icon } from '../components/icons';
import { useGame, useReducedMotion } from '../hooks';
import { DayCompleteCard, EventCard, FolderContext } from '../screens/EventCard';

/**
 * The week around today on the game calendar: the only place Home shows a
 * date. Informative only; days cannot be clicked or skipped to.
 */
export function SeasonCalendar() {
  const s = useGame();
  const { cells, monthLabel, label } = weekStrip(s);
  return (
    <section className="season-cal" aria-label="Calendar">
      <header className="season-cal-head">
        <span className="season-cal-month">{monthLabel}</span>
        <span className="season-cal-label">{label}</span>
      </header>
      <ol className="season-cal-week">
        {cells.map((c) => (
          <li
            key={c.sd.day}
            className={`cal-day ${c.today ? 'today' : ''} ${c.past ? 'past' : ''} ${c.outside ? 'outside' : ''}`}
            aria-current={c.today ? 'date' : undefined}
            aria-label={`${longDate(c.g)}${c.today ? ', today' : ''}${c.matchDay ? ', match day' : ''}`}
          >
            <span className="cal-wd">{WEEKDAYS[c.g.weekday]}</span>
            <span className="cal-date">{c.g.date}</span>
            {c.newMonth && <span className="cal-month">{MONTHS[c.g.month]}</span>}
            {c.matchDay && <BallIcon />}
          </li>
        ))}
      </ol>
    </section>
  );
}

export function BallIcon() {
  return (
    <svg className="cal-ball" viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="8" cy="8" r="6.5" fill="#fff" stroke="currentColor" strokeWidth="1.2" />
      <path d="M4.6 3.2c1.4 1.3 1.4 8.3 0 9.6M11.4 3.2c-1.4 1.3-1.4 8.3 0 9.6" fill="none" stroke="#d83a3a" strokeWidth="1.1" />
    </svg>
  );
}

const two = (n: number) => String(n).padStart(2, '0');

/**
 * Today's events as a bunch of folders: the current event in front with its
 * content, the rest of the day's tabs behind it (next nearest, Day complete
 * farthest). A later tab can be opened as a preview, which only shows what is
 * already known and never changes the queue; the current event (and an
 * unconfirmed choice in it) stays mounted underneath.
 */
export function DailyEventStack() {
  const s = useGame();
  const reduced = useReducedMotion();
  const stack = dayStack(s);
  const front = stack.folders[0];
  const behind = stack.folders.slice(1);
  const [previewKey, setPreviewKey] = useState<string | null>(null);
  const preview = previewKey ? behind.find((f) => f.key === previewKey) ?? null : null;

  // A handled folder slides aside as the next one comes forward.
  const prevFront = useRef<Folder>(front);
  const [ghost, setGhost] = useState<Folder | null>(null);
  useEffect(() => {
    const was = prevFront.current;
    prevFront.current = front;
    if (was.key === front.key) return;
    setPreviewKey(null);
    if (reduced || was.kind === 'dayComplete') return;
    setGhost(was);
    const id = window.setTimeout(() => setGhost(null), 300);
    return () => window.clearTimeout(id);
  }, [front.key, reduced]); // eslint-disable-line react-hooks/exhaustive-deps

  // New day: a short date line while the new stack comes in (presentation only).
  const today = seasonDayOf(s.calendar);
  const dayKey = `${today.season}:${today.day}`;
  const prevDay = useRef(dayKey);
  const [transition, setTransition] = useState<string | null>(null);
  useEffect(() => {
    if (prevDay.current === dayKey) return;
    prevDay.current = dayKey;
    setGhost(null);
    if (reduced) return;
    setTransition(`${longDate(dateOf(today))} · Day ${today.day}`);
    const id = window.setTimeout(() => setTransition(null), 750);
    return () => window.clearTimeout(id);
  }, [dayKey, reduced]); // eslint-disable-line react-hooks/exhaustive-deps

  const bodyRef = useRef<HTMLDivElement>(null);
  const frontTabRef = useRef<HTMLDivElement>(null);
  const shown = preview ?? front;
  return (
    <section className={`today ${transition ? 'day-changing' : ''}`} aria-label="Today's events">
      <header className="today-head">
        <h2>Today's events</h2>
        <span className="today-progress" role="status">
          {stack.total === 0 ? 'No events scheduled' : `${stack.handled} of ${stack.total} event${stack.total === 1 ? '' : 's'} handled`}
        </span>
      </header>
      {transition && (
        <p className="day-transition" aria-hidden="true">
          {transition}
        </p>
      )}
      <div className="folders" key={dayKey}>
        {behind
          .slice()
          .reverse()
          .map((f) => {
            const depth = behind.indexOf(f) + 1;
            return (
              <button
                key={f.key}
                className={`folder-tab back ${f.kind === 'dayComplete' ? 'done-tab' : ''} ${preview?.key === f.key ? 'previewing' : ''}`}
                style={{ marginInline: `${Math.min(depth, 3) * 14}px` }}
                onClick={() => setPreviewKey(preview?.key === f.key ? null : f.key)}
                aria-pressed={preview?.key === f.key}
                title={f.title}
              >
                <span className="ft-num">{two(f.number)}</span>
                <span className="ft-title">{f.title}</span>
                <span className="ft-tag">{preview?.key === f.key ? 'Preview' : f.next ? 'Up next' : f.kind === 'dayComplete' ? <Icon name="check" size={18} /> : ''}</span>
              </button>
            );
          })}
        {ghost && (
          <div className="folder ghost" aria-hidden="true">
            <div className="folder-tab front-tab">
              <span className="ft-num">{two(ghost.number)}</span>
              <span className="ft-title">{ghost.title}</span>
            </div>
          </div>
        )}
        <div className={`folder front ${preview ? 'is-preview' : ''} ${front.kind === 'dayComplete' && !preview ? 'is-done' : ''}`}>
          <div className="folder-tab front-tab" tabIndex={-1} ref={frontTabRef}>
            <span className="ft-num">{two(shown.number)}</span>
            <span className="ft-title">{shown.title}</span>
            <span className="ft-tag">{preview ? 'Preview' : front.kind === 'dayComplete' ? '' : 'Current'}</span>
          </div>
          <div className="folder-body" ref={bodyRef}>
            <FolderContext.Provider value={true}>
              {/* The current event stays mounted during a preview, so an unconfirmed choice is kept. */}
              <div hidden={!!preview}>{front.kind === 'dayComplete' ? <DayCompleteCard /> : <EventCard />}</div>
              {preview && <FolderPreview folder={preview} onReturn={() => {
                setPreviewKey(null);
                // Keyboard users land back on the current event.
                requestAnimationFrame(() => frontTabRef.current?.focus());
              }} />}
            </FolderContext.Provider>
          </div>
        </div>
      </div>
    </section>
  );
}

/** A later folder shown in front temporarily: known facts only, nothing can be decided here. */
function FolderPreview({ folder, onReturn }: { folder: Folder; onReturn: () => void }) {
  const ref = useRef<HTMLButtonElement>(null);
  useEffect(() => ref.current?.focus({ preventScroll: true }), [folder.key]);
  return (
    <div className="folder-preview">
      <button ref={ref} className="link folder-return" onClick={onReturn}>
        <Icon name="back" size={16} /> Return to current event
      </button>
      {folder.kind === 'dayComplete' ? (
        <DayCompleteCard preview />
      ) : (
        <section className="event-card">
          <p className="event-context">{previewText(folder)}</p>
          {folder.kind === 'built' && folder.event && folder.event.options.length > 0 && (
            <>
              <p className="folder-kicker">Choices you will have</p>
              <ul className="preview-options">
                {folder.event.options.map((o) => (
                  <li key={o.id}>
                    <strong>{o.label}</strong> <span className="muted">{o.summary}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
          <p className="muted small">This is a preview. It is decided when it comes up, after the events before it.</p>
        </section>
      )}
    </div>
  );
}
