import { dayKind } from '../../domain/calendar';
import { useState } from 'react';
import { BALANCE } from '../../balance/config';
import { moodLabel } from '../../domain/mood';
import type { CycleRecord } from '../../domain/state';
import { absoluteRound, clubPlayers, userClub } from '../../domain/state';
import { boardCheckpoints } from '../../events/planner';
import { actionPreview } from '../../simulation/actions';
import { drift, forecast, squadMean } from '../../simulation/cycle';
import { ActionConfirm } from '../components/ActionConfirm';
import { Panel } from '../components/common';
import { Icon } from '../components/icons';
import { money } from '../format';
import { useGame } from '../hooks';

const one = (n: number) => n.toFixed(1);
const signed1 = (n: number) => `${n >= 0 ? '+' : '−'}${Math.abs(n).toFixed(2)}`;

/**
 * Club → Influence: the manager's room for own initiatives. Shows the balance
 * and cap, where the next income comes from (board, fans and players, equal
 * weight), the fixed rhythm of a match cycle, and the direct board and fan
 * initiatives. Player initiatives live on each player's profile.
 */
export function InfluenceView() {
  const s = useGame();
  const club = userClub(s);
  const fc = forecast(s);
  const cap = BALANCE.influence.cap;
  const rows = [
    { key: 'board', label: 'Board', value: club.ownerConfidence, actor: 'owners' as const, next: fc.board, contrib: fc.contributions.board },
    { key: 'fans', label: 'Fans', value: club.fanSupport, actor: 'fans' as const, next: fc.fans, contrib: fc.contributions.fans },
    { key: 'players', label: 'Players (squad average)', value: squadMean(s), actor: 'player' as const, next: fc.players, contrib: fc.contributions.players },
  ];
  return (
    <div className="inf-grid">
      <Panel title="Influence">
        <div className="inf-balance">
          <Icon name="influence" size={30} />
          <div>
            <strong>
              {Math.floor(s.influence)} <small>/ {cap}</small>
            </strong>
            <span className="muted small">For your own initiatives: player talks and programs, facility builds, board meetings and fan activities. Refills only when a match cycle closes, never over time.</span>
          </div>
        </div>
        {s.influence > cap && <p className="small muted">Above the normal cap (from an older save): income pauses until the balance is below {cap}.</p>}
        <h3 className="subhead">Next refill (preliminary)</h3>
        <table className="inf-table">
          <thead>
            <tr>
              <th scope="col">Group</th>
              <th scope="col">Now</th>
              <th scope="col" title="Every close moves each value 5% of the way back toward 75">Toward 75</th>
              <th scope="col">Adds</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key}>
                <th scope="row">
                  {r.label}
                  <small className="muted"> {moodLabel(r.actor, r.value)}</small>
                </th>
                <td title={one(r.value)}>{Math.round(r.value)}</td>
                <td>{signed1(r.key === 'players' ? r.next - r.value : drift(r.value))}</td>
                <td>+{one(r.contrib)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <th scope="row" colSpan={3}>
                Expected income {fc.credited < fc.income ? `(cap: +${Math.floor(fc.credited)} of ${Math.floor(fc.income)})` : ''}
              </th>
              <td>+{Math.floor(fc.credited)}</td>
            </tr>
          </tfoot>
        </table>
        <p className="small muted">75 is neutral: values drift back toward it each cycle (further away → faster). Higher support earns more; 75 in all three gives 120. Preliminary: the next match and media still change support.</p>
        <Causes />
        <Rhythm />
      </Panel>

      <div className="inf-actions">
        <Panel title="Board">
          <BoardMeeting />
        </Panel>
        <Panel title="Fans">
          <p className="small muted">
            Fan support {Math.round(club.fanSupport)} · {moodLabel('fans', club.fanSupport)}
          </p>
          <ActionConfirm kind="communityInitiative" />
          <Fundraiser />
        </Panel>
        <Panel title="Recent cycles">
          <CycleLog records={s.cycle.log.slice(-5).reverse()} />
        </Panel>
      </div>
    </div>
  );
}

/**
 * Why the values are where they are: recent changes (already applied when they
 * happened, never again at the close) and ongoing problems that keep acting
 * each game, such as a player unhappy with his role.
 */
function Causes() {
  const s = useGame();
  const club = userClub(s);
  const starting = new Set([...club.lineup.battingOrder.map((x) => x.playerId), club.lineup.pitcherId]);
  const roleIssues = clubPlayers(s, club.id).filter((p) => !p.isPitcher && !starting.has(p.id) && (p.priority === 'playingTime' || p.role === 'starter'));
  const promises = s.promises.filter((p) => p.status === 'active');
  const recent = (list: { delta: number; text: string }[]) =>
    list.slice(0, 2).map((r) => `${r.text} (${r.delta > 0 ? '+' : '−'}${Math.abs(Math.round(r.delta))})`).join(' · ') || 'nothing recent';
  return (
    <details className="causes">
      <summary>What moves these values</summary>
      <ul className="small">
        <li>
          <strong>Board:</strong> {recent(club.reasons.ownerConfidence)}
        </li>
        <li>
          <strong>Fans:</strong> {recent(club.reasons.fanSupport)}
        </li>
        <li>
          <strong>Players:</strong>{' '}
          {roleIssues.length
            ? `${roleIssues.length} outside the lineup want to play (${roleIssues.map((p) => p.lastName).join(', ')}): each game on the bench costs happiness.`
            : 'no ongoing role problems.'}
          {promises.length ? ` ${promises.length} active promise${promises.length > 1 ? 's' : ''} of starts.` : ''}
        </li>
      </ul>
      <p className="small muted">Changes are applied when they happen (events, matches, media). A close only adds the drift toward 75 — nothing is counted twice.</p>
    </details>
  );
}

