import { useEffect, useRef, useState, type DragEvent } from 'react';
import { BALANCE } from '../../balance/config';
import { effectiveValue, teamStatus, type TeamStatus } from '../../domain/effective';
import { assignPitcher, benchPitcher, pitcherSlot, setHook } from '../../domain/lineupDraft';
import { pitcherPosition } from '../../domain/pitching';
import { fmtEra, fmtIp, pitcherWorkload, pitchingStats } from '../../domain/playerStats';
import { playerName, userClub } from '../../domain/state';
import { emptyBullpen, PITCHING_SLOTS, SLOT_LABEL, type PitchingSlot } from '../../domain/todayPitching';
import type { GameState } from '../../domain/state';
import type { PitchingHook, Player } from '../../domain/types';
import { forecastForLineup } from '../../events/templates/leagueGame';
import { Icon } from '../components/icons';
import { EffValue, ModChips, modifierReasons } from '../components/Modifiers';
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
  starter: 'Starts the game and goes as far as the hook allows.',
  long: `Early relief (to the ${P.longReliefUntilInning}th) when the starter is knocked out.`,
  setup: `Takes over in the ${P.setupFromInning}th–8th.`,
  closer: `Save situations from the 9th (lead of ${P.saveLead[0]}–${P.saveLead[1]}).`,
};

function lastOuting(state: GameState, p: Player): { when: string; detail: string } | null {
  const w = pitcherWorkload(state, p);
  if (!w.last) return null;
  const when = w.last.gamesAgo === 1 ? 'last game' : `${w.last.gamesAgo} games ago`;
  return { when, detail: `${fmtIp(w.last.outs)} IP${w.last.started ? ' (start)' : ''}` };
}

/** A pitcher's value in a slot: as the starter (stamina counts) or in relief. */
const jobOf = (slot: PitchingSlot | null, p: Player) => (slot === 'starter' ? 'SP' : slot ? 'RP' : pitcherPosition(p));

/**
 * Set your pitching staff for today's game: four slots (Starting pitcher, Long
 * relief, Setup, Closer) with each pitcher's effective value (OVR plus Fitness,
 * Morale, Team and Form), and the pitchers not used today. The roles apply to
 * this game only; the strongest setup is preselected. Pitchers move by drag
 * and drop, by Change on a slot, or with "Use as" on the bench.
 */
