import { useEffect, useRef, useState } from 'react';
import { BALANCE } from '../../balance/config';
import { pitcherRole, setHook, setPitcherRole } from '../../domain/lineupDraft';
import { overall } from '../../domain/ratings';
import { BULLPEN_ROLES, normalizeStaff, pitcherReadiness, ROLE_LABEL, staffRole, type BullpenRole, type PitchingStaff } from '../../domain/staff';
import { playerName, userClub } from '../../domain/state';
import type { Player, PitchingHook } from '../../domain/types';
import { forecastForLineup } from '../../events/templates/leagueGame';
import { Icon } from '../components/icons';
import { useController, useSnapshot } from '../hooks';
import { instructionSummary } from '../tactics/TacticsControls';
import { Condition, lastOuting, PitcherRow } from './PitcherRow';
import type { DraftApi } from './PreMatchScreen';
import { Legend, pitcherValues, Portrait, Values } from './shared';

const HOOK_TEXT: Record<PitchingHook, string> = {
  early: 'Early',
  balanced: 'Balanced',
  long: 'Let him pitch',
};

const ROLE_WHEN: Record<BullpenRole, string> = {
  closer: `Save situations from the 9th (lead of ${BALANCE.pitching.saveLead[0]}–${BALANCE.pitching.saveLead[1]}).`,
  setup: `${BALANCE.pitching.setupFromInning}th–8th inning.`,
  long: `Early relief (to the ${BALANCE.pitching.longReliefUntilInning}th) when the starter is knocked out.`,
};

/**
 * Pitching for today's game: a compact starter list (the rotation decides,
 * the manager can start someone else today), the bullpen as three role cards
 * (standing roles, saved for every game) and who rests today.
 */
export function PitchersTab({ api, gameId }: { api: DraftApi; gameId: string }) {
  const { state: s, draft, update, mode, period } = api;
  const c = useController();
  const snap = useSnapshot();
  const club = userClub(s);
  const staff = normalizeStaff(s, club.id, club.staff);
  const all = club.roster.map((id) => s.players[id]).filter((p) => p.isPitcher);
  const order = (p: Player) => {
    const i = staff.rotation.indexOf(p.id);
    return i >= 0 ? i : 10 + ['closer', 'setup', 'long', 'depth'].indexOf(staffRole(staff, p.id));
  };
  const pitchers = [...all].sort((a, b) => order(a) - order(b) || a.id.localeCompare(b.id));
  const starter = s.players[draft.lineup.pitcherId];
  const others = pitchers.filter((p) => p.id !== starter.id);
  const alt = others.slice().sort((a, b) => b.ratings.pitching - a.ratings.pitching)[0];
  const winNow = forecastForLineup(s, gameId, draft.lineup);
  const winAlt = alt ? forecastForLineup(s, gameId, { ...draft.lineup, pitcherId: alt.id }) : null;
  const hook = BALANCE.match.hooks[draft.plan.hook];
  const turn = staff.rotation[staff.next];
  const [picking, setPicking] = useState<BullpenRole | null>(null);

  const roleText = (p: Player) => {
    const i = staff.rotation.indexOf(p.id);
    return i >= 0 ? `Rotation #${i + 1}${p.id === turn ? ' · next in turn' : ''}` : ROLE_LABEL[staffRole(staff, p.id)];
  };
  const detail = (p: Player) => (mode === 'stats' ? <Values vals={pitcherValues(s, p, mode, period, true)} /> : undefined);
  const instr = (p: Player) => (
    <button className="pr-instr" onClick={() => api.openTactics(p.id)} title={`Instructions: ${instructionSummary(s, p)}`} aria-label={`Instructions for ${p.lastName}: ${instructionSummary(s, p)}`}>
      <Icon name="clipboard" size={14} />
    </button>
  );

  const saveStaff = (next: PitchingStaff) => void c.dispatch({ type: 'setStaff', staff: next });
  const assign = (role: BullpenRole, id: string | null) => {
    const base: PitchingStaff = { ...staff };
    if (id) for (const r of BULLPEN_ROLES) if (base[r] === id) base[r] = null;
    saveStaff({ ...base, [role]: id });
    setPicking(null);
  };

  return (
    <div className="pm-pitch-layout pitch-v2">
      <section className="panel pm-starters">
        <header className="panel-head">
          <h2>Today's starter</h2>
          <small className="muted">The rotation decides, but you can make changes.</small>
        </header>
        <div className="p-list-head" aria-hidden="true">
          <span />
          <span />
          <span>PIT</span>
          <span>OVR</span>
          <span>Condition</span>
          <span>Morale</span>
          <span>{mode === 'stats' ? 'Season' : 'Last outing'}</span>
          <span />
        </div>
        <ul className="p-list">
          {pitchers.map((p) => {
            const isStarter = p.id === starter.id;
            return (
              <PitcherRow
                key={p.id}
                state={s}
                player={p}
                role={roleText(p)}
                selected={isStarter}
                detail={detail(p)}
                extra={instr(p)}
                action={
                  isStarter ? (
                    <span className="starting-btn">
                      <Icon name="check" size={16} /> Starting
                    </span>
                  ) : (
                    <button className="btn btn-small btn-secondary" onClick={() => update(setPitcherRole(draft, p.id, 'starter'))} aria-label={`Start ${p.lastName} today`}>
                      Start today
                    </button>
                  )
                }
              />
            );
          })}
        </ul>
        {alt && winAlt !== null && (
          <p className="tradeoff-line small">
            <Icon name="influence" size={16} /> Forecast with {starter.lastName}: <strong>{Math.round(winNow * 100)}%</strong> · with {alt.lastName}: <strong>{Math.round(winAlt * 100)}%</strong>. Fitness below 100% lowers today's pitching by {BALANCE.match.fitnessPenaltyPerPoint} per point.
          </p>
        )}
      </section>

      <section className="panel pm-bullpen">
        <header className="panel-head">
          <h2>Bullpen</h2>
          <small className="muted">Standing roles (saved for every game). Up to {BALANCE.pitching.maxPitchersPerGame} pitchers per game.</small>
        </header>
        <div className="role-cards">
          {BULLPEN_ROLES.map((role) => {
            const id = staff[role];
            const p = id ? s.players[id] : null;
            const out = p ? lastOuting(s, p) : null;
            return (
              <div key={role} className={`role-card role-${role} ${p ? '' : 'empty'}`}>
                <h3>{ROLE_LABEL[role]}</h3>
                <p className="rc-when">{ROLE_WHEN[role]}</p>
                {p ? (
                  <>
                    <div className="rc-player">
                      <Portrait state={s} player={p} size={56} nested />
                      <div>
                        <strong className="rc-name">{playerName(p)}</strong>
                        <span className="rc-ratings">
                          <span>
                            PIT <b>{p.ratings.pitching}</b>
                          </span>
                          <span>
                            OVR <b>{overall(p)}</b>
                          </span>
                        </span>
                        <Condition value={p.fitness} />
                      </div>
                    </div>
                    <p className="rc-last small">
                      {p.id === starter.id ? (
                        <strong>Starting today: not in the bullpen</strong>
                      ) : (
                        <>
                          {pitcherReadiness(s, p, role)}
                          {out ? ` · Last outing: ${out.when}, ${out.detail}` : ''}
                        </>
                      )}
                    </p>
                    <button className="btn btn-small btn-secondary rc-change" onClick={() => setPicking(role)} disabled={snap.busy}>
                      Change
                    </button>
                  </>
                ) : (
                  <button className="rc-assign" onClick={() => setPicking(role)} disabled={snap.busy}>
                    + Assign pitcher
                  </button>
                )}
              </div>
            );
          })}
        </div>

        <h3 className="subhead rest-head">
          Rest today <small className="muted">This game only. Rest is counted in days.</small>
        </h3>
        <ul className="p-list compact">
          {others.map((p) => {
            const resting = pitcherRole(draft, p.id) === 'rest';
            return (
              <PitcherRow
                key={p.id}
                state={s}
                player={p}
                role={roleText(p)}
                resting={resting}
                detail={detail(p)}
                action={
                  <button className={`btn btn-small ${resting ? 'btn-rest-on' : 'btn-secondary'}`} aria-pressed={resting} onClick={() => update(setPitcherRole(draft, p.id, resting ? 'available' : 'rest'))}>
                    {resting ? 'Resting' : 'Rest'}
                  </button>
                }
              />
            );
          })}
        </ul>

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
        {mode === 'stats' && <Legend keys={['ERA', 'WHIP', 'K', 'IP']} />}
      </section>

      {picking && (
        <RolePicker
          role={picking}
          current={staff[picking]}
          candidates={pitchers.filter((p) => !staff.rotation.includes(p.id))}
          starterId={starter.id}
          staff={staff}
          api={api}
          onPick={(id) => assign(picking, id)}
          onClose={() => setPicking(null)}
        />
      )}
    </div>
  );
}

