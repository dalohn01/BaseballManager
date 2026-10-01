import { useEffect, useId, useRef, useState } from 'react';
import { BALANCE } from '../../balance/config';
import type { GameState } from '../../domain/state';
import { ovrDisplay, ovrProfile, teamOvr, type TeamOvr } from '../../domain/teamOvr';
import type { ClubId } from '../../domain/types';

const pct = (w: number) => `${Math.round(w * 100)}%`;

export const OVR_BASIS = 'Based on the regular lineup and pitching staff. Match readiness is shown separately.';

/**
 * The team OVR shield: navy and white, the number as real text. One shape and
 * meaning everywhere (no red–green scale, no 75 marker, no rarity colours).
 */
export function OvrShield({ value, size = 'sm' }: { value: number | null; size?: 'xs' | 'sm' | 'lg' }) {
  return (
    <span className={`ovr-shield ovr-${size}`}>
      <svg viewBox="0 0 40 46" aria-hidden="true">
        <path d="M20 1.5 37.5 7v15.5c0 11-7.5 18.5-17.5 22-10-3.5-17.5-11-17.5-22V7z" className="ovr-shape" />
        <path d="M20 5 34 9.5v13c0 9-6 15-14 18.2C12 37.5 6 31.5 6 22.5v-13z" className="ovr-inner" />
      </svg>
      <span className="ovr-num">{value === null ? '—' : value}</span>
      <span className="ovr-lbl">OVR</span>
    </span>
  );
}

/** A badge that opens the details: Team OVR, the three areas, a short profile and the basis. */
export function TeamOvrBadge({ state, clubId, size = 'sm', label }: { state: GameState; clubId: ClubId; size?: 'xs' | 'sm' | 'lg'; label?: string }) {
  const o = teamOvr(state, clubId);
  const club = state.clubs[clubId];
  // Placed against the window (fixed), so a scrolling table cannot clip it.
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const open = pos !== null;
  const id = useId();
  const wrap = useRef<HTMLSpanElement>(null);
  const toggle = () => {
    if (open) return setPos(null);
    const r = wrap.current!.getBoundingClientRect();
    const width = Math.min(300, window.innerWidth * 0.86);
    setPos({ top: r.bottom + 6, left: Math.max(8, Math.min(window.innerWidth - width - 8, r.left + r.width / 2 - width / 2)) });
  };
  useEffect(() => {
    if (!open) return;
    const close = () => setPos(null);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    const onDown = (e: MouseEvent) => !wrap.current?.contains(e.target as Node) && close();
    window.addEventListener('keydown', onKey);
    window.addEventListener('mousedown', onDown);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, [open]);
  const value = o ? ovrDisplay(o.overall) : null;
  return (
    <span className="ovr-badge" ref={wrap}>
      <button
        type="button"
        className="ovr-btn"
        aria-expanded={open}
        aria-controls={id}
        aria-label={`${label ?? club.name} Team OVR ${value ?? 'unavailable'}: show details`}
        onClick={toggle}
      >
        <OvrShield value={value} size={size} />
      </button>
      {open && (
        <div className="ovr-pop" id={id} role="dialog" aria-label={`${club.name} Team OVR`} style={{ top: pos.top, left: pos.left }}>
          <TeamOvrDetails o={o} name={`${club.city} ${club.name}`} />
        </div>
      )}
    </span>
  );
}

export function TeamOvrDetails({ o, name }: { o: TeamOvr | null; name?: string }) {
  if (!o) {
    return (
      <div className="ovr-details">
        {name && <small className="muted">{name}</small>}
        <strong className="ovr-title">— OVR</strong>
        <p className="small">Incomplete roster: a full lineup and pitching staff are needed for a team rating.</p>
      </div>
    );
  }
  return (
    <div className="ovr-details">
      {name && <small className="muted">{name}</small>}
      <strong className="ovr-title">Team OVR {ovrDisplay(o.overall)}</strong>
      <p className="ovr-parts">
        Batting {ovrDisplay(o.batting)} · Pitching {ovrDisplay(o.pitching)} · Defense {ovrDisplay(o.defense)}
      </p>
      <p className="ovr-profile">{ovrProfile(o)}</p>
      <p className="small muted">{OVR_BASIS} Not a match forecast.</p>
    </div>
  );
}

/** Team page block: a larger shield, the three areas with simple meters, the profile and the basis. */
export function TeamStrength({ state, clubId }: { state: GameState; clubId: ClubId }) {
  const o = teamOvr(state, clubId);
  return (
    <section className="panel team-strength" aria-label="Team OVR">
      <header className="panel-head">
        <h2>Team strength</h2>
      </header>
      <div className="panel-body ts-body">
        <OvrShield value={o ? ovrDisplay(o.overall) : null} size="lg" />
        {o ? (
          <div className="ts-areas">
            {(['batting', 'pitching', 'defense'] as const).map((k) => (
              <div key={k} className="ts-area">
                <span className="ts-label">{k[0].toUpperCase() + k.slice(1)}</span>
                <span className="ts-track" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={ovrDisplay(o[k])} aria-label={k}>
                  <span style={{ width: `${ovrDisplay(o[k])}%` }} />
                </span>
                <strong className="ts-value">{ovrDisplay(o[k])}</strong>
              </div>
            ))}
            <p className="ovr-profile">{ovrProfile(o)}</p>
            <p className="small muted">
              {OVR_BASIS} Weights: batting {pct(BALANCE.teamOvr.weights.batting)}, pitching {pct(BALANCE.teamOvr.weights.pitching)}, defense {pct(BALANCE.teamOvr.weights.defense)}. Bench players count only when they hold a regular place.
            </p>
          </div>
        ) : (
          <p className="small">Incomplete roster: a full lineup and pitching staff are needed for a team rating.</p>
        )}
      </div>
    </section>
  );
}
