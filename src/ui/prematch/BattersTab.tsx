import { useEffect, useRef, useState, type DragEvent } from 'react';
import { MODIFIER_KEYS, MODIFIER_LABEL, modifiers, modifierTotal, teamStatus, type TeamStatus } from '../../domain/effective';
import { benchBatter, moveBatter, openSpot, setPosition, swapFromBench } from '../../domain/lineupDraft';
import { battingStats, fmtRate, playerNotes, type StatsPeriod } from '../../domain/playerStats';
import { overall, overallAt } from '../../domain/ratings';
import type { GameState } from '../../domain/state';
import { playerName, userClub } from '../../domain/state';
import type { LineupPosition, Player } from '../../domain/types';
import { LINEUP_POSITIONS } from '../../domain/types';
import { BALANCE } from '../../balance/config';
import { Icon } from '../components/icons';
import { ModChips, modifierReasons } from '../components/Modifiers';
import { instructionSummary } from '../tactics/TacticsControls';
import { ChangeButton, EffBlock, ModBox, ModColumns, modIcon, PlayerIdent, StatBlock } from './LineupParts';
import type { DraftApi } from './PreMatchScreen';
import { Notes, Portrait } from './shared';

/** Value at a position today: OVR there (out of position costs fielding) plus the four modifiers. */
function valueAt(state: GameState, p: Player, pos: LineupPosition | null, status: TeamStatus) {
  const base = pos ? overallAt(p, pos) : overall(p);
  const mods = modifiers(state, p, status);
  return { base, mods, effective: base + modifierTotal(mods) };
}

const natural = (p: Player, pos: LineupPosition) => pos === 'DH' || p.positions.includes(pos);
const ORDINAL = ['1st', '2nd', '3rd', '4th', '5th', '6th', '7th', '8th', '9th'];

function batterStats(state: GameState, p: Player, period: StatsPeriod): [string, string][] {
  const b = battingStats(state, p, period);
  const ops = b.obp !== null && b.slg !== null ? b.obp + b.slg : null;
  return [
    ['AVG', fmtRate(b.avg)],
    ['HR', String(b.hr)],
    ['RBI', String(b.rbi)],
    ['OPS', fmtRate(ops)],
  ];
}

type Drag = { kind: 'row'; index: number } | { kind: 'bench'; id: string } | null;
type Mark = { index: number; mode: 'before' | 'after' | 'replace' } | null;

/**
 * Batters / Fielders for today's game, in the same system as the Pitchers
 * view: the nine in batting order (spot, defensive position, player,
 * Effective, the four modifiers and vertical batting stats) and the bench as
 * a compact comparison. Drag a row up or down to change the batting order;
 * drag a bench player onto a row to bring him in, or a row onto the bench to
 * open that spot. Positions change with their badge (whoever had the
 * position takes the old one, so the defense stays valid).
 */