/** The fixed rhythm and the next board checkpoint (not every random event in advance). */
function Rhythm() {
  const s = useGame();
  const phase = s.currentEvent?.phase ?? (dayKind(s.calendar) === 'match' ? 'media' : 'club');
  const steps = [
    { key: 'club', label: 'Club' },
    { key: 'match', label: 'Lineup & match' },
    { key: 'media', label: 'Media' },
  ];
  const next = boardCheckpoints().find((c) => !s.cycle.boardChecks.includes(`${s.calendar.season}:${c.key}`));
  return (
    <div className="rhythm">
      <ol aria-label="Match cycle">
        {steps.map((st) => (
          <li key={st.key} className={phase === st.key ? 'now' : ''} aria-current={phase === st.key ? 'step' : undefined}>
            {st.label}
          </li>
        ))}
        <li>Refill</li>
      </ol>
      {next && s.calendar.phase === 'regular' && (
        <p className="small muted">
          Next board checkpoint: round {next.round} ({next.template === 'board_checkin' ? "owners' check-in" : 'progress review, only if behind the goal'}).
        </p>
      )}
    </div>
  );
}

function BoardMeeting() {
  const s = useGame();
  const [option, setOption] = useState<string>('present');
  const pv = actionPreview(s, 'boardMeeting', null, option);
  const club = userClub(s);
  return (
    <div className="board-meeting">
      <p className="small muted">
        Owner confidence {Math.round(club.ownerConfidence)} · {moodLabel('owners', club.ownerConfidence)}. A meeting buys the chance to raise one item; outcomes below are exact.
      </p>
      <div className="agenda" role="radiogroup" aria-label="Agenda">
        {pv.options!.map((o) => (
          <label key={o.id} className={`agenda-item ${option === o.id ? 'on' : ''} ${o.blocker ? 'blocked' : ''}`}>
            <input type="radio" name="agenda" value={o.id} checked={option === o.id} onChange={() => setOption(o.id)} />
            <span>
              <strong>{o.label}</strong>
              <small>{o.blocker ?? o.effect}</small>
            </span>
          </label>
        ))}
      </div>
      <ActionConfirm kind="boardMeeting" option={option} label="Hold a board meeting" />
    </div>
  );
}

function Fundraiser() {
  const s = useGame();
  const f = s.actions.fundraiser;
  return (
    <div className="fundraiser">
      {f ? (
        <p className="small">
          <Icon name="fans" size={16} /> Fundraiser for {f.purpose.toLowerCase()} running: ends after {f.endsAt - s.cycle.matchesPlayed} more game{f.endsAt - s.cycle.matchesPlayed === 1 ? '' : 's'}.
        </p>
      ) : (
        <ActionConfirm kind="fundraiser" />
      )}
      {s.actions.earmarked > 0 && <p className="small">Raised for facility upgrades: {money(s.actions.earmarked)} (used as a credit on the next upgrade).</p>}
    </div>
  );
}

function CycleLog({ records }: { records: CycleRecord[] }) {
  const s = useGame();
  if (!records.length) return <p className="muted small">No cycle has closed yet. The first refill comes after the first league game's media.</p>;
  return (
    <ol className="cycle-log">
      {records.map((r) => (
        <li key={r.id}>
          <strong>
            Round {r.round}
            {r.season !== s.calendar.season ? `, season ${r.season}` : ''}: Influence +{Math.floor(r.credited)}
          </strong>
          {r.credited < r.income && <small className="muted"> (cap; {Math.floor(r.income)} earned)</small>}
          <small className="muted">
            Board {one(r.board.before)} → {one(r.board.after)} ({signed1(r.board.drift)}) · Fans {one(r.fans.before)} → {one(r.fans.after)} ({signed1(r.fans.drift)}) · Players {one(r.players.before)} → {one(r.players.after)}
          </small>
        </li>
      ))}
    </ol>
  );
}

/** The latest refill, shown quietly when the next club phase opens (already saved; nothing to claim). */
export function CycleNotice() {
  const s = useGame();
  const ev = s.currentEvent;
  const last = s.cycle.log.at(-1);
  const cal = s.calendar;
  if (!last || cal.phase !== 'regular' || dayKind(cal) !== 'club' || (ev && ev.phase !== 'club') || absoluteRound(cal.season, cal.round) !== absoluteRound(last.season, last.round) + 1) return null;
  return (
    <p className="cycle-notice" role="status">
      <Icon name="influence" size={16} /> Round {last.round} closed: Influence +{Math.floor(last.credited)}
      {last.credited < last.income ? ` (cap reached; ${Math.floor(last.income)} earned)` : ''} · Board {Math.round(last.board.after)} · Fans {Math.round(last.fans.after)} · Players {Math.round(last.players.after)}
    </p>
  );
}
