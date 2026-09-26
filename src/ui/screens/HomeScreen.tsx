import { useEffect, useRef } from 'react';
import { BALANCE } from '../../balance/config';
import { fitnessLabel, moodLabel } from '../../domain/mood';
import type { GameState } from '../../domain/state';
import { absoluteRound, clubName, clubPlayers, shortName, userClub } from '../../domain/state';
import { SLOT_LABELS } from '../../events/planner';
import { DIRECTION_LABEL, goalProgress } from '../../simulation/goals';
import { money } from '../format';
import { computeStandings } from '../../simulation/standings';
import { avg } from '../../simulation/training';
import { Crest } from '../components/art';
import { Meter, Panel } from '../components/common';
import { Icon } from '../components/icons';
import { href, useGame } from '../hooks';
import { MatchScene } from '../match/MatchScene';
import { PreMatchScreen } from '../prematch/PreMatchScreen';
import { EventCard } from './EventCard';

export function HomeScreen() {
  const s = useGame();
  const mainRef = useRef<HTMLDivElement>(null);
  const eventKey = `${s.currentEvent?.id}:${s.currentEvent?.status}`;
  // Bring the new event or its result into view after each decision.
  useEffect(() => {
    const el = mainRef.current;
    if (el && el.getBoundingClientRect().top < 0) el.scrollIntoView({ block: 'start' });
  }, [eventKey]);
  const ev = s.currentEvent;
  const liveMatch = ev?.type === 'leagueGame' && ev.status === 'resolved' && ev.resolution?.matchId ? s.matches[ev.resolution.matchId] : null;
  if (ev?.type === 'leagueGame' && ev.status === 'pending') {
    // Pre-match team selection replaces the old three-option choice.
    return (
      <div className="home" ref={mainRef}>
        <p className="crumb">
          Season {s.calendar.season} · {phaseLabel(s)}
        </p>
        <PreMatchScreen key={ev.id} ev={ev} />
      </div>
    );
  }
  if (ev && liveMatch?.sequence?.length) {
    // The visual match view takes over Home until the result has been continued past.
    return (
      <div className="home" ref={mainRef}>
        <p className="crumb">
          Season {s.calendar.season} · {phaseLabel(s)}
        </p>
        <MatchScene key={liveMatch.id} ev={ev} match={liveMatch} />
      </div>
    );
  }
  return (
    <div className="home">
      <p className="crumb">
        Season {s.calendar.season} · {phaseLabel(s)}
      </p>
      <div className="home-grid">
        <div className="home-main" ref={mainRef}>
          <EventCard />
        </div>
        <aside className="home-left">
          <SeasonGoal />
          <ClubStatus />
          <PlayerNotes />
        </aside>
        <aside className="home-right">
          <NextMatch />
          <Upcoming />
          <MiniTable />
        </aside>
      </div>
    </div>
  );
}

function phaseLabel(s: GameState): string {
  const ev = s.currentEvent;
  const round = ev?.round ?? s.calendar.round;
  if (round === 0) return 'Preseason';
  if (ev && ['draft', 'contracts', 'seasonReview'].includes(ev.type)) return 'Off-season';
  return `Round ${round}`;
}

export function SeasonGoal() {
  const s = useGame();
  const g = goalProgress(s);
  const active = s.promises.filter((p) => p.status === 'active');
  if (!g && active.length === 0) return null;
  return (
    <Panel title="Season goal" action={<a className="link small" href={href('club/finances')}>Details →</a>}>
      {g ? (
        <>
          <p className="goal-direction">
            <strong>{DIRECTION_LABEL[g.direction]}</strong>
            <span className={`tag ${g.met ? 'tag-good' : g.onTrack ? 'tag-neutral' : 'tag-bad'}`}>{g.met ? 'Met' : g.onTrack ? 'On track' : 'Behind'}</span>
          </p>
          {g.items.map((i) => (
            <Meter
              key={i.label}
              label={i.label}
              value={i.format === 'cash' ? Math.max(0, i.current) : i.current}
              max={Math.max(1, i.target)}
              tone={i.met ? 'blue' : 'slate'}
              display={i.format === 'cash' ? money(i.current) : undefined}
              caption={i.format === 'cash' ? `${money(i.current)} of ${money(i.target)}` : `${i.current} of ${i.target}`}
            />
          ))}
        </>
      ) : (
        <p className="muted small">No season plan agreed yet.</p>
      )}
      {active.map((pr) => (
        <p key={pr.id} className="small promise-line">
          <Icon name="clipboard" size={16} /> Promise: {shortName(s.players[pr.playerId])} {pr.progress}/{pr.threshold} starts (by round {pr.toRound - absoluteRound(s.calendar.season, 0)})
        </p>
      ))}
    </Panel>
  );
}

function ClubStatus() {
  const s = useGame();
  const club = userClub(s);
  const players = clubPlayers(s, club.id);
  const happy = Math.round(avg(players.map((p) => p.satisfaction)));
  const fitness = Math.round(avg(players.map((p) => p.fitness)));
  return (
    <Panel title="Club status">
      <Meter label="Owners" value={club.ownerConfidence} caption={`${moodLabel('owners', club.ownerConfidence)} · tap for reasons`} reasons={club.reasons.ownerConfidence} />
      <Meter label="Fans" value={club.fanSupport} caption={`${moodLabel('fans', club.fanSupport)} · tap for reasons`} reasons={club.reasons.fanSupport} />
      <Meter label="Player happiness" value={happy} caption="Team average — see Team for each player" />
      <Meter label="Fitness" value={fitness} display={`${fitness}%`} caption={`${fitnessLabel(fitness)} · squad average, 100% = fully ready`} tone={fitness < BALANCE.fitness.warnBelow ? 'warn' : 'slate'} />
    </Panel>
  );
}

