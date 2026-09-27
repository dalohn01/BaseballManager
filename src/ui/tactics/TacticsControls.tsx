import { useEffect, useRef, useState } from 'react';
import type { TacticScope } from '../../application/engine';
import { AREA_LABEL, matchChangeSummary, optionLabel, relevantAreas, resolveTactic, STYLE_OPTIONS, TACTIC_AREAS, teamPlan } from '../../domain/tactics';
import { playerName, userClub } from '../../domain/state';
import type { Player, TacticArea } from '../../domain/types';
import { useController, useGame, useSnapshot } from '../hooks';

/** Three choices for one area, with one sentence on the upside and the cost of the chosen option. */
export function StylePicker({ area, value, onChange, usual, extra }: { area: TacticArea; value: string; onChange: (v: string) => void; usual?: string; extra?: { value: string; label: string } }) {
  const opts = [...(extra ? [{ value: extra.value, label: extra.label, explain: '' }] : []), ...STYLE_OPTIONS[area]];
  const chosen = STYLE_OPTIONS[area].find((o) => o.value === value);
  const busy = useSnapshot().busy;
  return (
    <div className="style-picker">
      <div className="style-picker-head">
        <strong>{AREA_LABEL[area]}</strong>
        {usual && usual !== value && <span className="tag tag-neutral">Usual: {optionLabel(area, usual)}</span>}
      </div>
      <div className="segmented" role="radiogroup" aria-label={AREA_LABEL[area]}>
        {opts.map((o) => (
          <button key={o.value} role="radio" aria-checked={value === o.value} className={value === o.value ? 'on' : ''} disabled={busy} onClick={() => value !== o.value && onChange(o.value)}>
            {o.label}
          </button>
        ))}
      </div>
      <p className="small muted style-explain">{chosen ? chosen.explain : 'Follows the team plan.'}</p>
    </div>
  );
}

/** The team's three settings; "default" edits the saved style, "match" the next match only. */
export function TeamStyleEditor({ scope }: { scope: TacticScope }) {
  const s = useGame();
  const c = useController();
  const tac = userClub(s).tactics;
  return (
    <div className="style-editor">
      {TACTIC_AREAS.map((area) => (
        <StylePicker
          key={area}
          area={area}
          value={scope === 'default' ? tac.style[area] : teamPlan(tac, area)}
          usual={scope === 'match' ? tac.style[area] : undefined}
          onChange={(value) => void c.dispatch({ type: 'setTeamStyle', area, value, scope })}
        />
      ))}
    </div>
  );
}

/** A player's exceptions, only for areas that matter for his role. */
export function InstructionsEditor({ player, scope }: { player: Player; scope: TacticScope }) {
  const s = useGame();
  const c = useController();
  const tac = userClub(s).tactics;
  const areas = relevantAreas(player);
  const current = (area: TacticArea) => {
    const saved = tac.instructions[player.id]?.[area] ?? 'team';
    return scope === 'default' ? saved : (tac.matchInstructions[player.id]?.[area] ?? saved);
  };
  const own = areas.filter((a) => current(a) !== 'team');
  return (
    <div className="style-editor">
      {areas.map((area) => {
        const team = teamPlan(tac, area);
        const v = current(area);
        return (
          <div key={area}>
            <StylePicker area={area} value={v} extra={{ value: 'team', label: `Follow team (${optionLabel(area, team)})` }} onChange={(value) => void c.dispatch({ type: 'setInstruction', playerId: player.id, area, value, scope })} />
            {v !== 'team' && v !== team && (
              <p className="instr-diff small">
                Differs from the team: {player.lastName} plays {optionLabel(area, v)}, the team {optionLabel(area, team)}.
              </p>
            )}
          </div>
        );
      })}
      {own.length > 0 && (
        <button className="btn btn-small btn-secondary" onClick={() => own.forEach((area) => void c.dispatch({ type: 'setInstruction', playerId: player.id, area, value: 'team', scope }))}>
          Reset to Follow team
        </button>
      )}
    </div>
  );
}

/** Short status for a player: "Follow team" or his own instructions. */
export function instructionSummary(s: ReturnType<typeof useGame>, player: Player): string {
  const tac = userClub(s).tactics;
  const own = relevantAreas(player)
    .map((area) => ({ area, r: resolveTactic(tac, player.id, area) }))
    .filter((x) => x.r.source === 'instruction' || x.r.source === 'matchInstruction');
  return own.length ? own.map((x) => `${AREA_LABEL[x.area]}: ${optionLabel(x.area, x.r.value)}${x.r.source === 'matchInstruction' ? ' (this match)' : ''}`).join(' · ') : 'Follow team';
}

/**
 * Tactics opened from the lineup view: This match only by default, with a
 * clear switch to save as the new default. The lineup draft is untouched.
 */
export function TacticsDialog({ playerId, onClose }: { playerId: string | null; onClose: () => void }) {
  const s = useGame();
  const [scope, setScope] = useState<TacticScope>('match');
  const closeRef = useRef<HTMLButtonElement>(null);
  const player = playerId ? s.players[playerId] : null;
  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal tactics-modal" role="dialog" aria-modal="true" aria-label={player ? `Instructions for ${playerName(player)}` : 'Adjust tactics'} onClick={(e) => e.stopPropagation()}>
        <header className="cm-head">
          <h2>{player ? `Instructions · ${playerName(player)}` : 'Adjust tactics'}</h2>
          <button ref={closeRef} className="icon-btn" aria-label="Close" onClick={onClose}>
            ✕
          </button>
        </header>
        <div className="tactics-body">
          <div className="segmented scope-pick" role="radiogroup" aria-label="Applies to">
            <button role="radio" aria-checked={scope === 'match'} className={scope === 'match' ? 'on' : ''} onClick={() => setScope('match')}>
              This match only
            </button>
            <button role="radio" aria-checked={scope === 'default'} className={scope === 'default' ? 'on' : ''} onClick={() => setScope('default')}>
              Save as new default
            </button>
          </div>
          <p className="small muted">
            {scope === 'match' ? 'Changes end after this match; your usual plan stays as it is.' : 'Changes become the usual plan for every match from now on.'}
          </p>
          {player ? <InstructionsEditor player={player} scope={scope} /> : <TeamStyleEditor scope={scope} />}
          <MatchPlanSummary />
          <button className="btn btn-primary" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

/** Compact summary of match-only changes with "Reset to usual plan". Renders nothing without changes. */
export function MatchPlanSummary() {
  const s = useGame();
  const c = useController();
  const items = matchChangeSummary(userClub(s), (id) => s.players[id]?.lastName ?? '?');
  if (!items.length) return null;
  return (
    <div className="match-plan" role="status">
      <span>
        <strong>This match:</strong> {items.join(' · ')}
      </span>
      <button className="btn btn-small btn-secondary" onClick={() => void c.dispatch({ type: 'resetMatchTactics' })}>
        Reset to usual plan
      </button>
    </div>
  );
}
