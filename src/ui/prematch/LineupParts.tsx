import type { ReactNode } from 'react';
import { MODIFIER_KEYS, MODIFIER_LABEL, type ModifierKey, type Modifiers } from '../../domain/effective';
import type { GameState } from '../../domain/state';
import type { Player } from '../../domain/types';
import { Icon } from '../components/icons';
import { signed } from '../components/Modifiers';
import { Portrait } from './shared';

/*
 * The pieces of a selected-player row, shared by the Batters and Pitchers
 * views so both read as one lineup system: the player, Effective with the sum
 * of today's modifiers, the four modifiers, a vertical stats block and a quiet
 * change action. Only the data differs (batting spot and position for
 * hitters, role for pitchers; batting or pitching stats).
 */

export const tone = (v: number) => (v > 0 ? 'pos' : v < 0 ? 'neg' : 'zero');

export function modIcon(k: ModifierKey, value: number) {
  if (k === 'fitness') return <Icon name="shoe" size={18} />;
  if (k === 'morale') return <Icon name="smile" size={18} />;
  if (k === 'team') return <Icon name="fans" size={18} />;
  return <Icon name={value > 0 ? 'flame' : value < 0 ? 'snow' : 'smile'} size={18} className={`form-icon form-${tone(value)}`} />;
}

/** A modifier value in a coloured box; the sign is always written out. */
export const ModBox = ({ value, title }: { value: number; title?: string }) => (
  <span className={`mod-box mod-${tone(value)}`} title={title}>
    {signed(value)}
  </span>
);

/** Effective with the sum of the modifiers under it (base + sum = Effective). */
export function EffBlock({ base, eff, label }: { base: number; eff: number; label?: boolean }) {
  return (
    <span className="eff-block" title={`Base ${base} ${signed(eff - base)} from today's modifiers = Effective ${eff}`}>
      {label && <small>Effective</small>}
      <strong>{eff}</strong>
      <ModBox value={eff - base} />
    </span>
  );
}

/** The four modifiers as labelled columns: icon, name, value. */
export function ModColumns({ mods, reasons }: { mods: Modifiers; reasons: Record<ModifierKey, string> }) {
  return (
    <span className="pr-mods">
      {MODIFIER_KEYS.map((k) => (
        <span key={k} className={`pr-mod pm-${tone(mods[k])}`} title={`${MODIFIER_LABEL[k]} ${signed(mods[k])} · ${reasons[k]}`}>
          {modIcon(k, mods[k])}
          <small>{MODIFIER_LABEL[k]}</small>
          <ModBox value={mods[k]} />
          <span className="sr-only">{reasons[k]}</span>
        </span>
      ))}
    </span>
  );
}

/** Stats as label/value pairs stacked vertically (W-L, ERA, K, IP or AVG, HR, RBI, OPS). */
export function StatBlock({ stats }: { stats: [string, string][] }) {
  return (
    <dl className="pr-stats">
      {stats.map(([k, v]) => (
        <div key={k} className="pr-stat">
          <dt>{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Portrait, full name, a short identity line and an optional badge. */
export function PlayerIdent({ state, player, sub, badge, extra, size = 44 }: { state: GameState; player: Player; sub: ReactNode; badge?: ReactNode; extra?: ReactNode; size?: number }) {
  return (
    <>
      <Portrait state={state} player={player} size={size} nested />
      <span className="pr-id">
        <strong title={`${player.firstName} ${player.lastName}`}>
          {player.firstName} {player.lastName}
          {extra}
        </strong>
        <small>{sub}</small>
        {badge}
      </span>
    </>
  );
}

/** The quiet change action at the end of a selected row. */
export function ChangeButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button className="pr-swap" onClick={onClick} aria-label={label} title="Change player">
      <Icon name="swap" size={20} />
    </button>
  );
}
