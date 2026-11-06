import { BALANCE } from '../../balance/config';
import { effectiveValue, teamStatus } from '../../domain/effective';
import { assignPitcher } from '../../domain/lineupDraft';
import { fmtEra, fmtIp, pitchingStats, type StatsPeriod } from '../../domain/playerStats';
import { playerName } from '../../domain/state';
import type { GameState } from '../../domain/state';
import { userClub } from '../../domain/state';
import { emptyBullpen, PITCHING_SLOTS, RELIEF_SLOTS, SLOT_LABEL, SLOT_SHORT, type PitchingSlot } from '../../domain/todayPitching';
import type { Player } from '../../domain/types';
import { Icon } from '../components/icons';
import { modifierReasons } from '../components/Modifiers';
import { instructionSummary } from '../tactics/TacticsControls';
import { EffBlock, ModRow } from './LineupParts';
import type { DraftApi } from './PreMatchScreen';
import { Portrait } from './shared';
import { useRowDrag } from './useRowDrag';

const P = BALANCE.pitching;
const SLOT_WHEN: Record<PitchingSlot, string> = {
  starter: 'Starts every game.',
  long: `Early (before the ${P.longReliefUntilInning}th) if needed.`,
  middle: `${P.middleFromInning}th–${P.setupFromInning - 1}th inning.`,
  setup: `${P.setupFromInning}th inning.`,
  closer: 'Save situations from the 9th.',
};
const SLOT_ICON = { starter: 'crown', long: 'link', middle: 'forward', setup: 'star', closer: 'flame' } as const;

function pitcherLine(state: GameState, p: Player, period: StatsPeriod): string {
  const st = pitchingStats(state, p, period);
  return `W-L ${st.w}-${st.l} · ERA ${fmtEra(st.era)} · K ${st.so} · IP ${fmtIp(st.outs)}`;
}

/**
 * Step two on the phone: the squad's five pitchers, one per role. The starter
 * is fixed (he starts every game); the four relievers swap roles by dragging
 * a card onto another relief role or by tapping the role badge.
 */
export function PitchersTab({ api }: { api: DraftApi; gameId: string }) {
  const { state: s, draft, update, period } = api;
  const status = teamStatus(s, userClub(s).id);
  const pen = draft.plan.bullpen ?? emptyBullpen();
  const inSlot = (slot: PitchingSlot): Player | null => {
    const id = slot === 'starter' ? draft.lineup.pitcherId : pen[slot];
    return id ? s.players[id] ?? null : null;
  };
  // Index 0 is the starter; only relief rows (1–4) drag and accept a drop.
  const swap = (from: number, to: number) => {
    const p = inSlot(PITCHING_SLOTS[from]);
    if (p) update(assignPitcher(s, draft, PITCHING_SLOTS[to], p.id));
  };
  const { listRef, handle, rowProps } = useRowDrag(swap, (from, to) => from > 0 && to > 0, 'swap');

  return (
    <section className="m-lineup m-pitch" aria-label="Pitching staff">
      <p className="m-hint small muted">The starter starts every game. Drag ⋮ or tap a role to swap two relievers.</p>
      <ol className="m-rows" ref={listRef}>
        {PITCHING_SLOTS.map((slot, i) => {
          const p = inSlot(slot);
          const drag = rowProps(i);
          if (!p) {
            return (
              <li key={slot} data-row className="m-row empty">
                <span className="m-grip" />
                <RoleBadge slot={slot} />
                <span className="m-who muted">No pitcher in this role</span>
              </li>
            );
          }
          const v = effectiveValue(s, p, slot === 'starter' ? 'SP' : 'RP', status);
          const relief = slot !== 'starter';
          return (
            <li key={slot} data-row className={`m-row slot-${slot} ${drag.className}`} style={drag.style} aria-label={`${SLOT_LABEL[slot]}: ${playerName(p)}`}>
              {relief ? (
                <span className="m-grip" {...handle(i)} title="Drag onto another relief role">
                  <Icon name="grip" size={22} strokeWidth={3.5} />
                </span>
              ) : (
                <span className="m-grip fixed" title="The starter is fixed">
                  <Icon name="lock" size={16} />
                </span>
              )}
              {relief ? <RoleSelect slot={slot} state={s} inSlot={inSlot} onChange={(to) => update(assignPitcher(s, draft, to, p.id))} /> : <RoleBadge slot={slot} />}
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
                    Throws {p.throws} · {SLOT_WHEN[slot]}
                  </small>
                </span>
              </span>
              <EffBlock base={v.ovr} eff={v.effective} />
              <span className="m-sub">
                <ModRow mods={v.mods} reasons={modifierReasons(s, p, status)} />
                <small className="m-stats">{pitcherLine(s, p, period)}</small>
              </span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function RoleBadge({ slot }: { slot: PitchingSlot }) {
  return (
    <span className={`m-pos role-badge role-${slot}`} title={`${SLOT_LABEL[slot]}: ${SLOT_WHEN[slot]}`}>
      <Icon name={SLOT_ICON[slot]} size={12} />
      <span aria-hidden="true">{SLOT_SHORT[slot]}</span>
      <span className="sr-only">{SLOT_LABEL[slot]}</span>
    </span>
  );
}

/** A reliever's role badge; choosing another relief role swaps with whoever has it. */
function RoleSelect({ slot, state, inSlot, onChange }: { slot: PitchingSlot; state: GameState; inSlot: (s: PitchingSlot) => Player | null; onChange: (to: PitchingSlot) => void }) {
  const me = inSlot(slot);
  return (
    <span className={`m-pos role-badge role-${slot}`} title={`${SLOT_LABEL[slot]}: ${SLOT_WHEN[slot]} Tap to change.`}>
      <Icon name={SLOT_ICON[slot]} size={12} />
      <span aria-hidden="true">{SLOT_SHORT[slot]}</span>
      <select aria-label={`Role for ${me?.lastName ?? ''}`} value={slot} onChange={(e) => onChange(e.target.value as PitchingSlot)}>
        {RELIEF_SLOTS.map((r) => {
          const holder = r === slot ? null : inSlot(r);
          return (
            <option key={r} value={r}>
              {SLOT_LABEL[r]}
              {holder ? ` · swap with ${state.players[holder.id]?.lastName}` : ''}
            </option>
          );
        })}
      </select>
    </span>
  );
}
