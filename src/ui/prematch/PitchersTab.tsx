import { useEffect, useRef, useState, type DragEvent } from 'react';
import { BALANCE } from '../../balance/config';
import { effectiveValue, MODIFIER_KEYS, MODIFIER_LABEL, teamStatus, type TeamStatus } from '../../domain/effective';
import { assignPitcher, benchPitcher, pitcherSlot, setHook } from '../../domain/lineupDraft';
import { pitcherPosition } from '../../domain/pitching';
import { fmtEra, fmtIp, pitchingStats, type StatsPeriod } from '../../domain/playerStats';
import { playerName, userClub } from '../../domain/state';
import type { GameState } from '../../domain/state';
import { canPitchIn, emptyBullpen, PITCHING_SLOTS, SLOT_LABEL, type PitchingSlot } from '../../domain/todayPitching';
import type { PitchingHook, Player } from '../../domain/types';
import { Icon } from '../components/icons';
import { EffValue, ModChips, modifierReasons } from '../components/Modifiers';
import { ChangeButton, EffBlock, ModBox, ModColumns, modIcon, PlayerIdent, StatBlock } from './LineupParts';
import { instructionSummary } from '../tactics/TacticsControls';
import type { DraftApi } from './PreMatchScreen';
import { Portrait } from './shared';

const HOOK_TEXT: Record<PitchingHook, string> = {
  early: 'Early',
  balanced: 'Balanced',
  long: 'Let him pitch',
};

const P = BALANCE.pitching;
const SLOT_WHEN: Record<PitchingSlot, string> = {
  starter: 'Starts the game.',
  long: `Early (before the ${P.longReliefUntilInning}th) if needed.`,
  setup: `${P.setupFromInning}th–8th inning.`,
  closer: 'Save situations from the 9th.',
};
const SLOT_ICON = { starter: 'crown', long: 'link', setup: 'star', closer: 'flame' } as const;
const ROLE_NAME: Record<PitchingSlot, string> = { starter: 'Starting', long: 'Long relief', setup: 'Setup', closer: 'Closer' };

/** A pitcher's value in a slot: as the starter (stamina counts) or in relief; on the bench, at his own position. */
const jobOf = (slot: PitchingSlot | null, p: Player) => (slot === 'starter' ? 'SP' : slot ? 'RP' : pitcherPosition(p));
const positionWord = (p: Player) => (pitcherPosition(p) === 'SP' ? 'Starter' : 'Reliever');

/** W-L, ERA, K and IP for the chosen period. */
function statLine(state: GameState, p: Player, period: StatsPeriod) {
  const st = pitchingStats(state, p, period);
  return { wl: `${st.w}-${st.l}`, era: fmtEra(st.era), k: String(st.so), ip: fmtIp(st.outs) };
}
const statPairs = (st: ReturnType<typeof statLine>): [string, string][] => [
  ['W-L', st.wl],
  ['ERA', st.era],
  ['K', st.k],
  ['IP', st.ip],
];

/**
 * Set your pitching staff for today's game: the starter and three relief
 * slots (Long relief, Setup, Closer) as rows with each pitcher's effective
 * value (OVR + Fitness, Morale, Team and Form), and the bench, who rest today.
 * The roles apply to this game only; the strongest setup is preselected.
 * Pitchers move by drag and drop, by the swap button on a row, or by the
 * handle on a bench row.
 */
