import { useState } from 'react';
import { BALANCE } from '../../balance/config';
import { normalizeStaff, pitcherReadiness, ROLE_LABEL, staffRole, type BullpenRole, type PitchingStaff } from '../../domain/staff';
import { userClub } from '../../domain/state';
import type { Player } from '../../domain/types';
import { Icon } from '../components/icons';
import { useController, useGame, useSnapshot } from '../hooks';
import { PitcherRow } from './PitcherRow';
import { PitcherPicker, RoleCards, ROLE_WHEN, staffRoleText, withRole, withRotation } from './StaffParts';

/**
 * Team → Pitching staff: the standing plan in the same look as the pre-match
 * Pitchers tab. The rotation in order (move, remove, add), the three bullpen
 * role cards, and the depth arms. Every change is saved at once (no Time, no
 * event) and applies from the next game.
 */
export function StaffTab() {
  const s = useGame();
  const c = useController();
  const snap = useSnapshot();
  const club = userClub(s);
  const staff = normalizeStaff(s, club.id, club.staff);
  const all = club.roster.map((id) => s.players[id]).filter((p) => p.isPitcher);
  const rotation = staff.rotation.map((id) => s.players[id]).filter(Boolean);
  const depth = all.filter((p) => staffRole(staff, p.id) === 'depth').sort((a, b) => b.ratings.pitching - a.ratings.pitching || a.id.localeCompare(b.id));
  const [picking, setPicking] = useState<BullpenRole | 'rotation' | null>(null);
  const busy = snap.busy;
  const save = (next: PitchingStaff) => void c.dispatch({ type: 'setStaff', staff: next });
  const move = (i: number, d: number) => {
    const r = [...staff.rotation];
    const j = i + d;
    if (j < 0 || j >= r.length) return;
    [r[i], r[j]] = [r[j], r[i]];
    save({ ...staff, rotation: r });
  };
  const remove = (id: string) => save({ ...staff, rotation: staff.rotation.filter((x) => x !== id) });
  const canAdd = staff.rotation.length < BALANCE.pitching.maxRotation;
  const order = (p: Player) => ['closer', 'setup', 'long', 'depth'].indexOf(staffRole(staff, p.id));

  return (
    <div className="pm-pitch-layout pitch-v2 staff-tab">
      <section className="panel pm-starters">
        <header className="panel-head">
          <h2>Starting rotation</h2>
          <small className="muted">
            {BALANCE.pitching.rotationSize} starters in turn; anyone below {BALANCE.pitching.starterReadyFitness}% is skipped that day.
          </small>
        </header>
        <div className="p-list-head" aria-hidden="true">
          <span />
          <span />
          <span>PIT</span>
          <span>OVR</span>
          <span>Condition</span>
          <span>Morale</span>
          <span>Last outing</span>
          <span />
        </div>
        <ul className="p-list">
          {rotation.map((p, i) => (
            <PitcherRow
              key={p.id}
              state={s}
              player={p}
              role={staffRoleText(staff, p)}
              readiness={pitcherReadiness(s, p, 'rotation')}
              selected={i === staff.next}
              action={
                <span className="order-btns">
                  <button className="icon-btn small" onClick={() => move(i, -1)} disabled={busy || i === 0} aria-label={`Move ${p.lastName} up`}>
                    ↑
                  </button>
                  <button className="icon-btn small" onClick={() => move(i, 1)} disabled={busy || i === rotation.length - 1} aria-label={`Move ${p.lastName} down`}>
                    ↓
                  </button>
                  <button className="icon-btn small" onClick={() => remove(p.id)} disabled={busy || rotation.length <= 1} aria-label={`Take ${p.lastName} out of the rotation`}>
                    ✕
                  </button>
                </span>
              }
            />
          ))}
        </ul>
        {canAdd && (
          <button className="rc-assign add-rotation" onClick={() => setPicking('rotation')} disabled={busy}>
            + Add to rotation
          </button>
        )}
        {rotation.length < BALANCE.pitching.rotationSize && (
          <p className="small warn-line">
            <Icon name="warning" size={14} /> A {BALANCE.pitching.rotationSize}-man rotation is recommended: with fewer, starters pitch on less rest.
          </p>
        )}
      </section>

      <section className="panel pm-bullpen">
        <header className="panel-head">
          <h2>Bullpen</h2>
          <small className="muted">Up to {BALANCE.pitching.maxPitchersPerGame} pitchers per game.</small>
        </header>
        <RoleCards state={s} staff={staff} busy={busy} onPick={setPicking} />
        <h3 className="subhead rest-head">
          Depth <small className="muted">Not in the plan: used only if long relief is empty or unavailable.</small>
        </h3>
        {depth.length === 0 ? (
          <p className="small muted">Every pitcher has a role.</p>
        ) : (
          <ul className="p-list compact">
            {depth.map((p) => (
              <PitcherRow key={p.id} state={s} player={p} role="Depth" readiness={pitcherReadiness(s, p, 'depth')} />
            ))}
          </ul>
        )}
        <p className="small muted staff-note">
          <Icon name="clipboard" size={14} /> Rest is counted in days: pitchers recover every day, more on days after they did not pitch.
        </p>
      </section>

      {picking && (
        <PitcherPicker
          state={s}
          staff={staff}
          title={picking === 'rotation' ? 'Add to rotation' : ROLE_LABEL[picking]}
          help={
            picking === 'rotation'
              ? 'He joins the end of the rotation; a bullpen role he had is left empty.'
              : `${ROLE_WHEN[picking]} Rotation starters are not listed; picking someone from another role moves him here.`
          }
          candidates={all.filter((p) => !staff.rotation.includes(p.id)).sort((a, b) => order(a) - order(b) || a.id.localeCompare(b.id))}
          current={picking === 'rotation' ? null : staff[picking]}
          readinessFor={picking === 'rotation' ? 'rotation' : picking}
          onPick={(id) => {
            save(picking === 'rotation' ? withRotation(staff, id) : withRole(staff, picking, id));
            setPicking(null);
          }}
          onClear={
            picking === 'rotation'
              ? undefined
              : () => {
                  save(withRole(staff, picking, null));
                  setPicking(null);
                }
          }
          onClose={() => setPicking(null)}
        />
      )}
    </div>
  );
}