export function BattersTab({ api }: { api: DraftApi }) {
  const { state: s, draft, update, period } = api;
  const club = userClub(s);
  const status = teamStatus(s, club.id);
  const order = draft.lineup.battingOrder;
  const playing = new Set(order.map((x) => x.playerId).filter(Boolean));
  const bench = club.roster
    .map((id) => s.players[id])
    .filter((p) => !p.isPitcher && !playing.has(p.id))
    .map((p) => ({ p, v: valueAt(s, p, null, status) }))
    .sort((a, b) => b.v.effective - a.v.effective || a.p.id.localeCompare(b.p.id));
  const [drag, setDrag] = useState<Drag>(null);
  const [mark, setMark] = useState<Mark>(null);
  const [overBench, setOverBench] = useState(false);
  const [picking, setPicking] = useState<number | null>(null);
  const open = openSpot(draft);

  const endDrag = () => {
    setDrag(null);
    setMark(null);
    setOverBench(false);
  };
  const rowDragOver = (index: number) => (e: DragEvent<HTMLLIElement>) => {
    if (!drag) return;
    e.preventDefault();
    e.stopPropagation();
    if (drag.kind === 'bench') {
      if (mark?.index !== index || mark.mode !== 'replace') setMark({ index, mode: 'replace' });
      return;
    }
    const r = e.currentTarget.getBoundingClientRect();
    const mode = e.clientY < r.top + r.height / 2 ? 'before' : 'after';
    if (mark?.index !== index || mark.mode !== mode) setMark({ index, mode });
  };
  const rowDrop = (index: number) => (e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (drag?.kind === 'bench') update(swapFromBench(draft, index, drag.id));
    else if (drag?.kind === 'row' && mark) {
      // Insert before or after the target row; the rows in between shift.
      const insert = mark.mode === 'after' ? index + 1 : index;
      const to = drag.index < insert ? insert - 1 : insert;
      if (to !== drag.index) update(moveBatter(draft, drag.index, to));
    }
    endDrag();
  };
  const lineupDrop = (e: DragEvent) => {
    e.preventDefault();
    if (drag?.kind === 'bench' && open >= 0) update(swapFromBench(draft, open, drag.id));
    endDrag();
  };
  const benchDrop = (e: DragEvent) => {
    e.preventDefault();
    if (drag?.kind === 'row') update(benchBatter(draft, drag.index));
    endDrag();
  };
  const reasons = (p: Player) => modifierReasons(s, p, status);

  return (
    <div className="pitch-v4 bat-view">
      <section
        className="panel ps-staff"
        onDragOver={(e) => {
          if (drag?.kind === 'bench' && open >= 0) e.preventDefault();
        }}
        onDrop={lineupDrop}
      >
        <header className="panel-head">
          <h2>Starting lineup</h2>
          <small className="muted">Drag a row to change the batting order, or bring a player in from the bench. Click a position to change it.</small>
        </header>
        <ol className="ps-rows">
          {order.map((slot, i) => {
            const p = slot.playerId ? s.players[slot.playerId] : null;
            const v = p ? valueAt(s, p, slot.position, status) : null;
            const marked = mark?.index === i ? `mark-${mark.mode}` : '';
            return (
              <li
                key={`${i}-${slot.playerId}`}
                className={`ps-row bat-row ${p ? '' : 'empty'} ${marked} ${drag?.kind === 'row' && drag.index === i ? 'dragging' : ''}`}
                draggable={!!p}
                onDragStart={(e) => {
                  e.dataTransfer.setData('text/plain', slot.playerId);
                  e.dataTransfer.effectAllowed = 'move';
                  setDrag({ kind: 'row', index: i });
                }}
                onDragEnd={endDrag}
                onDragOver={rowDragOver(i)}
                onDragLeave={() => setMark(null)}
                onDrop={rowDrop(i)}
                aria-label={`Batting ${ORDINAL[i]}: ${slot.position}${p ? `, ${playerName(p)}` : ', open'}`}
              >
                <span className="br-grip" title="Drag to move">
                  <Icon name="grip" size={20} strokeWidth={3.5} />
                  {p && <MoveMenu index={i} name={p.lastName} onMove={(to) => update(to === 'bench' ? benchBatter(draft, i) : moveBatter(draft, i, to))} />}
                </span>
                <span className="pr-num">{i + 1}</span>
                <PositionBadge slotIndex={i} player={p} draftOrder={order} state={s} onChange={(pos) => update(setPosition(draft, i, pos))} />
                {p && v ? (
                  <>
                    <span className="pr-player">
                      <PlayerIdent
                        state={s}
                        player={p}
                        sub={`#${p.number} · Bats ${p.bats} · ${p.positions.join('/')}`}
                        badge={<Notes notes={playerNotes(s, p, { starting: true })} max={1} />}
                        extra={
                          <button className="pr-instr" onClick={() => api.openTactics(p.id)} title={`Instructions: ${instructionSummary(s, p)}`} aria-label={`Instructions for ${p.lastName}`}>
                            <Icon name="clipboard" size={14} />
                          </button>
                        }
                      />
                    </span>
                    <EffBlock base={v.base} eff={v.effective} label />
                    <ModColumns mods={v.mods} reasons={reasons(p)} />
                    <StatBlock stats={batterStats(s, p, period)} />
                    <ChangeButton label={`Change the ${ORDINAL[i]} batter (${p.lastName})`} onClick={() => setPicking(i)} />
                  </>
                ) : (
                  <button className="rc-assign pr-empty" onClick={() => setPicking(i)}>
                    + Bring in a player
                  </button>
                )}
              </li>
            );
          })}
        </ol>
      </section>

      <section
        className={`panel ps-bench ${overBench ? 'drop' : ''}`}
        onDragOver={(e) => {
          if (drag?.kind !== 'row') return;
          e.preventDefault();
          if (!overBench) setOverBench(true);
        }}
        onDragLeave={() => setOverBench(false)}
        onDrop={benchDrop}
      >
        <header className="panel-head">
          <h2>Bench</h2>
          <small className="muted">Drag a player onto a lineup spot, or use the ⋮ handle. Drop a starter here to take him out.</small>
        </header>
        {bench.length === 0 ? (
          <p className="small muted ps-none">Everyone is in the lineup.</p>
        ) : (
          <div className="ps-table-wrap">
            <table className="ps-table bat-table">
              <thead>
                <tr>
                  <th scope="col">
                    <span className="sr-only">Move</span>
                  </th>
                  <th scope="col">
                    <span className="sr-only">Player</span>
                  </th>
                  <th scope="col" title="Effective today at his main position">
                    EFF
                  </th>
                  {MODIFIER_KEYS.map((k) => (
                    <th scope="col" key={k} className="mod-th">
                      {modIcon(k, 1)}
                      <small>{MODIFIER_LABEL[k]}</small>
                    </th>
                  ))}
                  <th scope="col">AVG</th>
                  <th scope="col">OPS</th>
                </tr>
              </thead>
              <tbody>
                {bench.map(({ p, v }) => {
                  const why = reasons(p);
                  const st = Object.fromEntries(batterStats(s, p, period));
                  return (
                    <tr
                      key={p.id}
                      draggable
                      onDragStart={(e) => {
                        e.dataTransfer.setData('text/plain', p.id);
                        e.dataTransfer.effectAllowed = 'move';
                        setDrag({ kind: 'bench', id: p.id });
                      }}
                      onDragEnd={endDrag}
                    >
                      <td className="ps-grip">
                        <Icon name="grip" size={20} strokeWidth={3.5} />
                        <PutIn state={s} player={p} order={order} onPut={(i) => update(swapFromBench(draft, i, p.id))} />
                      </td>
                      <th scope="row">
                        <span className="ps-bench-name">
                          <Portrait state={s} player={p} size={40} nested />
                          <span className="pr-id">
                            <strong title={playerName(p)}>
                              {p.firstName} {p.lastName}
                            </strong>
                            <small>
                              {p.positions.join('/')} · Bats {p.bats}
                            </small>
                            <Notes notes={playerNotes(s, p, { starting: false })} max={1} />
                          </span>
                        </span>
                      </th>
                      <td className="num" data-label="EFF">
                        <EffBlock base={v.base} eff={v.effective} />
                      </td>
                      {MODIFIER_KEYS.map((k) => (
                        <td key={k} className="mod-td" data-label={MODIFIER_LABEL[k]}>
                          <ModBox value={v.mods[k]} title={`${MODIFIER_LABEL[k]}: ${why[k]}`} />
                        </td>
                      ))}
                      <td className="num stat" data-label="AVG">
                        {st.AVG}
                      </td>
                      <td className="num stat" data-label="OPS">
                        {st.OPS}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {picking !== null && order[picking] && (
        <BenchPicker
          state={s}
          status={status}
          index={picking}
          position={order[picking].position}
          current={order[picking].playerId ? s.players[order[picking].playerId] : null}
          bench={bench.map((b) => b.p)}
          onPick={(id) => {
            update(swapFromBench(draft, picking, id));
            setPicking(null);
          }}
          onBench={() => {
            update(benchBatter(draft, picking));
            setPicking(null);
          }}
          onClose={() => setPicking(null)}
        />
      )}
    </div>
  );
}

/** The defensive position as a badge; choosing another swaps with whoever had it. */
function PositionBadge({ slotIndex, player, draftOrder, state, onChange }: { slotIndex: number; player: Player | null; draftOrder: { playerId: string; position: LineupPosition }[]; state: GameState; onChange: (pos: LineupPosition) => void }) {
  const pos = draftOrder[slotIndex].position;
  const off = player && !natural(player, pos);
  return (
    <span className={`br-pos ${off ? 'off' : ''}`} title={off ? `Out of position: fielding −${BALANCE.match.outOfPositionFieldingPenalty}` : 'Defensive position'}>
      <span aria-hidden="true">{pos}</span>
      <select
        aria-label={`Position for the ${ORDINAL[slotIndex]} batter${player ? ` (${player.lastName})` : ''}`}
        value={pos}
        onChange={(e) => onChange(e.target.value as LineupPosition)}
      >
        {LINEUP_POSITIONS.map((p) => {
          const holder = draftOrder.find((x, j) => j !== slotIndex && x.position === p);
          const holderName = holder?.playerId ? state.players[holder.playerId]?.lastName : null;
          return (
            <option key={p} value={p}>
              {p}
              {player && !natural(player, p) ? ' (out of position)' : ''}
              {holder ? ` · swap with ${holderName ?? 'open spot'}` : ''}
            </option>
          );
        })}
      </select>
    </span>
  );
}

/** The row handle as a menu: move to another batting spot or to the bench without dragging. */
function MoveMenu({ index, name, onMove }: { index: number; name: string; onMove: (to: number | 'bench') => void }) {
  return (
    <select
      className="ps-use"
      aria-label={`Move ${name}`}
      value=""
      onChange={(e) => {
        const v = e.target.value;
        if (v) onMove(v === 'bench' ? 'bench' : Number(v));
      }}
    >
      <option value="">Move {name}…</option>
      {ORDINAL.map((o, i) =>
        i === index ? null : (
          <option key={o} value={i}>
            Bat {o}
          </option>
        ),
      )}
      <option value="bench">To the bench</option>
    </select>
  );
}

/** The bench row handle as a menu: put him in for a lineup spot (he takes that spot's position). */
function PutIn({ state, player, order, onPut }: { state: GameState; player: Player; order: { playerId: string; position: LineupPosition }[]; onPut: (index: number) => void }) {
  return (
    <select
      className="ps-use"
      aria-label={`Put ${player.lastName} in`}
      value=""
      onChange={(e) => {
        if (e.target.value !== '') onPut(Number(e.target.value));
      }}
    >
      <option value="">Put {player.lastName} in for…</option>
      {order.map((slot, i) => (
        <option key={i} value={i}>
          {i + 1} · {slot.position} · {slot.playerId ? state.players[slot.playerId]?.lastName : 'open'}
          {natural(player, slot.position) ? '' : ' (out of position)'}
        </option>
      ))}
    </select>
  );
}

/** Choose who bats in a spot: bench players by effective value at that spot's position. */
function BenchPicker({
  state,
  status,
  index,
  position,
  current,
  bench,
  onPick,
  onBench,
  onClose,
}: {
  state: GameState;
  status: TeamStatus;
  index: number;
  position: LineupPosition;
  current: Player | null;
  bench: Player[];
  onPick: (id: string) => void;
  onBench: () => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.querySelector<HTMLButtonElement>('.ps-pick-list button')?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  const rows = bench.map((p) => ({ p, v: valueAt(state, p, position, status) })).sort((a, b) => b.v.effective - a.v.effective || a.p.id.localeCompare(b.p.id));
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal role-picker" role="dialog" aria-modal="true" aria-label={`Batting ${ORDINAL[index]}, ${position}`} onClick={(e) => e.stopPropagation()} ref={ref}>
        <header className="rp-head">
          <h2>
            Batting {ORDINAL[index]} · {position}
          </h2>
          <button className="icon-btn small" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </header>
        <p className="small muted">
          Values are at {position}{position === 'DH' ? '' : ` (out of position costs ${BALANCE.match.outOfPositionFieldingPenalty} fielding)`}. {current ? `${current.lastName} goes to the bench.` : 'The spot is open.'}
        </p>
        {rows.length === 0 ? (
          <p className="muted">Nobody on the bench.</p>
        ) : (
          <ul className="ps-pick-list">
            {rows.map(({ p, v }) => (
              <li key={p.id}>
                <Portrait state={state} player={p} size={40} nested />
                <span className="pr-id">
                  <strong>{playerName(p)}</strong>
                  <small>
                    {p.positions.join('/')} · Bats {p.bats}
                    {natural(p, position) ? '' : ' · out of position'}
                  </small>
                </span>
                <EffBlock base={v.base} eff={v.effective} />
                <ModChips mods={v.mods} reasons={modifierReasons(state, p, status)} compact />
                <button className="btn btn-small btn-secondary" onClick={() => onPick(p.id)}>
                  Select
                </button>
              </li>
            ))}
          </ul>
        )}
        {current && (
          <button className="link" onClick={onBench}>
            Take {current.lastName} out (leave the spot open)
          </button>
        )}
      </div>
    </div>
  );
}
