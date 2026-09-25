import { useEffect, useRef } from 'react';
import { fatigueLabel, moodLabel } from '../../domain/mood';
import { clubName, clubPlayers, shortName, userClub } from '../../domain/state';
import { SLOT_LABELS } from '../../events/planner';
import { computeStandings } from '../../simulation/standings';
import { avg } from '../../simulation/training';
import { Crest } from '../components/art';
import { Meter, Panel } from '../components/common';
import { Icon } from '../components/icons';
import { href, useGame } from '../hooks';
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
  return (
    <div className="home">
      <p className="crumb">
        Season {s.calendar.season} · Round {s.currentEvent?.round ?? s.calendar.round}
      </p>
      <div className="home-grid">
        <div className="home-main" ref={mainRef}>
          <EventCard />
        </div>
        <aside className="home-left">
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

function ClubStatus() {
  const s = useGame();
  const club = userClub(s);
  const players = clubPlayers(s, club.id);
  const happy = Math.round(avg(players.map((p) => p.satisfaction)));
  const fatigue = Math.round(avg(players.map((p) => p.fatigue)));
  return (
    <Panel title="Club status">
      <Meter label="Owners" value={club.ownerConfidence} caption={`${moodLabel('owners', club.ownerConfidence)} · tap for reasons`} reasons={club.reasons.ownerConfidence} />
      <Meter label="Fans" value={club.fanSupport} caption={`${moodLabel('fans', club.fanSupport)} · tap for reasons`} reasons={club.reasons.fanSupport} />
      <Meter label="Player happiness" value={happy} caption="Team average — see Team for each player" />
      <Meter label="Fatigue" value={fatigue} caption={`${fatigueLabel(fatigue)} · higher = more tired`} tone={fatigue >= 50 ? 'warn' : 'slate'} />
    </Panel>
  );
}

function PlayerNotes() {
  const s = useGame();
  const players = clubPlayers(s, s.userClubId);
  const notes: { id: string; text: string; icon: 'person' | 'rest' | 'warning' }[] = [];
  for (const p of [...players].sort((a, b) => b.fatigue - a.fatigue)) {
    if (p.fatigue >= 60 && notes.length < 4) notes.push({ id: p.id, text: 'Needs rest', icon: 'rest' });
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
