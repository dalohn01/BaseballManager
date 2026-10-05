import { useEffect, useRef, useState, type DragEvent } from 'react';
import { BALANCE } from '../../balance/config';
import { effectiveValue, MODIFIER_KEYS, MODIFIER_LABEL, teamStatus, type TeamStatus } from '../../domain/effective';
import { assignPitcher, benchPitcher, pitcherSlot } from '../../domain/lineupDraft';
import { pitcherPosition } from '../../domain/pitching';
import { fmtEra, fmtIp, pitchingStats, playerNotes, type StatsPeriod } from '../../domain/playerStats';
import { playerName, userClub } from '../../domain/state';
import type { GameState } from '../../domain/state';
import { canPitchIn, emptyBullpen, PITCHING_SLOTS, SLOT_LABEL, SLOT_SHORT, type PitchingSlot } from '../../domain/todayPitching';
import type { Player } from '../../domain/types';
import { Icon } from '../components/icons';
import { EffValue, ModChips, modifierReasons } from '../components/Modifiers';
import { ChangeButton, EffBlock, ModColumns, modIcon, PlayerIdent, StatBlock } from './LineupParts';
import { instructionSummary } from '../tactics/TacticsControls';
import type { DraftApi } from './PreMatchScreen';
import { Notes, Portrait } from './shared';

const P = BALANCE.pitching;
const SLOT_WHEN: Record<PitchingSlot, string> = {
  starter: 'Starts the game.',
  long: `Early (before the ${P.longReliefUntilInning}th) if needed.`,
  setup: `${P.setupFromInning}th–8th inning.`,
  closer: 'Save situations from the 9th.',
};
const SLOT_ICON = { starter: 'crown', long: 'link', setup: 'star', closer: 'flame' } as const;

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

  return (
    <div className="pitch-v4 bat-view pitch-view">
      <section className="panel ps-staff">
        <header className="panel-head">
          <h2>Pitching staff</h2>
          <small className="muted">Drag onto a role or in from the bench. Roles apply to today's game only.</small>
        </header>
        <ol className="ps-rows bat-rows">
          {/* Column labels for the compact rows (wide screens): the modifiers' icons live here once. */}
          <li className="bat-head" aria-hidden="true">
            <span className="bh-order">#</span>
            <span className="bh-pos">Role</span>
            <span className="bh-player">Pitcher</span>
            <span className="bh-eff">Effective</span>
            <span className="pr-mods">
              {MODIFIER_KEYS.map((k) => (
                <span key={k} className="pr-mod">
                  {modIcon(k, 1)}
                  <small>{MODIFIER_LABEL[k]}</small>
                </span>
              ))}
            </span>
            <span className="bh-stats">Stats</span>
          </li>
          {PITCHING_SLOTS.map((slot, i) => {
            const p = inSlot(slot);
            const v = p ? effectiveValue(s, p, jobOf(slot, p), status) : null;
            return (
              <li
                key={slot}
                className={`ps-row bat-row slot-${slot} ${p ? '' : 'empty'} ${over === slot ? 'mark-replace' : ''} ${dropState(slot)} ${dragging && p && dragging.id === p.id ? 'dragging' : ''}`}
                draggable={!!p}
                onDragStart={p ? dragStart(p) : undefined}
                onDragEnd={dragEnd}
                onDragOver={dragOver(slot)}
                onDragLeave={() => setOver(null)}
                onDrop={drop(slot)}
                aria-label={`${SLOT_LABEL[slot]}${p ? `: ${playerName(p)}` : ': empty'}`}
              >
                <span className="br-grip" title="Drag to another role or to the bench">
                  <Icon name="grip" size={20} strokeWidth={3.5} />
                </span>
                <span className="pr-num">{i + 1}</span>
                <span className={`br-pos role-badge role-${slot}`} title={`${SLOT_LABEL[slot]}: ${SLOT_WHEN[slot]}`}>
                  <Icon name={SLOT_ICON[slot]} size={12} />
                  <span aria-hidden="true">{SLOT_SHORT[slot]}</span>
                  <span className="sr-only">{SLOT_LABEL[slot]}</span>
                </span>
                {p && v ? (
                  <>
                    <span className="pr-player">
                      <PlayerIdent
                        state={s}
                        player={p}
                        size={34}
                        sub={`#${p.number} · Throws ${p.throws} · ${positionWord(p)}`}
                        extra={
                          <button className="pr-instr" onClick={() => api.openTactics(p.id)} title={`Instructions: ${instructionSummary(s, p)}`} aria-label={`Instructions for ${p.lastName}`}>
                            <Icon name="clipboard" size={14} />
                          </button>
                        }
                      />
                    </span>
                    <EffBlock base={v.ovr} eff={v.effective} label />
                    <ModColumns mods={v.mods} reasons={reasons(p)} />
                    <StatBlock stats={statPairs(statLine(s, p, period))} />
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
      </section>

      <section className={`panel ps-bench ${over === 'bench' ? 'drop' : ''}`} onDragOver={dragOver('bench')} onDragLeave={() => setOver(null)} onDrop={drop('bench')}>
        <header className="panel-head">
          <h2>Rest today (bench)</h2>
          <small className="muted">Drag onto a role, or use the ⋮ handle. Pitchers here rest one stage today.</small>
        </header>
        {bench.length === 0 ? (
          <p className="small muted ps-none">Every pitcher has a role today.</p>
        ) : (
          <ol className="ps-rows bat-rows bench-rows">
            <li className="bat-head bench-head" aria-hidden="true">
              <span className="bh-player">Pitcher</span>
              <span className="bh-eff">Effective</span>
              <span className="pr-mods">
                {MODIFIER_KEYS.map((k) => (
                  <span key={k} className="pr-mod">
                    {modIcon(k, 1)}
                    <small>{MODIFIER_LABEL[k]}</small>
                  </span>
                ))}
              </span>
              <span className="bh-stats">Stats</span>
            </li>
            {bench.map(({ p, v }) => (
              <li
                key={p.id}
                className={`ps-row bat-row bench-row ${dragging?.id === p.id ? 'dragging' : ''}`}
                draggable
                onDragStart={dragStart(p)}
                onDragEnd={dragEnd}
                aria-label={`Bench: ${playerName(p)}`}
              >
                <span className="br-grip" title="Drag onto a role">
                  <Icon name="grip" size={20} strokeWidth={3.5} />
                  <UseAs state={s} player={p} inSlot={inSlot} status={status} onUse={(slot) => update(assignPitcher(s, draft, slot, p.id))} />
                </span>
                <span className="pr-player">
                  <PlayerIdent state={s} player={p} size={34} sub={`#${p.number} · Throws ${p.throws} · ${positionWord(p)}`} badge={<Notes notes={playerNotes(s, p, { starting: false })} max={1} />} />
                </span>
                <EffBlock base={v.ovr} eff={v.effective} label />
                <ModColumns mods={v.mods} reasons={reasons(p)} />
                <StatBlock stats={statPairs(statLine(s, p, period))} />
              </li>
            ))}
          </ol>
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
