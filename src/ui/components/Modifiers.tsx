import { BALANCE } from '../../balance/config';
import { FORM_LABEL, formModifier, MODIFIER_KEYS, MODIFIER_LABEL, pepTalkBoost, restText, teamStatus, type ModifierKey, type Modifiers, type TeamStatus } from '../../domain/effective';
import type { GameState } from '../../domain/state';
import { userClub } from '../../domain/state';
import type { Player } from '../../domain/types';
import { ActionConfirm } from './ActionConfirm';

/*
 * The four modifiers behind a player's effective value, as small signed chips
 * (label + value, the tone is never the only signal), and the squad's Team
 * status with what drives it.
 */

export const signed = (v: number) => (v > 0 ? `+${v}` : v < 0 ? `−${Math.abs(v)}` : '0');
const tone = (v: number) => (v > 0 ? 'pos' : v < 0 ? 'neg' : 'zero');

const SHORT: Record<ModifierKey, string> = { fitness: 'FIT', morale: 'MOR', team: 'TEAM', form: 'FORM' };

/** Why each modifier is what it is, for tooltips and screen readers. */
export function modifierReasons(state: GameState, p: Player, status: TeamStatus = teamStatus(state, p.clubId)): Record<ModifierKey, string> {
  const pep = pepTalkBoost(state, p);
  return {
    fitness: p.isPitcher ? `Rest: ${restText(p)}` : `Fitness ${p.fitness}%`,
    morale: `Happiness ${Math.round(p.satisfaction)}`,
    team: `Squad ${signed(status.base)}${status.boost ? `, tactics session ${signed(status.boost)}` : ''}${pep ? `, pep talk ${signed(pep)}` : ''}`,
    form: FORM_LABEL[formModifier(p)],
  };
}

export function ModChip({ k, value, reason, compact }: { k: ModifierKey; value: number; reason?: string; compact?: boolean }) {
  return (
    <span className={`mod-chip mod-${tone(value)} ${compact ? 'compact' : ''}`} title={`${MODIFIER_LABEL[k]} ${signed(value)}${reason ? ` · ${reason}` : ''}`}>
      <small>{SHORT[k]}</small>
      <b>{signed(value)}</b>
      <span className="sr-only">
        {MODIFIER_LABEL[k]} {signed(value)}
        {reason ? `, ${reason}` : ''}
      </span>
    </span>
  );
}

export function ModChips({ mods, reasons, compact }: { mods: Modifiers; reasons?: Record<ModifierKey, string>; compact?: boolean }) {
  return (
    <span className="mod-chips">
      {MODIFIER_KEYS.map((k) => (
        <ModChip key={k} k={k} value={mods[k]} reason={reasons?.[k]} compact={compact} />
      ))}
    </span>
  );
}

/** OVR → EFF: the base and today's value side by side. */
export function EffValue({ ovr, eff, big }: { ovr: number; eff: number; big?: boolean }) {
  const d = eff - ovr;
  return (
    <span className={`eff-value ${big ? 'big' : ''}`} title={`OVR ${ovr}, effective today ${eff} (${signed(d)})`}>
      <span className="ev-ovr">
        <small>OVR</small>
        <b>{ovr}</b>
      </span>
      <span className={`ev-eff ev-${tone(d)}`}>
        <small>EFF</small>
        <b>{eff}</b>
      </span>
    </span>
  );
}

const PART_LABEL = { morale: 'Squad morale', form: 'Hot & cold players', fans: 'Fans' } as const;

/** The squad's Team modifier: level, what drives it, and the tactics session that lifts it. */
export function TeamStatusBar({ state }: { state: GameState }) {
  const club = userClub(state);
  const t = teamStatus(state, club.id);
  const w = BALANCE.modifiers.team.weights;
  return (
    <aside className="team-status" aria-label="Team status">
      <div className="ts-main">
        <span className={`ts-level mod-${tone(t.level)}`}>
          <small>Team</small>
          <b>{signed(t.level)}</b>
        </span>
        <span className="ts-text">
          <strong>Team status</strong>
          <small className="muted">Added to every player's effective value today.</small>
        </span>
      </div>
      <ul className="ts-parts">
        {(Object.keys(PART_LABEL) as (keyof typeof PART_LABEL)[]).map((k) => (
          <li key={k} title={`${PART_LABEL[k]}: ${t.parts[k].toFixed(1)} on a −2..+2 scale, weight ${Math.round(w[k] * 100)}%`}>
            <span>{PART_LABEL[k]}</span>
            <span className="ts-bar" aria-hidden="true">
              <span className={t.parts[k] >= 0 ? 'up' : 'down'} style={{ width: `${(Math.abs(t.parts[k]) / 2) * 50}%` }} />
            </span>
            <small>
              {k === 'morale' ? `avg ${Math.round(t.avgSatisfaction)}` : k === 'form' ? `${t.hot} hot · ${t.cold} cold` : `support ${Math.round(club.fanSupport)}`}
            </small>
          </li>
        ))}
        {t.boost > 0 && (
          <li className="ts-boost">
            <span>Tactics session</span>
            <b>{signed(t.boost)}</b>
            <small>next game</small>
          </li>
        )}
      </ul>
      <ActionConfirm kind="tacticsSession" compact />
    </aside>
  );
}
