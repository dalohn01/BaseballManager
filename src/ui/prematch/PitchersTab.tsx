import { useState } from 'react';
import { BALANCE } from '../../balance/config';
import { pitcherRole, setHook, setPitcherRole } from '../../domain/lineupDraft';
import { normalizeStaff, ROLE_LABEL, staffRole, type BullpenRole, type PitchingStaff } from '../../domain/staff';
import { userClub } from '../../domain/state';
import type { Player, PitchingHook } from '../../domain/types';
import { forecastForLineup } from '../../events/templates/leagueGame';
import { Icon } from '../components/icons';
import { href, useController, useSnapshot } from '../hooks';
import { instructionSummary } from '../tactics/TacticsControls';
import { PitcherRow } from './PitcherRow';
import type { DraftApi } from './PreMatchScreen';
import { Legend, pitcherValues, Values } from './shared';
import { PitcherPicker, RoleCards, ROLE_WHEN, staffRoleText, withRole } from './StaffParts';

const HOOK_TEXT: Record<PitchingHook, string> = {
  early: 'Early',
  balanced: 'Balanced',
  long: 'Let him pitch',
};

/**
 * Pitching for today's game: the starter comes from the rotation (only its
 * members are offered; the next ready one is preselected), the bullpen as
 * three role cards (standing roles, saved for every game) and who rests today.
 */
export function PitchersTab({ api, gameId }: { api: DraftApi; gameId: string }) {
  const { state: s, draft, update, mode, period } = api;
  const c = useController();
  const snap = useSnapshot();
  const club = userClub(s);
  const staff = normalizeStaff(s, club.id, club.staff);
  const all = club.roster.map((id) => s.players[id]).filter((p) => p.isPitcher);
  const starter = s.players[draft.lineup.pitcherId];
  // Rotation in order; today's starter is kept in the list if he was picked from outside it.
  const rotation = staff.rotation.map((id) => s.players[id]).filter(Boolean);
  const startList = rotation.some((p) => p.id === starter.id) ? rotation : [...rotation, starter];
  const order = (p: Player) => {
    const i = staff.rotation.indexOf(p.id);
    return i >= 0 ? i : 10 + ['closer', 'setup', 'long', 'depth'].indexOf(staffRole(staff, p.id));
  };
  const others = all.filter((p) => p.id !== starter.id).sort((a, b) => order(a) - order(b) || a.id.localeCompare(b.id));
  const alt = rotation.filter((p) => p.id !== starter.id).sort((a, b) => b.ratings.pitching - a.ratings.pitching)[0];
  const winNow = forecastForLineup(s, gameId, draft.lineup);
  const winAlt = alt ? forecastForLineup(s, gameId, { ...draft.lineup, pitcherId: alt.id }) : null;
  const hook = BALANCE.match.hooks[draft.plan.hook];
  const [picking, setPicking] = useState<BullpenRole | null>(null);

  const detail = (p: Player) => (mode === 'stats' ? <Values vals={pitcherValues(s, p, mode, period, true)} /> : undefined);
  const instr = (p: Player) => (
    <button className="pr-instr" onClick={() => api.openTactics(p.id)} title={`Instructions: ${instructionSummary(s, p)}`} aria-label={`Instructions for ${p.lastName}: ${instructionSummary(s, p)}`}>
      <Icon name="clipboard" size={14} />
    </button>
  );
  const saveStaff = (next: PitchingStaff) => void c.dispatch({ type: 'setStaff', staff: next });

  return (
    <div className="pm-pitch-layout pitch-v2">
      <section className="panel pm-starters">
        <header className="panel-head">
          <h2>Today's starter</h2>
          <small className="muted">
            From your rotation: the next ready one is chosen. <a href={href('team/staff')}>Edit the rotation</a>
          </small>
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
          {startList.map((p) => {
            const isStarter = p.id === starter.id;
            return (
              <PitcherRow
                key={p.id}
                state={s}
                player={p}
                role={staffRoleText(staff, p)}
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
        <RoleCards state={s} staff={staff} todayStarterId={starter.id} busy={snap.busy} onPick={setPicking} />

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
                role={staffRoleText(staff, p)}
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
        <PitcherPicker
          state={s}
          staff={staff}
          title={ROLE_LABEL[picking]}
          help={`${ROLE_WHEN[picking]} Rotation starters are not listed; picking someone from another role moves him here.`}
          candidates={all.filter((p) => !staff.rotation.includes(p.id)).sort((a, b) => order(a) - order(b) || a.id.localeCompare(b.id))}
          current={staff[picking]}
          readinessFor={picking}
          todayStarterId={starter.id}
          onPick={(id) => {
            saveStaff(withRole(staff, picking, id));
            setPicking(null);
          }}
          onClear={() => {
            saveStaff(withRole(staff, picking, null));
            setPicking(null);
          }}
          onClose={() => setPicking(null)}
        />
      )}
    </div>
  );
}
