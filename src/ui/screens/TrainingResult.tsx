import { useState } from 'react';
import type { EventInstance } from '../../domain/state';
import { playerName, userClub } from '../../domain/state';
import type { RatingKey } from '../../domain/types';
import { improvementsOf, nearNextStep, teamOvrChange, type PlayerImprovement } from '../../presentation/improvements';
import { ChangeValue } from '../components/ChangeValue';
import { EffectList } from '../components/common';
import { Icon } from '../components/icons';
import { PlayerAvatar } from '../components/PlayerAvatar';
import { OvrShield } from '../components/TeamOvr';
import { useGame } from '../hooks';
import { ContinueButton } from './EventCard';

const ICON: Record<RatingKey, 'bat' | 'chart' | 'forward' | 'glove' | 'influence' | 'check' | 'recovery'> = {
  contact: 'bat',
  power: 'chart',
  speed: 'forward',
  fielding: 'glove',
  pitching: 'influence',
  velocity: 'influence',
  control: 'check',
  stamina: 'recovery',
};

/** Training results show improvements when a session moved players' ratings or progress. */
export function isTrainingResult(ev: EventInstance): boolean {
  if (ev.type !== 'teamTraining' && ev.type !== 'individualTraining') return false;
  return (ev.resolution?.effects ?? []).some((e) => e.targetKind === 'player' && (['contact', 'power', 'speed', 'fielding', 'velocity', 'control', 'stamina'].includes(e.stat) || e.stat.endsWith('Progress')));
}

/**
 * The training result as news: whole rating steps first (one big card, or
 * compact cards in a grid), the team OVR when it moves, and the development
 * points behind "View breakdown". The animations only present changes that
 * are already saved; Continue is available at once.
 */
export function TrainingResult({ ev }: { ev: EventInstance }) {
  const s = useGame();
  const r = ev.resolution!;
  const [replay, setReplay] = useState(0);
  const [open, setOpen] = useState(false);
  const groups = improvementsOf(s, r.effects);
  const near = groups.length === 0 ? nearNextStep(s, r.effects) : [];
  const ovr = teamOvrChange(s, userClub(s).id, r.effects);
  const steps = groups.reduce((a, g) => a + g.rows.length, 0);
  const points = r.metrics?.developmentPoints;
  const sub =
    steps === 0
      ? 'No rating reached a new step this time.'
      : `${steps} attribute${steps === 1 ? '' : 's'} improved${groups.length > 1 ? ` across ${groups.length} players` : ''}.`;
  const quote = (id: string) => r.reactions.find((x) => x.playerId === id)?.text;
  // Many improvements overlap: each card starts a little after the previous one, never in a long sequence.
  const stagger = (i: number) => Math.min(i * 120, 600);
  const ovrUp = ovr && ovr.after !== ovr.before;

  return (
    <section className="event-card training-result" aria-live="polite" key={replay}>
      <p className="tr-kicker">
        <Icon name="bat" size={18} /> Training complete <span className="muted">· {r.optionLabel}</span>
      </p>
      <h1 className="tr-headline">{r.headline}</h1>
      <p className="tr-sub">{sub}</p>

      {groups.length === 1 ? (
        <BigCard g={groups[0]} quote={quote(groups[0].playerId)} />
      ) : groups.length > 1 ? (
        <ul className="tr-grid">
          {groups.map((g, i) => (
            <SmallCard key={g.playerId} g={g} delay={stagger(i)} />
          ))}
        </ul>
      ) : (
        <div className="tr-progress">
          <strong>Progress made</strong>
          {near.length > 0 ? (
            <ul>
              {near.map((n) => (
                <li key={n.playerId + n.key}>
                  <PlayerAvatar player={s.players[n.playerId]} club={userClub(s)} size={36} />
                  <span>
                    <b>{playerName(s.players[n.playerId])}</b> {n.label} {n.rating}
                  </span>
                  <span className="tr-near-bar" aria-label={`${n.progress} of 100 to the next step`}>
                    <span style={{ width: `${n.progress}%` }} />
                  </span>
                  <small className="muted">{n.progress}/100</small>
                </li>
              ))}
            </ul>
          ) : (
            <p className="small muted">Progress carries into the next session.</p>
          )}
        </div>
      )}

      {ovr && (
        <div className={`tr-ovr ${ovrUp ? 'up' : 'quiet'}`}>
          <OvrShield value={ovr.after} size={ovrUp ? 'lg' : 'xs'} />
          <div>
            <strong>Team overall</strong>
            {ovrUp ? <ChangeValue before={ovr.before} after={ovr.after} size="lg" delay={stagger(groups.length) + 300} /> : <span className="muted"> unchanged</span>}
          </div>
        </div>
      )}

      {points !== undefined && (
        <div className="tr-dev">
          <Icon name="chart" size={22} />
          <span>
            <strong>Squad development</strong>
            <small>{points} development points earned.</small>
          </span>
          <button className="link" aria-expanded={open} onClick={() => setOpen(!open)}>
            {open ? 'Hide breakdown' : 'View breakdown'} <Icon name="chevron" size={14} />
          </button>
        </div>
      )}
      {(open || points === undefined) && (
        <div className="tr-breakdown">
          <h2 className="subhead">What changed</h2>
          {r.narrative.map((n, i) => (
            <p key={i} className="small">
              {n}
            </p>
          ))}
          <EffectList effects={r.effects} />
        </div>
      )}

      <ContinueButton ev={ev} />
      {steps > 0 && (
        <button className="link tr-replay" onClick={() => setReplay(replay + 1)}>
          ↻ Replay improvement
        </button>
      )}
    </section>
  );
}

function BigCard({ g, quote }: { g: PlayerImprovement; quote?: string }) {
  const s = useGame();
  const p = s.players[g.playerId];
  return (
    <div className="tr-card big">
      <PlayerAvatar player={p} club={userClub(s)} size={132} />
      <div className="tr-card-main">
        <strong className="tr-name">{playerName(p)}</strong>
        {g.rows.map((row, i) => (
          <div key={row.key} className="tr-row">
            <span className="tr-attr">
              <Icon name={ICON[row.key]} size={22} /> {row.label}
            </span>
            <ChangeValue before={row.before} after={row.after} size="xl" delay={200 + i * 150} />
          </div>
        ))}
        {quote && <q className="tr-quote">{quote}</q>}
      </div>
    </div>
  );
}

function SmallCard({ g, delay }: { g: PlayerImprovement; delay: number }) {
  const s = useGame();
  const p = s.players[g.playerId];
  return (
    <li className="tr-card small" style={{ ['--tr-delay' as string]: `${delay}ms` }}>
      <PlayerAvatar player={p} club={userClub(s)} size={52} />
      <div className="tr-card-main">
        <strong className="tr-name">{playerName(p)}</strong>
        {g.rows.map((row, i) => (
          <div key={row.key} className="tr-row">
            <span className="tr-attr">
              <Icon name={ICON[row.key]} size={16} /> {row.label}
            </span>
            <ChangeValue before={row.before} after={row.after} size="md" delay={delay + 150 + i * 100} />
          </div>
        ))}
      </div>
    </li>
  );
}
