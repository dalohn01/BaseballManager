import type { ReactNode } from 'react';
import { BALANCE } from '../../balance/config';
import { playerName, userClub } from '../../domain/state';
import { BULLPEN_ROLES, normalizeStaff, pitcherReadiness, ROLE_HELP, ROLE_LABEL, staffRole, type BullpenRole, type PitchingStaff } from '../../domain/staff';
import type { Player } from '../../domain/types';
import { PlayerAvatar } from '../components/PlayerAvatar';
import { Icon } from '../components/icons';
import { useController, useGame, useSnapshot } from '../hooks';

/**
 * The standing pitching staff: rotation order (the next starter comes up in
 * turn) and the three bullpen roles. Every change is saved at once (no Time,
 * no event) and applies from the next game on.
 */
export function StaffEditor({ todayStarterId, compact = false, bullpenOnly = false }: { todayStarterId?: string; compact?: boolean; bullpenOnly?: boolean }) {
  const s = useGame();
  const c = useController();
  const snap = useSnapshot();
  const club = userClub(s);
  const staff = normalizeStaff(s, club.id, club.staff);
  const pitchers = club.roster.map((id) => s.players[id]).filter((p) => p.isPitcher);
  const save = (next: PitchingStaff) => void c.dispatch({ type: 'setStaff', staff: next });
  const without = (st: PitchingStaff, id: string): PitchingStaff => ({
    ...st,
    rotation: st.rotation.filter((x) => x !== id),
    closer: st.closer === id ? null : st.closer,
    setup: st.setup === id ? null : st.setup,
    long: st.long === id ? null : st.long,
  });
  const move = (i: number, d: number) => {
    const r = [...staff.rotation];
    const j = i + d;
    if (j < 0 || j >= r.length) return;
    [r[i], r[j]] = [r[j], r[i]];
    save({ ...staff, rotation: r });
  };
  const setRole = (role: BullpenRole, id: string) => {
    const base = id ? without(staff, id) : staff;
    if (id && base.rotation.length === 0) return;
    save({ ...base, [role]: id || null });
  };
  const depth = pitchers.filter((p) => staffRole(staff, p.id) === 'depth');
  const canAdd = staff.rotation.length < BALANCE.pitching.maxRotation;
  const busy = snap.busy;

  const row = (p: Player, extra: ReactNode, tag?: string) => (
    <li key={p.id} className="staff-row">
      <PlayerAvatar player={p} club={club} size={compact ? 36 : 44} />
      <span className="sr-main">
        <strong>{playerName(p)}</strong>
        <small className="muted">
          PIT {p.ratings.pitching} · {p.fitness}% · {p.id === todayStarterId ? 'Starting today' : pitcherReadiness(s, p, staffRole(staff, p.id))}
          {tag ? ` · ${tag}` : ''}
        </small>
      </span>
      <span className="sr-actions">{extra}</span>
    </li>
  );

  return (
    <div className={`staff-editor ${compact ? 'compact' : ''}`}>
      {!bullpenOnly && (
        <>
      <h3 className="subhead">Rotation</h3>
      <p className="small muted">The next ready starter in order starts each game; anyone below {BALANCE.pitching.starterReadyFitness}% is skipped.</p>
      <ol className="staff-list">
        {staff.rotation.map((id, i) =>
          row(
            s.players[id],
            <>
              <button className="icon-btn small" onClick={() => move(i, -1)} disabled={busy || i === 0} aria-label={`Move ${s.players[id].lastName} up`}>
                ↑
              </button>
              <button className="icon-btn small" onClick={() => move(i, 1)} disabled={busy || i === staff.rotation.length - 1} aria-label={`Move ${s.players[id].lastName} down`}>
                ↓
              </button>
              <button className="icon-btn small" onClick={() => save(without(staff, id))} disabled={busy || staff.rotation.length <= 1} aria-label={`Take ${s.players[id].lastName} out of the rotation`}>
                ✕
              </button>
            </>,
            `#${i + 1}${i === staff.next ? ' · Next in turn' : ''}`,
          ),
        )}
      </ol>
      {canAdd && depth.length > 0 && (
        <label className="staff-add small">
          Add to rotation{' '}
          <select value="" onChange={(e) => e.target.value && save({ ...without(staff, e.target.value), rotation: [...staff.rotation, e.target.value] })} disabled={busy}>
            <option value="">Choose…</option>
            {depth.map((p) => (
              <option key={p.id} value={p.id}>
                {playerName(p)} (PIT {p.ratings.pitching})
              </option>
            ))}
          </select>
        </label>
      )}

        </>
      )}
      <h3 className="subhead">Bullpen roles</h3>
      <ul className="staff-roles">
        {BULLPEN_ROLES.map((role) => {
          const id = staff[role];
          const options = pitchers.filter((p) => !staff.rotation.includes(p.id));
          return (
            <li key={role} className="staff-role">
              <span className="role-name">
                <strong>{ROLE_LABEL[role]}</strong>
                <small className="muted">{ROLE_HELP[role]}</small>
              </span>
              <select value={id ?? ''} onChange={(e) => setRole(role, e.target.value)} disabled={busy} aria-label={ROLE_LABEL[role]}>
                <option value="">— None</option>
                {options.map((p) => (
                  <option key={p.id} value={p.id}>
                    {playerName(p)} · PIT {p.ratings.pitching} · {p.fitness}%{p.id === todayStarterId ? ' (starting today)' : ''}
                  </option>
                ))}
              </select>
              {id && <small className="role-status muted">{id === todayStarterId ? 'Starting today: not in the bullpen' : pitcherReadiness(s, s.players[id], role)}</small>}
            </li>
          );
        })}
      </ul>
      {depth.length > 0 && !bullpenOnly && (
        <>
          <h3 className="subhead">Depth</h3>
          <p className="small muted">Not in the plan: used only if long relief is empty or unavailable.</p>
          <ul className="staff-list">{depth.map((p) => row(p, null))}</ul>
        </>
      )}
      <p className="small muted staff-note">
        <Icon name="clipboard" size={14} /> At most {BALANCE.pitching.maxPitchersPerGame} pitchers per game. Rest is counted in days: pitchers recover every day, more on days after they did not pitch.
      </p>
    </div>
  );
}
