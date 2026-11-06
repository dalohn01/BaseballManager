import { BALANCE } from '../../balance/config';
import { modifiers, modifierTotal, teamStatus, type TeamStatus } from '../../domain/effective';
import { moveBatter, setPosition } from '../../domain/lineupDraft';
import { battingStats, fmtRate, type StatsPeriod } from '../../domain/playerStats';
import { overallAt } from '../../domain/ratings';
import type { GameState } from '../../domain/state';
import { playerName, userClub } from '../../domain/state';
import type { LineupPosition, Player } from '../../domain/types';
import { LINEUP_POSITIONS } from '../../domain/types';
import { Icon } from '../components/icons';
import { modifierReasons } from '../components/Modifiers';
import { instructionSummary } from '../tactics/TacticsControls';
import { EffBlock, ModRow } from './LineupParts';
import type { DraftApi } from './PreMatchScreen';
import { Portrait } from './shared';
import { useRowDrag } from './useRowDrag';

/** Value at his position today: OVR there (out of position costs fielding) plus the modifiers. */
function valueAt(state: GameState, p: Player, pos: LineupPosition, status: TeamStatus) {
  const base = overallAt(p, pos);
  const mods = modifiers(state, p, status);
  return { base, mods, effective: base + modifierTotal(mods) };
}

const natural = (p: Player, pos: LineupPosition) => pos === 'DH' || p.positions.includes(pos);
const ORDINAL = ['1st', '2nd', '3rd', '4th', '5th', '6th', '7th', '8th', '9th'];

function batterLine(state: GameState, p: Player, period: StatsPeriod): string {
  const b = battingStats(state, p, period);
  const ops = b.obp !== null && b.slg !== null ? b.obp + b.slg : null;
  return `AVG ${fmtRate(b.avg)} · HR ${b.hr} · RBI ${b.rbi} · OPS ${fmtRate(ops)}`;
}

/**
 * Step one on the phone: the squad's nine hitters in batting order. Drag a
 * row by its handle to move him up or down the order (or use the handle's
 * menu); tap the position badge to change his place, which swaps with whoever
 * had it. There is no bench: every hitter in the squad plays.
 */
export function BattersTab({ api }: { api: DraftApi }) {
  const { state: s, draft, update, period } = api;
  const club = userClub(s);
  const status = teamStatus(s, club.id);
  const order = draft.lineup.battingOrder;
  const { listRef, handle, rowProps } = useRowDrag((from, to) => update(moveBatter(draft, from, to)));

  return (
    <section className="m-lineup" aria-label="Batting order">
      <p className="m-hint small muted">Drag ⋮ to change the batting order. Tap a position to move a player.</p>
      <ol className="m-rows" ref={listRef}>
        {order.map((slot, i) => {
          const p = s.players[slot.playerId];
          if (!p) return null;
          const v = valueAt(s, p, slot.position, status);
          const drag = rowProps(i);
          return (
            <li key={p.id} data-row className={`m-row ${drag.className}`} style={drag.style} aria-label={`Batting ${ORDINAL[i]}: ${playerName(p)}, ${slot.position}`}>
              <span className="m-grip" {...handle(i)} title="Drag to move">
                <Icon name="grip" size={22} strokeWidth={3.5} />
                <MoveMenu index={i} name={p.lastName} onMove={(to) => update(moveBatter(draft, i, to))} />
              </span>
              <span className="m-num">{i + 1}</span>
              <PositionBadge slotIndex={i} player={p} order={order} state={s} onChange={(pos) => update(setPosition(draft, i, pos))} />
              <span className="m-who">
                <Portrait state={s} player={p} size={34} nested />
                <span className="m-id">
                  <strong>
                    {playerName(p)}
                    <button className="pr-instr" onClick={() => api.openTactics(p.id)} title={`Instructions: ${instructionSummary(s, p)}`} aria-label={`Instructions for ${p.lastName}`}>
                      <Icon name="clipboard" size={14} />
                    </button>
                  </strong>
                  <small>
                    Bats {p.bats} · {p.positions.join('/')}
                  </small>
                </span>
              </span>
              <EffBlock base={v.base} eff={v.effective} />
              <span className="m-sub">
                <ModRow mods={v.mods} reasons={modifierReasons(s, p, status)} />
                <small className="m-stats">{batterLine(s, p, period)}</small>
              </span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

/** The defensive position as a badge; choosing another swaps with whoever had it. */
function PositionBadge({ slotIndex, player, order, state, onChange }: { slotIndex: number; player: Player; order: { playerId: string; position: LineupPosition }[]; state: GameState; onChange: (pos: LineupPosition) => void }) {
  const pos = order[slotIndex].position;
  const off = !natural(player, pos);
  return (
    <span className={`m-pos ${off ? 'off' : ''}`} title={off ? `Out of position: fielding −${BALANCE.match.outOfPositionFieldingPenalty}` : 'Position: tap to change'}>
      <span aria-hidden="true">{pos}</span>
      <select aria-label={`Position for ${player.lastName}`} value={pos} onChange={(e) => onChange(e.target.value as LineupPosition)}>
        {LINEUP_POSITIONS.map((p) => {
          const holder = order.find((x, j) => j !== slotIndex && x.position === p);
          return (
            <option key={p} value={p}>
              {p}
              {natural(player, p) ? '' : ' (out of position)'}
              {holder ? ` · swap with ${state.players[holder.playerId]?.lastName ?? '?'}` : ''}
            </option>
          );
        })}
      </select>
    </span>
  );
}

/** The handle's menu: move to another batting spot without dragging (keyboard, screen readers). */
function MoveMenu({ index, name, onMove }: { index: number; name: string; onMove: (to: number) => void }) {
  return (
    <select
      className="m-menu"
      aria-label={`Move ${name} in the batting order`}
      value=""
      onPointerDown={(e) => e.stopPropagation()}
      onChange={(e) => {
        if (e.target.value !== '') onMove(Number(e.target.value));
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
    </select>
  );
}
