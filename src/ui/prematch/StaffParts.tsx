import { useEffect, useRef } from 'react';
import { BALANCE } from '../../balance/config';
import { overall } from '../../domain/ratings';
import { BULLPEN_ROLES, pitcherReadiness, ROLE_LABEL, staffRole, type BullpenRole, type PitchingStaff, type StaffRole } from '../../domain/staff';
import type { GameState } from '../../domain/state';
import { playerName } from '../../domain/state';
import type { Player } from '../../domain/types';
import { Icon } from '../components/icons';
import { Condition, lastOuting, PitcherRow } from './PitcherRow';
import { Portrait } from './shared';

/*
 * Pieces shared by the pre-match Pitchers tab and Team → Pitching staff:
 * the three bullpen role cards and the pitcher picker (same rows as the lists).
 */

export const ROLE_WHEN: Record<BullpenRole, string> = {
  closer: `Save situations from the 9th (lead of ${BALANCE.pitching.saveLead[0]}–${BALANCE.pitching.saveLead[1]}).`,
  setup: `${BALANCE.pitching.setupFromInning}th–8th inning.`,
  long: `Early relief (to the ${BALANCE.pitching.longReliefUntilInning}th) when the starter is knocked out.`,
};

/** "Rotation #2 · next in turn", "Closer", "Depth". */
export function staffRoleText(staff: PitchingStaff, p: Player): string {
  const i = staff.rotation.indexOf(p.id);
  if (i >= 0) return `Rotation #${i + 1}${i === staff.next ? ' · next in turn' : ''}`;
  return ROLE_LABEL[staffRole(staff, p.id)];
}

/** A staff with a pitcher placed in a bullpen role (freed from any other role). */
export function withRole(staff: PitchingStaff, role: BullpenRole, id: string | null): PitchingStaff {
  const next: PitchingStaff = { ...staff, rotation: id ? staff.rotation.filter((x) => x !== id) : staff.rotation };
  if (id) for (const r of BULLPEN_ROLES) if (next[r] === id) next[r] = null;
  return { ...next, [role]: id };
}

/** A staff with a pitcher added to the end of the rotation (freed from a bullpen role). */
export function withRotation(staff: PitchingStaff, id: string): PitchingStaff {
  const next: PitchingStaff = { ...staff, rotation: [...staff.rotation.filter((x) => x !== id), id] };
  for (const r of BULLPEN_ROLES) if (next[r] === id) next[r] = null;
  return next;
}

export function RoleCards({ state, staff, todayStarterId, busy, onPick }: { state: GameState; staff: PitchingStaff; todayStarterId?: string; busy: boolean; onPick: (role: BullpenRole) => void }) {
  return (
    <div className="role-cards">
      {BULLPEN_ROLES.map((role) => {
        const id = staff[role];
        const p = id ? state.players[id] : null;
        const out = p ? lastOuting(state, p) : null;
        return (
          <div key={role} className={`role-card role-${role} ${p ? '' : 'empty'}`}>
            <h3>{ROLE_LABEL[role]}</h3>
            <p className="rc-when">{ROLE_WHEN[role]}</p>
            {p ? (
              <>
                <div className="rc-player">
                  <Portrait state={state} player={p} size={56} nested />
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
                  {p.id === todayStarterId ? (
                    <strong>Starting today: not in the bullpen</strong>
                  ) : (
                    <>
                      {pitcherReadiness(state, p, role)}
                      {out ? ` · Last outing: ${out.when}, ${out.detail}` : ''}
                    </>
                  )}
                </p>
                <button className="btn btn-small btn-secondary rc-change" onClick={() => onPick(role)} disabled={busy}>
                  Change
                </button>
              </>
            ) : (
              <button className="rc-assign" onClick={() => onPick(role)} disabled={busy}>
                + Assign pitcher
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}

/**
 * Pick a pitcher for a slot (a bullpen role or the rotation), from the same
 * rows as the lists. Picking someone with another role moves him here.
 */
export function PitcherPicker({
  state,
  staff,
  title,
  help,
  candidates,
  current,
  readinessFor,
  todayStarterId,
  onPick,
  onClear,
  onClose,
}: {
  state: GameState;
  staff: PitchingStaff;
  title: string;
  help: string;
  candidates: Player[];
  current: string | null;
  readinessFor: StaffRole;
  todayStarterId?: string;
  onPick: (id: string) => void;
  onClear?: () => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.querySelector<HTMLButtonElement>('button')?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal role-picker" role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()} ref={ref}>
        <header className="rp-head">
          <h2>{title}</h2>
          <button className="icon-btn small" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </header>
        <p className="small muted">{help}</p>
        {candidates.length === 0 ? (
          <p className="muted">No pitcher available for this.</p>
        ) : (
          <ul className="p-list compact">
            {candidates.map((p) => {
              const isCurrent = p.id === current;
              return (
                <PitcherRow
                  key={p.id}
                  state={state}
                  player={p}
                  role={staffRoleText(staff, p)}
                  readiness={p.id === todayStarterId ? 'Starting today' : pitcherReadiness(state, p, readinessFor)}
                  selected={isCurrent}
                  showMorale={false}
                  action={
                    isCurrent ? (
                      <span className="starting-btn">
                        <Icon name="check" size={16} /> Current
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
        )}
        {current && onClear && (
          <button className="link" onClick={onClear}>
            Leave the role empty
          </button>
        )}
      </div>
    </div>
  );
}
