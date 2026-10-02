import { pitcherPosition } from '../../domain/pitching';
import type { ReactNode } from 'react';
import { fitnessLabel } from '../../domain/mood';
import { fmtIp, pitcherWorkload } from '../../domain/playerStats';
import { overall } from '../../domain/ratings';
import { playerName } from '../../domain/state';
import type { GameState } from '../../domain/state';
import type { Player } from '../../domain/types';
import { BALANCE } from '../../balance/config';
import { HappinessMeter, Portrait } from './shared';

/*
 * One pitcher on one compact row, shared by Today's starter, the role picker
 * and Rest today. Hierarchy: portrait and name, PIT (strongest), OVR,
 * condition; then morale and role; last outing and throws are quieter.
 */

export function lastOuting(state: GameState, p: Player): { when: string; detail: string } | null {
  const w = pitcherWorkload(state, p);
  if (!w.last) return null;
  const when = w.last.gamesAgo === 1 ? 'last game' : `${w.last.gamesAgo} games ago`;
  return { when, detail: `${fmtIp(w.last.outs)} IP, ${w.last.battersFaced} batters${w.last.started ? ' (start)' : ''}` };
}

/** Condition: a small bar in the status colour, the percentage and Fresh/Ready/Tired/Exhausted. */
export function Condition({ value }: { value: number }) {
  const f = BALANCE.fitness;
  const tone = value < f.needsRestBelow ? 'bad' : value < f.warnBelow ? 'warn' : 'good';
  return (
    <span className={`cond cond-${tone}`} title={`Condition ${value}%`}>
      <span className="cond-top">
        <span className="cond-bar" aria-hidden="true">
          <span style={{ width: `${Math.max(4, value)}%` }} />
        </span>
        <strong>{value}%</strong>
      </span>
      <small>{fitnessLabel(value)}</small>
    </span>
  );
}

export interface PitcherRowProps {
  state: GameState;
  player: Player;
  /** Rotation position or bullpen role, e.g. "Rotation #1" or "Closer". */
  role?: string;
  /** A short availability line (e.g. "Pitched yesterday") shown with the role. */
  readiness?: string;
  selected?: boolean;
  resting?: boolean;
  disabled?: boolean;
  /** Replaces "last outing" (e.g. season stats in the Stats view). */
  detail?: ReactNode;
  /** Small extra next to the name (e.g. an instructions button). */
  extra?: ReactNode;
  action?: ReactNode;
  showMorale?: boolean;
}

export function PitcherRow({ state, player: p, role, readiness, selected, resting, disabled, detail, extra, action, showMorale = true }: PitcherRowProps) {
  const out = lastOuting(state, p);
  return (
    <li className={`p-row ${selected ? 'selected' : ''} ${resting ? 'resting' : ''} ${disabled ? 'disabled' : ''}`}>
      <span className="pr-portrait">
        <Portrait state={state} player={p} size={48} nested />
      </span>
      <span className="pr-name">
        <strong>
          <span className={`pos-chip pos-${pitcherPosition(p).toLowerCase()}`} title={pitcherPosition(p) === 'SP' ? 'Starting pitcher: stamina to go deep' : 'Relief pitcher: short outings'}>
            {pitcherPosition(p)}
          </span>
          {playerName(p)} {extra}
        </strong>
        <small>
          {role && <span className="pr-role">{role}</span>}
          {readiness && <span className="pr-ready"> · {readiness}</span>}
          <span className="pr-throws"> · Throws {p.throws}</span>
        </small>
      </span>
      <span className="pr-pit" title="Overall">
        <small>OVR</small>
        <strong>{overall(p)}</strong>
      </span>
      <span className="pr-ovr pr-trio" title="Velocity · Control · Stamina">
        <span>
          <small>VEL</small>
          <b>{p.ratings.velocity}</b>
        </span>
        <span>
          <small>CTL</small>
          <b>{p.ratings.control}</b>
        </span>
        <span>
          <small>STA</small>
          <b>{p.ratings.stamina}</b>
        </span>
      </span>
      <span className="pr-cond">
        <Condition value={p.fitness} />
      </span>
      {showMorale && (
        <span className="pr-morale">
          <HappinessMeter value={p.satisfaction} />
        </span>
      )}
      <span className="pr-last">
        {detail ?? (out ? (
          <>
            <small>Last outing: {out.when}</small>
            <small className="muted">{out.detail}</small>
          </>
        ) : (
          <small className="muted">No outings yet</small>
        ))}
      </span>
      <span className="pr-action">{action}</span>
    </li>
  );
}