/** Choose who fills a bullpen role, using the same pitcher rows. A pitcher keeps one role: picking him here frees his old one. */
function RolePicker({
  role,
  current,
  candidates,
  starterId,
  staff,
  api,
  onPick,
  onClose,
}: {
  role: BullpenRole;
  current: string | null;
  candidates: Player[];
  starterId: string;
  staff: PitchingStaff;
  api: DraftApi;
  onPick: (id: string | null) => void;
  onClose: () => void;
}) {
  const s = api.state;
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.querySelector<HTMLButtonElement>('button')?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal role-picker" role="dialog" aria-modal="true" aria-label={`Choose the ${ROLE_LABEL[role].toLowerCase()}`} onClick={(e) => e.stopPropagation()} ref={ref}>
        <header className="rp-head">
          <h2>{ROLE_LABEL[role]}</h2>
          <button className="icon-btn small" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </header>
        <p className="small muted">{ROLE_WHEN[role]} Rotation starters are not listed; picking someone from another role moves him here.</p>
        <ul className="p-list compact">
          {candidates.map((p) => {
            const own = staffRole(staff, p.id);
            const isCurrent = p.id === current;
            return (
              <PitcherRow
                key={p.id}
                state={s}
                player={p}
                role={own === 'depth' ? 'Depth' : ROLE_LABEL[own]}
                readiness={p.id === starterId ? 'Starting today' : pitcherReadiness(s, p, role)}
                selected={isCurrent}
                showMorale={false}
                action={
                  isCurrent ? (
                    <span className="starting-btn">
                      <Icon name="check" size={16} /> {ROLE_LABEL[role]}
                    </span>
                  ) : (
                    <button className="btn btn-small btn-secondary" onClick={() => onPick(p.id)}>
                      Select
                    </button>
                  )
                }
              />
            );
          })}
        </ul>
        {current && (
          <button className="link" onClick={() => onPick(null)}>
            Leave the role empty
          </button>
        )}
      </div>
    </div>
  );
}