function PlayerNotes() {
  const s = useGame();
  const players = clubPlayers(s, s.userClubId);
  const notes: { id: string; text: string; icon: 'person' | 'rest' | 'warning' }[] = [];
  for (const p of [...players].sort((a, b) => a.fitness - b.fitness)) {
    if (p.fitness < BALANCE.fitness.needsRestBelow && notes.length < 4) notes.push({ id: p.id, text: `Needs rest (${p.fitness}%)`, icon: 'rest' });
  }
  for (const p of [...players].sort((a, b) => a.satisfaction - b.satisfaction)) {
    if (p.satisfaction < 45 && notes.length < 4) notes.push({ id: p.id, text: `${moodLabel('player', p.satisfaction)}: ${p.moodLog[0]?.text ?? 'wants more'}`, icon: 'warning' });
  }
  for (const p of [...players].sort((a, b) => b.satisfaction - a.satisfaction)) {
    if (p.satisfaction >= 80 && notes.length < 4) notes.push({ id: p.id, text: 'Happy with his role', icon: 'person' });
  }
  return (
    <Panel title="Player notes" action={<a className="link small" href={href('team')}>View team →</a>}>
      {notes.length === 0 ? (
        <p className="muted">No one needs your attention right now.</p>
      ) : (
        <ul className="notes">
          {notes.map((n) => (
            <li key={n.id + n.text}>
              <Icon name={n.icon} size={26} />
              <a href={href(`team/${n.id}`)}>
                <strong>{shortName(s.players[n.id])}</strong>
                <span>{n.text}</span>
              </a>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

function NextMatch() {
  const s = useGame();
  const ev = s.currentEvent;
  const season = s.calendar.season;
  const fromRound = ev?.round ?? s.calendar.round;
  const g = s.schedule.find((x) => x.season === season && x.round >= fromRound && !x.result && (x.homeId === s.userClubId || x.awayId === s.userClubId));
  if (!g) return <Panel title="Next match"><p className="muted">No games left this season.</p></Panel>;
  const home = s.clubs[g.homeId];
  const away = s.clubs[g.awayId];
  const eventsBefore = ev && ev.round === g.round && ev.type !== 'leagueGame' ? s.queue.filter((q) => q.kind === 'management').length + (ev.status === 'pending' ? 1 : 0) : null;
  return (
    <Panel title="Next match">
      <div className="nm-teams">
        <div>
          <Crest club={home} size={54} />
          <span>{clubName(home)}</span>
        </div>
        <span className="vs">VS</span>
        <div>
          <Crest club={away} size={54} />
          <span>{clubName(away)}</span>
        </div>
      </div>
      <p className="nm-meta">
        {g.homeId === s.userClubId ? 'Home' : 'Away'} · Round {g.round}
      </p>
      {eventsBefore !== null && eventsBefore > 0 && <p className="nm-when">After {eventsBefore} event{eventsBefore > 1 ? 's' : ''}</p>}
      {ev?.type === 'leagueGame' && ev.status === 'pending' && <p className="nm-when">Up now</p>}
    </Panel>
  );
}

function Upcoming() {
  const s = useGame();
  const ev = s.currentEvent;
  if (!ev) return null;
  const items: { label: string; tag: string }[] = [];
  items.push({ tag: 'Now', label: ev.type === 'leagueGame' ? 'League game' : ev.title });
  const upcoming = s.nextEvent ? [{ templateId: s.nextEvent.templateId }, ...s.queue] : s.queue;
  upcoming.forEach((q, i) => items.push({ tag: i === 0 ? 'Next' : 'Later', label: SLOT_LABELS[q.templateId] ?? q.templateId }));
  if (items.length < 4) items.push({ tag: 'Later', label: `Round ${ev.round + 1} events` });
  return (
    <Panel title="Upcoming events">
      <ol className="timeline">
        {items.slice(0, 4).map((it, i) => (
          <li key={i} className={i === 0 ? 'now' : ''}>
            <span className="tl-dot">{i + 1}</span>
            <span>
              <small>{it.tag}</small>
              <strong>{it.label}</strong>
            </span>
          </li>
        ))}
      </ol>
    </Panel>
  );
}

function MiniTable() {
  const s = useGame();
  const table = computeStandings(s);
  return (
    <Panel title="Standings" action={<a className="link small" href={href('league')}>Full table →</a>}>
      <table className="mini-table">
        <thead>
          <tr>
            <th scope="col">#</th>
            <th scope="col">Team</th>
            <th scope="col">W</th>
            <th scope="col">L</th>
          </tr>
        </thead>
        <tbody>
          {table.map((r, i) => (
            <tr key={r.clubId} className={r.clubId === s.userClubId ? 'me' : ''}>
              <td>{i + 1}</td>
              <td>{s.clubs[r.clubId].name}</td>
              <td>{r.wins}</td>
              <td>{r.losses}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Panel>
  );
}
