import { useState } from 'react';
import { releaseBlocker, releaseCost } from '../../application/engine';
import { effectiveRating } from '../../domain/lineup';
import { BALANCE } from '../../balance/config';
import { fitnessLabel, moodLabel, moodThresholds } from '../../domain/mood';
import { playerName, userClub } from '../../domain/state';
import type { RatingKey } from '../../domain/types';
import { Avatar } from '../components/art';
import { Meter, OvrBadge, Panel, RatingBar, ReasonList, Ribbon } from '../components/common';
import { overall, overallTier, potentialOverall, TIER_LABEL } from '../../domain/ratings';
import { Icon } from '../components/icons';
import { avg3, era, ip, moneyExact, potentialLabel, PRIORITY_LABEL, PRIORITY_TEXT, ROLE_LABEL } from '../format';
import { href, useController, useGame, useSnapshot } from '../hooks';
import { instructionSummary, InstructionsEditor } from '../tactics/TacticsControls';

const HITTER_KEYS: RatingKey[] = ['contact', 'power', 'speed', 'fielding'];
const PITCHER_KEYS: RatingKey[] = ['pitching', 'fielding'];
const ICONS: Record<RatingKey, 'bat' | 'chart' | 'forward' | 'glove' | 'influence'> = {
  contact: 'bat',
  power: 'chart',
  speed: 'forward',
  fielding: 'glove',
  pitching: 'influence',
};