export function PitchersTab({ api, gameId }: { api: DraftApi; gameId: string }) {
  const { state: s, draft, update, mode, period } = api;
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
    .map((p) => ({ p, v: effectiveValue(s, p, undefined, status) }))
    .sort((a, b) => b.v.effective - a.v.effective || a.p.id.localeCompare(b.p.id));
  const [picking, setPicking] = useState<PitchingSlot | null>(null);
  const [over, setOver] = useState<PitchingSlot | 'bench' | null>(null);
  const win = forecastForLineup(s, gameId, draft.lineup);
  const hook = BALANCE.match.hooks[draft.plan.hook];

  const drop = (target: PitchingSlot | 'bench') => (e: DragEvent) => {
    e.preventDefault();
    setOver(null);
    const id = e.dataTransfer.getData('text/plain');
    if (!id || !s.players[id]?.isPitcher) return;
    if (target === 'bench') {
      const from = pitcherSlot(draft, id);
      if (from && from !== 'starter') update(benchPitcher(draft, from));
    } else update(assignPitcher(draft, target, id));
  };
  const dragOver = (target: PitchingSlot | 'bench') => (e: DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (over !== target) setOver(target);
  };
  const dragStart = (id: string) => (e: DragEvent) => {
    e.dataTransfer.setData('text/plain', id);
    e.dataTransfer.effectAllowed = 'move';
  };

  return (
    <div className="pitch-v3">
      <section className="panel ps-staff">
        <header className="panel-head">
          <h2>Set your pitching staff</h2>
          <small className="muted">For today's game only. Effective (EFF) = OVR + Fitness, Morale, Team and Form. Drag a pitcher onto a slot to swap.</small>
        </header>
        <div className="ps-slots">
          {PITCHING_SLOTS.map((slot) => {
            const p = inSlot(slot);
            const v = p ? effectiveValue(s, p, jobOf(slot, p), status) : null;
            const out = p ? lastOuting(s, p) : null;
            return (
              <div
                key={slot}
                className={`ps-slot slot-${slot} ${p ? '' : 'empty'} ${over === slot ? 'drop' : ''}`}
                onDragOver={dragOver(slot)}
                onDragLeave={() => setOver(null)}
                onDrop={drop(slot)}
                aria-label={`${SLOT_LABEL[slot]}${p ? `: ${playerName(p)}` : ': empty'}`}
                role="group"
              >
                <header>
                  <h3>{SLOT_LABEL[slot]}</h3>
                  <p className="ps-when">{SLOT_WHEN[slot]}</p>
                </header>
                {p && v ? (
                  <>
                    <div className="ps-player" draggable onDragStart={dragStart(p.id)} title="Drag to another slot to swap">
                      <Portrait state={s} player={p} size={52} nested />
                      <span className="ps-name">
                        <strong>
                          <span className={`pos-chip pos-${pitcherPosition(p).toLowerCase()}`}>{pitcherPosition(p)}</span>
                          {p.lastName}
                          <button className="pr-instr" onClick={() => api.openTactics(p.id)} title={`Instructions: ${instructionSummary(s, p)}`} aria-label={`Instructions for ${p.lastName}`}>
                            <Icon name="clipboard" size={14} />
                          </button>
                        </strong>
                        <small>{out ? `Last outing: ${out.when}, ${out.detail}` : 'No outings yet'}</small>
                      </span>
                      <EffValue ovr={v.ovr} eff={v.effective} big />
                    </div>
                    <ModChips mods={v.mods} reasons={modifierReasons(s, p, status)} />
                    <div className="ps-actions">
                      <button className="btn btn-small btn-secondary" onClick={() => setPicking(slot)}>
                        <Icon name="swap" size={16} /> Change
                      </button>
                    </div>
                  </>
                ) : (
                  <button className="rc-assign" onClick={() => setPicking(slot)}>
                    + Assign pitcher
                  </button>
                )}
              </div>
            );
          })}
        </div>
        <p className="tradeoff-line small">
          <Icon name="influence" size={16} /> Forecast with this staff: <strong>{Math.round(win * 100)}%</strong>. Rest is counted in games: a start leaves a pitcher Exhausted (−25), then Tired (−10), Ready (0) and Fresh (+1) after three games off; a relief outing costs one stage.
        </p>
      </section>

      <section className={`panel ps-bench ${over === 'bench' ? 'drop' : ''}`} onDragOver={dragOver('bench')} onDragLeave={() => setOver(null)} onDrop={drop('bench')}>
        <header className="panel-head">
          <h2>Not used today</h2>
          <small className="muted">{bench.length ? 'These pitchers sit out this game (and rest one stage).' : 'Every pitcher has a slot today.'}</small>
        </header>
        {bench.length > 0 && (
          <div className="ps-table-wrap">
            <table className="ps-table">
              <thead>
                <tr>
                  <th scope="col">Pitcher</th>
                  <th scope="col" title="Overall at his position">OVR</th>
                  <th scope="col" title="Effective today">EFF</th>
                  <th scope="col">Modifiers</th>
                  <th scope="col" title={period === 'season' ? 'Season' : 'Last 5 games'}>{mode === 'stats' ? 'G · ERA · K · IP' : 'G · ERA'}</th>
                  <th scope="col">
                    <span className="sr-only">Use</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {bench.map(({ p, v }) => {
                  const st = pitchingStats(s, p, period);
                  return (
                    <tr key={p.id} draggable onDragStart={dragStart(p.id)}>
                      <th scope="row">
                        <span className="ps-bench-name">
                          <Portrait state={s} player={p} size={36} nested />
                          <span>
                            <span className={`pos-chip pos-${pitcherPosition(p).toLowerCase()}`}>{pitcherPosition(p)}</span>
                            {playerName(p)}
                          </span>
                        </span>
                      </th>
                      <td className="num" data-label="OVR">{v.ovr}</td>
                      <td className="num eff" data-label="EFF">{v.effective}</td>
                      <td>
                        <ModChips mods={v.mods} reasons={modifierReasons(s, p, status)} compact />
                      </td>
                      <td className="num stats" data-label={mode === 'stats' ? 'G · ERA · K · IP' : 'G · ERA'}>
                        {st.g} · {fmtEra(st.era)}
                        {mode === 'stats' && ` · ${st.so} · ${fmtIp(st.outs)}`}
                      </td>
                      <td>
                        <UseAs state={s} player={p} inSlot={inSlot} onUse={(slot) => update(assignPitcher(draft, slot, p.id))} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <div className="ps-hook">
          <h3 className="subhead">When to take out the starter</h3>
          <div className="segmented" role="group" aria-label="When to replace the starter">
            {(Object.keys(HOOK_TEXT) as PitchingHook[]).map((h) => (
              <button key={h} className={draft.plan.hook === h ? 'on' : ''} aria-pressed={draft.plan.hook === h} onClick={() => update(setHook(draft, h))}>
                {HOOK_TEXT[h]}
              </button>
            ))}
          </div>
          <p className="small muted">
            The starter comes out after {hook.maxBatters} batters, or once he has allowed {hook.pullRuns} runs after at least {hook.minBatters} batters. The hook setting stays for future games.
          </p>
        </div>
      </section>

      {picking && (
        <SlotPicker
          state={s}
          status={status}
          slot={picking}
          pitchers={all}
          slotOf={(id) => pitcherSlot(draft, id)}
          current={inSlot(picking)?.id ?? null}
          onPick={(id) => {
            update(assignPitcher(draft, picking, id));
            setPicking(null);
          }}
          onClear={picking === 'starter' ? undefined : () => {
            update(benchPitcher(draft, picking as Exclude<PitchingSlot, 'starter'>));
            setPicking(null);
          }}
          onClose={() => setPicking(null)}
        />
      )}
    </div>
  );
}

/** "Use as…" for a bench pitcher: the slot and who he replaces. */
function UseAs({ state, player, inSlot, onUse }: { state: GameState; player: Player; inSlot: (slot: PitchingSlot) => Player | null; onUse: (slot: PitchingSlot) => void }) {
  return (
    <select
      className="ps-use"
      aria-label={`Use ${player.lastName} as`}
      value=""
      onChange={(e) => {
        if (e.target.value) onUse(e.target.value as PitchingSlot);
      }}
    >
      <option value="">Use as…</option>
      {PITCHING_SLOTS.map((slot) => {
        const now = inSlot(slot);
        const v = effectiveValue(state, player, jobOf(slot, player)).effective;
        return (
          <option key={slot} value={slot}>
            {SLOT_LABEL[slot]} (EFF {v}){now ? `, for ${now.lastName}` : ''}
          </option>
        );
      })}
    </select>
  );
}

/** Choose a pitcher for one slot: everyone, by effective value in that job. Picking someone with another slot swaps the two. */
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
          {SLOT_WHEN[slot]} Values are {slot === 'starter' ? 'as a starter (stamina counts)' : 'in relief'}. Picking someone with another slot today swaps the two{holder ? ` (${holder.lastName} takes his place)` : ''}.
        </p>
        <ul className="ps-pick-list">
          {rows.map(({ p, v, at }) => (
            <li key={p.id} className={p.id === current ? 'current' : ''}>
              <Portrait state={state} player={p} size={40} nested />
              <span className="ps-name">
                <strong>
                  <span className={`pos-chip pos-${pitcherPosition(p).toLowerCase()}`}>{pitcherPosition(p)}</span>
                  {playerName(p)}
                </strong>
                <small>{at ? `Today: ${SLOT_LABEL[at]}` : 'Not used today'}</small>
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
            Leave the slot empty
          </button>
        )}
      </div>
    </div>
  );
}
