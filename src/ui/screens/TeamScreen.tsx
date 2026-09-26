import { useState } from 'react';
import { validateLineup } from '../../domain/lineup';
import { BALANCE } from '../../balance/config';
import { fitnessLabel, moodLabel } from '../../domain/mood';
import { clubPlayers, playerName, shortName, userClub } from '../../domain/state';
import type { Lineup, LineupPosition, Player } from '../../domain/types';
import { LINEUP_POSITIONS } from '../../domain/types';
import { Avatar } from '../components/art';
import { OvrBadge, Panel } from '../components/common';
import { overall, overallAt, primaryPosition } from '../../domain/ratings';
import { avg3, era, ROLE_LABEL } from '../format';
import { href, useController, useGame, useSnapshot } from '../hooks';

type Filter = 'all' | 'hitters' | 'pitchers' | 'lineup';
type Sort = 'ovr' | 'position' | 'age' | 'fitness';
const SORT_LABEL: Record<Sort, string> = { ovr: 'OVR', position: 'Position', age: 'Age', fitness: 'Fitness' };
const POS_ORDER = ['C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF', 'DH', 'P'];
const SORTS: Record<Sort, (a: Player, b: Player) => number> = {
  ovr: (a, b) => overall(b) - overall(a),
  position: (a, b) => POS_ORDER.indexOf(primaryPosition(a)) - POS_ORDER.indexOf(primaryPosition(b)) || overall(b) - overall(a),
  age: (a, b) => a.age - b.age,
  fitness: (a, b) => a.fitness - b.fitness,
};

