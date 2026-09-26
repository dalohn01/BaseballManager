import { useState } from 'react';
import { moveBatter } from '../../domain/lineupDraft';
import { battingStats, fmtRate, playerNotes } from '../../domain/playerStats';
import { overall } from '../../domain/ratings';
import { playerName } from '../../domain/state';
import { Avatar } from '../components/art';
import { Icon } from '../components/icons';
import type { DraftApi } from './PreMatchScreen';
import { FitnessMeter, HappinessMeter, hitterValues, Legend, Notes, PosBadge, Values } from './shared';

const GROUP: Record<number, string> = { 0: 'Top of the order', 3: 'Middle of the order', 6: 'Bottom of the order' };

/** What a batting spot means — descriptive only, no promised bonus. */
function spotText(i: number): string {
  if (i === 0) return 'Leads off: bats first in the first inning. Earlier spots come up more often over a game.';
  if (i <= 2) return 'Near the top: more plate appearances than the lower spots, often with runners on after the leadoff hitter.';
  if (i <= 5) return 'Middle of the order: bats after the top hitters, frequently with runners on base.';
  return 'Bottom of the order: the fewest plate appearances over a game.';
}

export function BattingTab({ api }: { api: DraftApi }) {
  const { state: s, draft, update, mode, period } = api;
  const [selected, setSelected] = useState(0);
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const order = draft.lineup.battingOrder;
  const sel = order[Math.min(selected, order.length - 1)];
  const p = s.players[sel.playerId];

  const move = (from: number, to: number) => {
    if (to < 0 || to >= order.length) return;
    update(moveBatter(draft, from, to));
    setSelected(to);
  };
  const b = battingStats(s, p, period);
  const cols = hitterValues(s, p, mode, period, 'order').map((v) => v.label);

  return (
    <div className="pm-order-layout">
      <section className="panel pm-order">
        <header className="panel-head">
          <h2>Batting order</h2>
          <small className="muted">Drag to reorder · arrows move one place · Alt + ↑/↓ on a row</small>
        </header>
        <div className="order-head" aria-hidden="true">
          <span />
          <span>#</span>
          <span>Pos</span>
          <span>Player</span>
          <span className="vals-head">
            {cols.map((c) => (
              <span key={c}>{c}</span>
            ))}
          </span>
          <span>Fitness</span>
          <span>Happiness</span>
          <span />
        </div>
        <ol className="order-rows">
          {order.map((slot, i) => {
            const pl = s.players[slot.playerId];
            return (
              <li
                key={slot.playerId}
                className={`order-row ${i === selected ? 'on' : ''} ${dragFrom !== null && dragFrom !== i ? 'droppable' : ''}`}
                draggable
                onDragStart={(e) => {
                  setDragFrom(i);
                  e.dataTransfer.setData('text/plain', String(i));
                }}
                onDragEnd={() => setDragFrom(null)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  const from = Number(e.dataTransfer.getData('text/plain'));
                  setDragFrom(null);
                  if (!Number.isNaN(from)) move(from, i);
                }}
              >
                {GROUP[i] && <span className="order-group">{GROUP[i]}</span>}
                <button
                  className="order-select"
                  onClick={() => setSelected(i)}
                  onKeyDown={(e) => {
                    if (e.altKey && e.key === 'ArrowUp') {
                      e.preventDefault();
                      move(i, i - 1);
                    }
                    if (e.altKey && e.key === 'ArrowDown') {
                      e.preventDefault();
                      move(i, i + 1);
                    }
                  }}
                  aria-label={`Batting ${i + 1}: ${playerName(pl)}, ${slot.position}. Alt plus arrow keys to move.`}
                  aria-pressed={i === selected}
                >
                  <span className="grip" aria-hidden="true">
                    ⋮⋮
                  </span>
                  <span className="order-num">{i + 1}</span>
                  <PosBadge pos={slot.position} />
                  <span className="order-name">
                    <Avatar player={pl} club={s.clubs[pl.clubId]} size={34} />
                    {playerName(pl)}
                  </span>
                  <Values vals={hitterValues(s, pl, mode, period, 'order')} />
                  <FitnessMeter value={pl.fitness} />
                  <HappinessMeter value={pl.satisfaction} />
                </button>
                <span className="order-move">
                  <button className="icon-btn small" onClick={() => move(i, i - 1)} disabled={i === 0} aria-label={`Move ${pl.lastName} up`}>
                    ▲
                  </button>
                  <button className="icon-btn small" onClick={() => move(i, i + 1)} disabled={i === order.length - 1} aria-label={`Move ${pl.lastName} down`}>
                    ▼
                  </button>
                </span>
              </li>
            );
          })}
        </ol>
        <p className="small muted">
          {order.length} hitters selected · DH active. Changing the order never changes where a player defends.
        </p>
      </section>

      <aside className="panel pm-hitter">
        <header className="panel-head">
          <h2>Selected hitter</h2>
        </header>
        <div className="hitter-card">
          <Avatar player={p} club={s.clubs[p.clubId]} size={96} />
          <div>
            <strong className="hitter-name">{playerName(p)}</strong>
            <span className="muted">
              {sel.position} · Bats {p.bats} · OVR {overall(p)}
            </span>
            <Values vals={hitterValues(s, p, mode, period, 'order')} />
          </div>
        </div>
        <div className="hitter-status">
          <FitnessMeter value={p.fitness} showLabel />
          <HappinessMeter value={p.satisfaction} />
          <Notes notes={playerNotes(s, p, { starting: true })} max={3} />
        </div>
        <div className="hitter-spot">
          <Icon name="bat" size={22} />
          <div>
            <strong>Batting {ordinalWord(selected + 1)}</strong>
            <p>{spotText(selected)}</p>
            <p className="small muted">
              {mode === 'stats'
                ? b.pa > 0
                  ? `${period === 'season' ? 'Season' : 'Last 5 games'}: ${fmtRate(b.obp)} OBP over ${b.pa} PA${b.pa < 15 ? ' (small sample)' : ''}.`
                  : 'No appearances in this period.'
                : `Contact ${p.ratings.contact} · Power ${p.ratings.power} · Speed ${p.ratings.speed}.`}
            </p>
          </div>
        </div>
        {mode === 'stats' && <Legend keys={['AVG', 'OBP', 'SLG', 'PA']} />}
        <h3 className="subhead">Batting order preview</h3>
        <ol className="order-preview">
          {order.map((slot, i) => (
            <li key={slot.playerId} className={i === selected ? 'on' : ''}>
              <button onClick={() => setSelected(i)} aria-label={`${i + 1}: ${s.players[slot.playerId].lastName}`}>
                <small>{i + 1}</small>
                <Avatar player={s.players[slot.playerId]} club={s.clubs[s.players[slot.playerId].clubId]} size={34} />
              </button>
            </li>
          ))}
        </ol>
        <div className="lineup-actions">
          <button className="btn btn-small btn-secondary" onClick={() => move(selected, selected - 1)} disabled={selected === 0}>
            ↑ Move up
          </button>
          <button className="btn btn-small btn-secondary" onClick={() => move(selected, selected + 1)} disabled={selected === order.length - 1}>
            ↓ Move down
          </button>
        </div>
      </aside>
    </div>
  );
}

const ordinalWord = (n: number) => `${n}${n === 1 ? 'st' : n === 2 ? 'nd' : n === 3 ? 'rd' : 'th'}`;