export function PlayerScreen({ id }: { id: string }) {
  const s = useGame();
  const p = s.players[id];
  if (!p) {
    return (
      <div className="page">
        <p>That player is no longer with the club.</p>
        <a href={href('team')}>Back to roster</a>
      </div>
    );
  }
  const club = s.clubs[p.clubId] as (typeof s.clubs)[string] | undefined;
  const look = club ?? userClub(s);
  const pot = potentialOverall(p);
  const keys = p.isPitcher ? PITCHER_KEYS : HITTER_KEYS;
  const development = s.history
    .flatMap((h) => h.effects.filter((e) => e.targetId === p.id && (keys as string[]).includes(e.stat)).map((e) => ({ ...e, round: h.round, title: h.title, choice: h.choice })))
    .reverse();
  const lastGain = new Map<string, number>();
  for (const d of development) if (!lastGain.has(d.stat) && d.round >= (s.currentEvent?.round ?? s.calendar.round) - 3) lastGain.set(d.stat, d.after - d.before);
  const inLineup = userClub(s).lineup.battingOrder.some((x) => x.playerId === p.id) || userClub(s).lineup.pitcherId === p.id;
  const th = moodThresholds(p.satisfaction);

  return (
    <div className="page">
      {/* Portraits link here from many views (lineup, match, events): Back returns to where you came from. */}
      <a
        className="back"
        href={href('team')}
        onClick={(e) => {
          if (history.length > 1) {
            e.preventDefault();
            history.back();
          }
        }}
      >
        <Icon name="back" size={18} /> Back
      </a>
      <div className="profile-grid">
        <Panel className="profile-card">
          <div className="profile-portrait" style={{ background: `linear-gradient(160deg, ${look.colors.primary}22, #dfe9f6)` }}>
            <Avatar player={p} club={look} size={180} />
          </div>
          <dl className="facts">
            <div>
              <dt>Bats / Throws</dt>
              <dd>
                {p.bats} / {p.throws}
              </dd>
            </div>
            <div>
              <dt>Role</dt>
              <dd>{ROLE_LABEL[p.role]}</dd>
            </div>
            <div>
              <dt>Lineup</dt>
              <dd>{inLineup ? 'Starting next game' : 'Bench'}</dd>
            </div>
            <div>
              <dt>Joined</dt>
              <dd>Season {p.joinedSeason}</dd>
            </div>
          </dl>
          <h3 className="subhead">Contract</h3>
          <dl className="facts">
            <div>
              <dt>Club</dt>
              <dd>{club ? `${club.city} ${club.name}` : 'Free agent'}</dd>
            </div>
            <div>
              <dt>Salary</dt>
              <dd>{moneyExact(p.contract.salary)} / season</dd>
            </div>
            <div>
              <dt>Remaining</dt>
              <dd>
                {p.contract.seasonsLeft} season{p.contract.seasonsLeft === 1 ? '' : 's'}
              </dd>
            </div>
          </dl>
          {p.clubId === s.userClubId && <ReleaseControl id={p.id} />}
        </Panel>

        <div className="profile-main">
          <Panel className="profile-head">
            <div className="name-ovr">
              <OvrBadge player={p} size="lg" />
              <div>
                <h1 className="player-name">{playerName(p)}</h1>
                <p className="player-meta">
                  #{p.number} · {p.isPitcher ? 'Pitcher' : p.positions.join(' / ')} · Age {p.age}
                </p>
                <span className="pot-ovr">
                  {TIER_LABEL[overallTier(overall(p))]} · Potential OVR {pot.low}–{pot.high}
                </span>
              </div>
            </div>
            {p.bio && <p className="muted">{p.bio}</p>}
            <div className="abilities">
              <Ribbon>Player abilities</Ribbon>
              <span className="muted small right">Ratings out of 100 · bar under shows progress to next point</span>
              <ul>
                {keys.map((k) => (
                  <li key={k}>
                    <Icon name={ICONS[k]} size={26} />
                    <span className="ab-name">{k}</span>
                    <span className="ab-bars">
                      <RatingBar value={p.ratings[k]} />
                      <span className="progress-mini" aria-label={`Progress to next point: ${p.progress[k]} of 100`}>
                        <span style={{ width: `${p.progress[k]}%` }} />
                      </span>
                    </span>
                    <span className="ab-value">
                      {p.ratings[k]}
                      {lastGain.get(k) ? <span className="gain">+{lastGain.get(k)}</span> : null}
                    </span>
                    <span className="ab-eff small muted" title="Rating used in matches after fitness and mood">
                      today {Math.round(effectiveRating(p, k))}
                    </span>
                  </li>
                ))}
              </ul>
              <p className="potential">
                <strong>Potential</strong> <span className="big">{potentialLabel(pot.low, pot.high)}</span>
                <span className="muted">
                  Scouting estimate: OVR {pot.low}–{pot.high} (best rating {p.potentialEstimate.low}–{p.potentialEstimate.high})
                </span>
              </p>
            </div>
          </Panel>

          <Panel>
            <Ribbon>Season performance</Ribbon>
            {p.isPitcher ? (
              <div className="stat-grid">
                <Stat v={p.stats.pitchingStarts} l="Starts" />
                <Stat v={ip(p.stats.outsPitched)} l="Innings" />
                <Stat v={era(p.stats.runsAllowed, p.stats.outsPitched)} l="Runs / 9" />
                <Stat v={p.stats.strikeouts} l="Strikeouts" />
                <Stat v={p.stats.walksAllowed} l="Walks" />
                <Stat v={p.stats.hitsAllowed} l="Hits allowed" />
              </div>
            ) : (
              <div className="stat-grid">
                <Stat v={avg3(p.stats.h, p.stats.ab)} l="Batting average" />
                <Stat v={p.stats.hr} l="Home runs" />
                <Stat v={p.stats.rbi} l="Runs batted in" />
                <Stat v={p.stats.starts} l="Games started" />
                <Stat v={p.stats.h} l="Hits" />
                <Stat v={p.stats.sb} l="Stolen bases" />
              </div>
            )}
            {!p.isPitcher && <p className="small muted">{p.stats.ab} at-bats · {p.stats.bb} walks · {p.stats.so} strikeouts</p>}
            {p.pastSeasons.length > 0 && (
              <div className="table-wrap">
                <table className="standings small">
                  <caption className="sr-only">Previous seasons</caption>
                  <thead>
                    <tr>
                      <th scope="col">Season</th>
                      <th scope="col">Club</th>
                      <th scope="col">GS</th>
                      <th scope="col">{p.isPitcher ? 'IP' : 'AVG'}</th>
                      <th scope="col">{p.isPitcher ? 'RA9' : 'HR'}</th>
                      <th scope="col">{p.isPitcher ? 'K' : 'RBI'}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {p.pastSeasons.map((ps) => (
                      <tr key={ps.season}>
                        <td>{ps.season}</td>
                        <td>{s.clubs[ps.clubId]?.abbreviation ?? '—'}</td>
                        <td>{p.isPitcher ? ps.stats.pitchingStarts : ps.stats.starts}</td>
                        <td>{p.isPitcher ? ip(ps.stats.outsPitched) : avg3(ps.stats.h, ps.stats.ab)}</td>
                        <td>{p.isPitcher ? era(ps.stats.runsAllowed, ps.stats.outsPitched) : ps.stats.hr}</td>
                        <td>{p.isPitcher ? ps.stats.strikeouts : ps.stats.rbi}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>

          <Panel>
            <Ribbon>Recent development</Ribbon>
            {development.length === 0 ? (
              <p className="muted">No rating changes yet. Training builds progress toward the next point.</p>
            ) : (
              <ul className="dev-list">
                {development.slice(0, 5).map((d, i) => (
                  <li key={i}>
                    <strong>
                      {d.statLabel} {d.before} → {d.after}
                    </strong>{' '}
                    <span className="muted">
                      · {d.title} ({d.choice}) · Round {d.round}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>

        <Panel title="Player status" className="profile-status">
          <Meter label="Happiness" value={p.satisfaction} caption={`${moodLabel('player', p.satisfaction)}${th.below !== null ? ` · drops a level below ${th.below}` : ''}`} />
          <Meter label="Fitness" value={p.fitness} display={`${p.fitness}%`} caption={`${fitnessLabel(p.fitness)} · 100% = fully ready; each point below costs ${BALANCE.match.fitnessPenaltyPerPoint} rating`} tone={p.fitness < BALANCE.fitness.warnBelow ? 'warn' : 'slate'} />
          <Meter label="Popularity" value={p.popularity} caption="How much the fans love him" />
          <div className="status-item">
            <Icon name="trophy" size={30} />
            <div>
              <small>Motivation</small>
              <strong>{PRIORITY_LABEL[p.priority]}</strong>
              <span className="muted">{PRIORITY_TEXT[p.priority]}</span>
            </div>
          </div>
          {p.moodLog.length > 0 && (
            <div className="status-item block">
              <small>Why his mood changed</small>
              <ReasonList reasons={p.moodLog} />
            </div>
          )}
          {s.promises
            .filter((pr) => pr.playerId === p.id)
            .slice(-2)
            .reverse()
            .map((pr) => (
              <div className="status-item" key={pr.id}>
                <Icon name="clipboard" size={30} />
                <div>
                  <small>{pr.status === 'active' ? 'Active promise' : `Promise ${pr.status === 'void' ? 'lapsed' : pr.status}`}</small>
                  <strong>
                    Start {pr.threshold} of {pr.toRound - pr.fromRound + 1} games
                  </strong>
                  <span className="muted">
                    {pr.progress} of {pr.threshold} starts · made in round {pr.madeAt.round}
                    {pr.madeAt.season !== s.calendar.season ? `, season ${pr.madeAt.season}` : ''}
                  </span>
                  <span className="dots" aria-hidden="true">
                    {Array.from({ length: pr.threshold }, (_, i) => (
                      <span key={i} className={i < pr.progress ? 'dot on' : 'dot'} />
                    ))}
                  </span>
                </div>
              </div>
            ))}
          {p.lastReaction && (
            <div className="status-item">
              <Icon name="chat" size={30} />
              <div>
                <small>Recent reaction</small>
                <q>{p.lastReaction.text}</q>
                <span className="muted">{p.lastReaction.context}</span>
              </div>
            </div>
          )}
          {p.clubId === s.userClubId && <PlayerInstructions id={p.id} />}
        </Panel>
      </div>
    </div>
  );
}

/** Optional exceptions to the team plan; closed by default, "Follow team" unless changed. */
function PlayerInstructions({ id }: { id: string }) {
  const s = useGame();
  const p = s.players[id];
  const summary = instructionSummary(s, p);
  const own = summary !== 'Follow team';
  return (
    <details className="instr-panel">
      <summary>
        <span>Instructions</span>
        <span className={`tag ${own ? 'tag-warn' : 'tag-neutral'}`}>{own ? 'Own instructions' : 'Follow team'}</span>
      </summary>
      <p className="small muted">{own ? `Differs from the team plan: ${summary}.` : 'He plays the team plan. Add an exception only where it suits him.'} Applies from the next match.</p>
      <InstructionsEditor player={p} scope="default" />
    </details>
  );
}

function ReleaseControl({ id }: { id: string }) {
  const s = useGame();
  const c = useController();
  const snap = useSnapshot();
  const [confirming, setConfirming] = useState(false);
  const blocker = releaseBlocker(s, id);
  const buyout = releaseCost(s, id);
  const p = s.players[id];
  if (!confirming) {
    return (
      <div className="release">
        <button className="btn btn-small btn-secondary" onClick={() => setConfirming(true)} disabled={!!blocker || snap.busy}>
          Release player…
        </button>
        {blocker && <small className="muted">{blocker}</small>}
      </div>
    );
  }
  return (
    <div className="release">
      <p className="blocker">
        Release {p.lastName}? Buyout {moneyExact(buyout)} now. He leaves the club for good. No Time cost.
      </p>
      <div className="lineup-actions">
        <button
          className="btn btn-small btn-secondary"
          onClick={async () => {
            if (await c.dispatch({ type: 'releasePlayer', playerId: id })) location.hash = '#/team';
          }}
          disabled={snap.busy}
        >
          Yes, release
        </button>
        <button className="btn btn-small btn-secondary" onClick={() => setConfirming(false)}>
          Cancel
        </button>
      </div>
    </div>
  );
}

function Stat({ v, l }: { v: string | number; l: string }) {
  return (
    <div className="stat">
      <strong>{v}</strong>
      <span>{l}</span>
    </div>
  );
}