export function PitchersTab({ api }: { api: DraftApi; gameId: string }) {
  const { state: s, draft, update, period } = api;
  const club = userClub(s);
  const status = teamStatus(s, club.id);
  const pen = draft.plan.bullpen ?? emptyBullpen();
  const all = club.roster.map((id) => s.players[id]).filter((p) => p.isPitcher);
  const inSlot = (slot: PitchingSlot): Player | null => {
    const id = slot === 'starter' ? draft.lineup.pitcherId : pen[slot];
    return id ? s.players[id] ?? null : null;
  };
  const bench = all
    .filter((p) => !pitcherSlot(draft, p.id))
    .map((p) => ({ p, v: effectiveValue(s, p, jobOf(null, p), status) }))
    .sort((a, b) => b.v.effective - a.v.effective || a.p.id.localeCompare(b.p.id));
  const [picking, setPicking] = useState<PitchingSlot | null>(null);
  const [over, setOver] = useState<PitchingSlot | 'bench' | null>(null);
  // Who is being dragged: only roles he may take accept the drop (starters start, relievers relieve).
  const [dragging, setDragging] = useState<Player | null>(null);
  const accepts = (target: PitchingSlot | 'bench', p: Player | null) => !!p && (target === 'bench' ? !!pitcherSlot(draft, p.id) && pitcherSlot(draft, p.id) !== 'starter' : canPitchIn(p, target));

  const drop = (target: PitchingSlot | 'bench') => (e: DragEvent) => {
    e.preventDefault();
    setOver(null);
    setDragging(null);
    const id = e.dataTransfer.getData('text/plain');
    const p = s.players[id];
    if (!p?.isPitcher || !accepts(target, p)) return;
    if (target === 'bench') {
      const from = pitcherSlot(draft, id);
      if (from && from !== 'starter') update(benchPitcher(draft, from));
    } else update(assignPitcher(s, draft, target, id));
  };
  const dragOver = (target: PitchingSlot | 'bench') => (e: DragEvent) => {
    if (dragging && !accepts(target, dragging)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (over !== target) setOver(target);
  };
  const dragStart = (p: Player) => (e: DragEvent) => {
    e.dataTransfer.setData('text/plain', p.id);
    e.dataTransfer.effectAllowed = 'move';
    setDragging(p);
  };
  const dragEnd = () => {
    setDragging(null);
    setOver(null);
  };
  const dropState = (slot: PitchingSlot) => (!dragging ? '' : canPitchIn(dragging, slot) ? 'can-drop' : 'no-drop');
  const reasons = (p: Player) => modifierReasons(s, p, status);
  const hook = BALANCE.match.hooks[draft.plan.hook];

  return (
    <div className="pitch-v4">
      <section className="panel ps-staff">
        <header className="panel-head">
          <h2>Pitching staff</h2>
          <small className="muted">Drag and drop to change pitchers. The roles apply to today's game only.</small>
        </header>
        <ol className="ps-rows">
          {PITCHING_SLOTS.map((slot, i) => {
            const p = inSlot(slot);
            const v = p ? effectiveValue(s, p, jobOf(slot, p), status) : null;
            const st = p ? statLine(s, p, period) : null;
            const why = p ? reasons(p) : null;
            return (
              <li
                key={slot}
                className={`ps-row slot-${slot} ${p ? '' : 'empty'} ${over === slot ? 'drop' : ''} ${dropState(slot)}`}
                onDragOver={dragOver(slot)}
                onDragLeave={() => setOver(null)}
                onDrop={drop(slot)}
                aria-label={`${SLOT_LABEL[slot]}${p ? `: ${playerName(p)}` : ': empty'}`}
              >
                <span className="pr-num">{i + 1}</span>
                <span className="pr-role">
                  <Icon name={SLOT_ICON[slot]} size={26} className={`role-icon role-${slot}`} />
                  <span>
                    <strong>{ROLE_NAME[slot]}</strong>
                    <small>{SLOT_WHEN[slot]}</small>
                  </span>
                </span>
                {p && v && st && why ? (
                  <>
                    <span className="pr-player" draggable onDragStart={dragStart(p)} onDragEnd={dragEnd} title={slot === 'starter' ? 'Drag a starter here from the bench to change' : 'Drag to another relief role or to the bench'}>
                      <PlayerIdent
                        state={s}
                        player={p}
                        sub={`#${p.number} · Throws ${p.throws}`}
                        badge={<span className={`pos-word pos-${pitcherPosition(p).toLowerCase()}`}>{positionWord(p)}</span>}
                        extra={
                          <button className="pr-instr" onClick={() => api.openTactics(p.id)} title={`Instructions: ${instructionSummary(s, p)}`} aria-label={`Instructions for ${p.lastName}`}>
                            <Icon name="clipboard" size={14} />
                          </button>
                        }
                      />
                    </span>
                    <EffBlock base={v.ovr} eff={v.effective} label />
                    <ModColumns mods={v.mods} reasons={why} />
                    <StatBlock stats={statPairs(st)} />
                    <ChangeButton label={`Change ${SLOT_LABEL[slot].toLowerCase()} (${p.lastName})`} onClick={() => setPicking(slot)} />
                  </>
                ) : (
                  <button className="rc-assign pr-empty" onClick={() => setPicking(slot)}>
                    + Assign pitcher
                  </button>
                )}
              </li>
            );
          })}
        </ol>
        <div className="ps-hook">
          <span className="ps-hook-label">Take out the starter</span>
          <div className="segmented" role="group" aria-label="When to replace the starter">
            {(Object.keys(HOOK_TEXT) as PitchingHook[]).map((h) => (
              <button key={h} className={draft.plan.hook === h ? 'on' : ''} aria-pressed={draft.plan.hook === h} onClick={() => update(setHook(draft, h))}>
                {HOOK_TEXT[h]}
              </button>
            ))}
          </div>
          <small className="muted">
            After {hook.maxBatters} batters, or {hook.pullRuns} runs after {hook.minBatters}+ batters.
          </small>
        </div>
      </section>

      <section className={`panel ps-bench ${over === 'bench' ? 'drop' : ''}`} onDragOver={dragOver('bench')} onDragLeave={() => setOver(null)} onDrop={drop('bench')}>
        <header className="panel-head">
          <h2>Rest today (bench)</h2>
          <small className="muted">Drag a pitcher onto a role, or use the ⋮ handle. Pitchers here do not play today and rest one stage.</small>
        </header>
        {bench.length === 0 ? (
          <p className="small muted ps-none">Every pitcher has a role today.</p>
        ) : (
          <div className="ps-table-wrap">
            <table className="ps-table">
              <thead>
                <tr>
                  <th scope="col">
                    <span className="sr-only">Move</span>
                  </th>
                  <th scope="col">
                    <span className="sr-only">Pitcher</span>
                  </th>
                  <th scope="col" title="Overall at his position">
                    PIT
                  </th>
                  <th scope="col" title="Effective today">
                    EFF
                  </th>
                  {MODIFIER_KEYS.map((k) => (
                    <th scope="col" key={k} className="mod-th">
                      {modIcon(k, 1)}
                      <small>{MODIFIER_LABEL[k]}</small>
                    </th>
                  ))}
                  <th scope="col">W-L</th>
                  <th scope="col">ERA</th>
                  <th scope="col">K</th>
                  <th scope="col">IP</th>
                </tr>
              </thead>
              <tbody>
                {bench.map(({ p, v }) => {
                  const st = statLine(s, p, period);
                  const why = reasons(p);
                  return (
                    <tr key={p.id} draggable onDragStart={dragStart(p)} onDragEnd={dragEnd}>
                      <td className="ps-grip">
                        <Icon name="grip" size={20} strokeWidth={3.5} />
                        <UseAs state={s} player={p} inSlot={inSlot} status={status} onUse={(slot) => update(assignPitcher(s, draft, slot, p.id))} />
                      </td>
                      <th scope="row">
                        <span className="ps-bench-name">
                          <Portrait state={s} player={p} size={40} nested />
                          <span className="pr-id">
                            <strong title={playerName(p)}>{playerName(p)}</strong>
                            <small>
                              #{p.number} · Throws {p.throws}
                            </small>
                            <span className={`pos-word pos-${pitcherPosition(p).toLowerCase()}`}>{positionWord(p)}</span>
                          </span>
                        </span>
                      </th>
                      <td className="num" data-label="PIT">
                        {v.ovr}
                      </td>
                      <td className="num" data-label="EFF">
                        <EffBlock base={v.ovr} eff={v.effective} />
                      </td>
                      {MODIFIER_KEYS.map((k) => (
                        <td key={k} className="mod-td" data-label={MODIFIER_LABEL[k]}>
                          <ModBox value={v.mods[k]} title={`${MODIFIER_LABEL[k]}: ${why[k]}`} />
                        </td>
                      ))}
                      <td className="num stat" data-label="W-L">
                        {st.wl}
                      </td>
                      <td className="num stat" data-label="ERA">
                        {st.era}
                      </td>
                      <td className="num stat" data-label="K">
                        {st.k}
                      </td>
                      <td className="num stat" data-label="IP">
                        {st.ip}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {picking && (
        <SlotPicker
          state={s}
          status={status}
          slot={picking}
          pitchers={all.filter((p) => canPitchIn(p, picking))}
          slotOf={(id) => pitcherSlot(draft, id)}
          current={inSlot(picking)?.id ?? null}
          onPick={(id) => {
            update(assignPitcher(s, draft, picking, id));
            setPicking(null);
          }}
          onClear={
            picking === 'starter'
              ? undefined
              : () => {
                  update(benchPitcher(draft, picking as Exclude<PitchingSlot, 'starter'>));
                  setPicking(null);
                }
          }
          onClose={() => setPicking(null)}
        />
      )}
    </div>
  );
}

/**
 * The bench row's handle doubles as a menu: a native select over the grip,
 * so the slot can be picked without dragging (touch, keyboard).
 */
function UseAs({ state, player, inSlot, status, onUse }: { state: GameState; player: Player; inSlot: (slot: PitchingSlot) => Player | null; status: TeamStatus; onUse: (slot: PitchingSlot) => void }) {
  return (
    <select
      className="ps-use"
      aria-label={`Use ${player.lastName} today as`}
      value=""
      onChange={(e) => {
        if (e.target.value) onUse(e.target.value as PitchingSlot);
      }}
    >
      <option value="">Use {player.lastName} as…</option>
      {PITCHING_SLOTS.filter((slot) => canPitchIn(player, slot)).map((slot) => {
        const now = inSlot(slot);
        const v = effectiveValue(state, player, jobOf(slot, player), status).effective;
        return (
          <option key={slot} value={slot}>
            {SLOT_LABEL[slot]} (EFF {v}){now ? `, for ${now.lastName}` : ''}
          </option>
        );
      })}
    </select>
  );
}

/** Choose a pitcher for one role: everyone, by effective value in that job. Picking someone with another role swaps the two. */
function SlotPicker({
  state,
  status,
  slot,
  pitchers,
  slotOf,
  current,
  onPick,
  onClear,
  onClose,
}: {
  state: GameState;
  status: TeamStatus;
  slot: PitchingSlot;
  pitchers: Player[];
  slotOf: (id: string) => PitchingSlot | null;
  current: string | null;
  onPick: (id: string) => void;
  onClear?: () => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.querySelector<HTMLButtonElement>('.ps-pick-list button')?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  const job = slot === 'starter' ? 'SP' : 'RP';
  const rows = pitchers.map((p) => ({ p, v: effectiveValue(state, p, job, status), at: slotOf(p.id) })).sort((a, b) => b.v.effective - a.v.effective || a.p.id.localeCompare(b.p.id));
  const holder = current ? state.players[current] : null;
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal role-picker" role="dialog" aria-modal="true" aria-label={SLOT_LABEL[slot]} onClick={(e) => e.stopPropagation()} ref={ref}>
        <header className="rp-head">
          <h2>{SLOT_LABEL[slot]}</h2>
          <button className="icon-btn small" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </header>
        <p className="small muted">
          {SLOT_WHEN[slot]} {slot === 'starter' ? 'Only starting pitchers (SP) can start.' : 'Only relievers (RP) can pitch in relief.'} Picking someone with another role today swaps the two{holder ? ` (${holder.lastName} takes his place)` : ''}.
        </p>
        <ul className="ps-pick-list">
          {rows.map(({ p, v, at }) => (
            <li key={p.id} className={p.id === current ? 'current' : ''}>
              <Portrait state={state} player={p} size={40} nested />
              <span className="pr-id">
                <strong>{playerName(p)}</strong>
                <small>
                  {positionWord(p)} · {at ? `Today: ${SLOT_LABEL[at]}` : 'On the bench'}
                </small>
              </span>
              <EffValue ovr={v.ovr} eff={v.effective} />
              <ModChips mods={v.mods} reasons={modifierReasons(state, p, status)} compact />
              {p.id === current ? (
                <span className="starting-btn">
                  <Icon name="check" size={16} /> Current
                </span>
              ) : (
                <button className="btn btn-small btn-secondary" onClick={() => onPick(p.id)}>
                  {at ? 'Swap' : 'Select'}
                </button>
              )}
            </li>
          ))}
        </ul>
        {current && onClear && (
          <button className="link" onClick={onClear}>
            Leave the role empty
          </button>
        )}
      </div>
    </div>
  );
}