export function TeamScreen() {
  const s = useGame();
  const club = userClub(s);
  const [filter, setFilter] = useState<Filter>('all');
  const [sort, setSort] = useState<Sort>('ovr');
  const inLineup = new Set([...club.lineup.battingOrder.map((x) => x.playerId), club.lineup.pitcherId]);
  const players = clubPlayers(s, club.id)
    .filter((p) => (filter === 'hitters' ? !p.isPitcher : filter === 'pitchers' ? p.isPitcher : filter === 'lineup' ? inLineup.has(p.id) : true))
    .sort((a, b) => SORTS[sort](a, b) || a.id.localeCompare(b.id));
  return (
    <div className="page">
      <h1 className="page-title">Team</h1>
      <div className="team-grid">
        <Panel title="Roster">
          <div className="filters" role="group" aria-label="Filter players">
            {(['all', 'hitters', 'pitchers', 'lineup'] as Filter[]).map((f) => (
              <button key={f} className={`chip ${filter === f ? 'chip-on' : ''}`} aria-pressed={filter === f} onClick={() => setFilter(f)}>
                {f === 'lineup' ? 'In lineup' : f[0].toUpperCase() + f.slice(1)}
              </button>
            ))}
          </div>
          <div className="filters" role="group" aria-label="Sort players">
            <span className="muted small">Sort:</span>
            {(Object.keys(SORT_LABEL) as Sort[]).map((k) => (
              <button key={k} className={`chip ${sort === k ? 'chip-on' : ''}`} aria-pressed={sort === k} onClick={() => setSort(k)}>
                {SORT_LABEL[k]}
              </button>
            ))}
          </div>
          <div className="table-wrap">
            <table className="roster">
              <thead>
                <tr>
                  <th scope="col">Player</th>
                  <th scope="col" title="Overall rating at his primary position">OVR</th>
                  <th scope="col">Pos</th>
                  <th scope="col">Age</th>
                  <th scope="col" title="Contact / Pitching">CON/PIT</th>
                  <th scope="col">POW</th>
                  <th scope="col">SPD</th>
                  <th scope="col">FLD</th>
                  <th scope="col">Sat.</th>
                  <th scope="col" title="Fitness: match readiness, 100% = fully ready">Fit.</th>
                  <th scope="col">Stats</th>
                </tr>
              </thead>
              <tbody>
                {players.map((p) => (
                  <RosterRow key={p.id} p={p} starting={inLineup.has(p.id)} />
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
        <LineupEditor />
      </div>
    </div>
  );
}

function RosterRow({ p, starting }: { p: Player; starting: boolean }) {
  const s = useGame();
  return (
    <tr>
      <th scope="row">
        <a className="player-link" href={href(`team/${p.id}`)}>
          <Avatar player={p} club={s.clubs[p.clubId]} size={34} />
          <span>
            {playerName(p)}
            <small>
              {ROLE_LABEL[p.role]}
              {starting ? ' · in lineup' : ''}
            </small>
          </span>
        </a>
      </th>
      <td>
        <OvrBadge player={p} size="sm" />
      </td>
      <td>{p.isPitcher ? 'P' : p.positions.join('/')}</td>
      <td>{p.age}</td>
      <td className="num">{p.isPitcher ? p.ratings.pitching : p.ratings.contact}</td>
      <td className="num">{p.isPitcher ? '–' : p.ratings.power}</td>
      <td className="num">{p.ratings.speed}</td>
      <td className="num">{p.ratings.fielding}</td>
      <td className={`num ${p.satisfaction < 40 ? 'bad' : ''}`} title={moodLabel('player', p.satisfaction)}>
        {p.satisfaction}
      </td>
      <td className={`num ${p.fitness < BALANCE.fitness.warnBelow ? 'bad' : ''}`} title={fitnessLabel(p.fitness)}>
        {p.fitness}%
      </td>
      <td className="small">
        {p.isPitcher ? `${p.stats.pitchingStarts} GS, ${era(p.stats.runsAllowed, p.stats.outsPitched)} RA9` : `${avg3(p.stats.h, p.stats.ab)}, ${p.stats.hr} HR`}
      </td>
    </tr>
  );
}

/** Button/select-based lineup editor: no drag-and-drop required. */
function LineupEditor() {
  const s = useGame();
  const c = useController();
  const snap = useSnapshot();
  const club = userClub(s);
  const saved = JSON.stringify(club.lineup);
  const [draft, setDraft] = useState<Lineup>(club.lineup);
  const [base, setBase] = useState(saved);
  // Follow the saved lineup (auto lineup, pitcher rotation) unless the user has unsaved edits.
  if (base !== saved) {
    setBase(saved);
    if (JSON.stringify(draft) === base) setDraft(club.lineup);
  }
  const hitters = clubPlayers(s, club.id).filter((p) => !p.isPitcher);
  const pitchers = clubPlayers(s, club.id).filter((p) => p.isPitcher);
  const issues = validateLineup(s, club.id, draft);
  const errors = issues.filter((i) => i.severity === 'error');
  const dirty = JSON.stringify(draft) !== saved;

  const setSlot = (i: number, patch: Partial<{ playerId: string; position: LineupPosition }>) => {
    const order = draft.battingOrder.map((x) => ({ ...x }));
    if (patch.playerId) {
      const other = order.findIndex((x, j) => j !== i && x.playerId === patch.playerId);
      if (other >= 0) order[other].playerId = order[i].playerId; // swap
    }
    if (patch.position) {
      const other = order.findIndex((x, j) => j !== i && x.position === patch.position);
      if (other >= 0) order[other].position = order[i].position; // swap
    }
    order[i] = { ...order[i], ...patch };
    setDraft({ ...draft, battingOrder: order });
  };
  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= draft.battingOrder.length) return;
    const order = [...draft.battingOrder];
    [order[i], order[j]] = [order[j], order[i]];
    setDraft({ ...draft, battingOrder: order });
  };
  const save = () => c.dispatch({ type: 'setLineup', lineup: draft });
  const auto = async (mode: 'strongest' | 'rest') => {
    if (await c.dispatch({ type: 'autoLineup', mode })) {
      const next = c.getSnapshot().state!;
      setDraft(next.clubs[next.userClubId].lineup);
    }
  };
  const inOrder = new Set(draft.battingOrder.map((x) => x.playerId));
  const bench = hitters.filter((p) => !inOrder.has(p.id));

  return (
    <Panel title="Lineup" className="lineup-panel">
      <p className="muted small">Changing the lineup is free and never costs Time. It is used for the next league game when you pick “Your lineup”.</p>
      <div className="lineup-actions">
        <button className="btn btn-small btn-secondary" onClick={() => auto('strongest')} disabled={snap.busy}>
          Auto: strongest
        </button>
        <button className="btn btn-small btn-secondary" onClick={() => auto('rest')} disabled={snap.busy}>
          Auto: rest tired
        </button>
      </div>
      <ol className="lineup-list">
        {draft.battingOrder.map((slot, i) => {
          const p = s.players[slot.playerId];
          return (
            <li key={i}>
              <span className="order">{i + 1}</span>
              <label className="sr-only" htmlFor={`lp-${i}`}>
                Batter {i + 1}
              </label>
              <select id={`lp-${i}`} value={slot.playerId} onChange={(e) => setSlot(i, { playerId: e.target.value })}>
                {hitters.map((h) => (
                  <option key={h.id} value={h.id}>
                    {shortName(h)} · {overallAt(h, slot.position)} at {slot.position} ({h.positions.join('/')}) {h.fitness}%
                  </option>
                ))}
              </select>
              <label className="sr-only" htmlFor={`pos-${i}`}>
                Position for batter {i + 1}
              </label>
              <select id={`pos-${i}`} className={`pos-select ${slot.position !== 'DH' && !p.positions.includes(slot.position) ? 'oop' : ''}`} value={slot.position} onChange={(e) => setSlot(i, { position: e.target.value as LineupPosition })}>
                {LINEUP_POSITIONS.map((pos) => (
                  <option key={pos} value={pos}>
                    {pos}
                  </option>
                ))}
              </select>
              <span className="move">
                <button className="icon-btn small" onClick={() => move(i, -1)} disabled={i === 0} aria-label={`Move ${p.lastName} up`}>
                  ▲
                </button>
                <button className="icon-btn small" onClick={() => move(i, 1)} disabled={i === 8} aria-label={`Move ${p.lastName} down`}>
                  ▼
                </button>
              </span>
            </li>
          );
        })}
      </ol>
      <div className="sp-row">
        <label htmlFor="sp">Starting pitcher</label>
        <select id="sp" value={draft.pitcherId} onChange={(e) => setDraft({ ...draft, pitcherId: e.target.value })}>
          {pitchers.map((p) => (
            <option key={p.id} value={p.id}>
              {shortName(p)} — OVR {overall(p)}, fitness {p.fitness}%
            </option>
          ))}
        </select>
      </div>
      <p className="small muted">Bench: {bench.map((b) => `${shortName(b)} (${b.fitness}%)`).join(', ') || '—'}</p>
      {issues.length > 0 && (
        <ul className="issues">
          {issues.map((i, k) => (
            <li key={k} className={i.severity}>
              {i.severity === 'error' ? 'Error: ' : 'Note: '}
              {i.text}
            </li>
          ))}
        </ul>
      )}
      <div className="lineup-actions">
        <button className="btn btn-primary btn-small" onClick={save} disabled={!dirty || errors.length > 0 || snap.busy}>
          {dirty ? 'Save lineup' : 'Lineup saved'}
        </button>
        {dirty && (
          <button className="btn btn-small btn-secondary" onClick={() => setDraft(club.lineup)}>
            Discard changes
          </button>
        )}
      </div>
    </Panel>
  );
}
