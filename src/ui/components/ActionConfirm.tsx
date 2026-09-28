import { useState } from 'react';
import type { ActionKind } from '../../domain/state';
import { actionPreview } from '../../simulation/actions';
import { money } from '../format';
import { useController, useGame, useSnapshot } from '../hooks';
import { Icon } from './icons';

/**
 * A direct manager action: a button that opens a short confirmation with the
 * concrete effect, cost, duration, cooldown and balance after paying. Nothing
 * is spent until Confirm; the command itself re-checks everything.
 */
export function ActionConfirm({ kind, target = null, option = null, label, compact }: { kind: ActionKind; target?: string | null; option?: string | null; label?: string; compact?: boolean }) {
  const s = useGame();
  const c = useController();
  const snap = useSnapshot();
  const [open, setOpen] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const pv = actionPreview(s, kind, target, option);
  const costText = `${pv.cost.influence} Influence${pv.cost.cash ? ` + ${money(pv.cost.cash)}` : ''}`;

  const confirm = () => {
    void c.dispatch({ type: 'managerAction', kind, target, option, revision: s.revision }).then((ok) => {
      if (ok) {
        setOpen(false);
        setDone(`${pv.title}: done.`);
      }
    });
  };

  return (
    <div className={`action ${compact ? 'compact' : ''}`}>
      {!open ? (
        <button className="btn btn-secondary btn-small action-open" onClick={() => { setDone(null); setOpen(true); }} disabled={snap.busy} title={pv.blocker ?? undefined}>
          {label ?? pv.title} <span className="action-cost"><Icon name="influence" size={14} /> {costText}</span>
        </button>
      ) : (
        <div className="action-confirm" role="group" aria-label={`Confirm ${pv.title}`}>
          <strong>{pv.title}</strong>
          <p>{pv.effect}</p>
          <dl className="action-facts">
            <div>
              <dt>Cost</dt>
              <dd>{costText} · no Time</dd>
            </div>
            <div>
              <dt>Duration</dt>
              <dd>{pv.duration}</dd>
            </div>
            <div>
              <dt>Limit</dt>
              <dd>{pv.cooldown}</dd>
            </div>
            <div>
              <dt>Influence after</dt>
              <dd>{Math.floor(pv.balanceAfter)}</dd>
            </div>
          </dl>
          {pv.blocker && (
            <p className="blocker" role="note">
              <Icon name="warning" size={16} /> {pv.blocker}
            </p>
          )}
          <div className="action-buttons">
            <button className="btn btn-primary btn-small" onClick={confirm} disabled={!!pv.blocker || snap.busy}>
              Confirm · {costText}
            </button>
            <button className="btn btn-secondary btn-small" onClick={() => setOpen(false)}>
              Cancel
            </button>
          </div>
        </div>
      )}
      {done && !open && (
        <p className="small action-done" role="status">
          <Icon name="check" size={14} /> {done}
        </p>
      )}
    </div>
  );
}
