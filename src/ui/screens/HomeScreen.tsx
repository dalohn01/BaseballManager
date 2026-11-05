import { useLineupOpen } from '../match/MatchDay';
import { useEffect, useRef } from 'react';
import { BALANCE } from '../../balance/config';
import { moodLabel } from '../../domain/mood';
import type { GameState } from '../../domain/state';
import { absoluteRound, clubPlayers, shortName } from '../../domain/state';
import { dayLabel, daysUntilRound, describeDay, inDays, nextDay } from '../../domain/calendar';
import { DIRECTION_LABEL, goalProgress } from '../../simulation/goals';
import { money } from '../format';
import { computeStandings } from '../../simulation/standings';
import { Crest } from '../components/art';
import { ballparkName } from '../../content/ballparks';
import { ovrDisplay, ovrProfile, teamOvr } from '../../domain/teamOvr';
import { overallTier, TIER_LABEL } from '../../domain/ratings';
import { Meter, Panel } from '../components/common';
import { Icon } from '../components/icons';
import { href, useGame } from '../hooks';
import { MatchScene } from '../match/MatchScene';
import { PreMatchScreen } from '../prematch/PreMatchScreen';
import { BallIcon, SeasonCalendar, DailyEventStack } from '../home/Today';
import { ClubStatus } from '../home/ClubStatus';
import { boardCheckpoints } from '../../events/planner';
import { dateOf, matchSeasonDay, seasonDayOf, seasonLength, shortDate } from '../../domain/seasonDates';

export function HomeScreen() {
  const s = useGame();
  const lineupOpen = useLineupOpen(s.currentEvent?.id);
  const mainRef = useRef<HTMLDivElement>(null);
  const eventKey = `${s.currentEvent?.id}:${s.currentEvent?.status}`;
  // Bring the new event or its result into view after each decision.
  useEffect(() => {
    const el = mainRef.current;
    if (el && el.getBoundingClientRect().top < 0) el.scrollIntoView({ block: 'start' });
  }, [eventKey]);
  const ev = s.currentEvent;
  const liveMatch = ev?.type === 'leagueGame' && ev.status === 'resolved' && ev.resolution?.matchId ? s.matches[ev.resolution.matchId] : null;
  if (ev?.type === 'leagueGame' && ev.status === 'pending' && lineupOpen) {
    // The match day card's "Set lineup" opens the pre-match team selection.
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
      <div className="home-grid">
        <div className="home-main" ref={mainRef}>
          <SeasonCalendar />
          <DailyEventStack />
        </div>
        <aside className="home-left">
          <SeasonGoal />
          <ClubStatus />
          <PlayerNotes />
        </aside>
        <aside className="home-right">
          <NextMatch />
          <LookingAhead />
          <MiniTable />
        </aside>
      </div>
    </div>
  );
}

function phaseLabel(s: GameState): string {
  return dayLabel(s.calendar);
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


function PlayerNotes() {
  const s = useGame();
  const players = clubPlayers(s, s.userClubId);
  const notes: { id: string; text: string; icon: 'person' | 'rest' | 'warning' }[] = [];
  for (const p of [...players].sort((a, b) => a.satisfaction - b.satisfaction)) {
    if (p.satisfaction < 50 && notes.length < 4) notes.push({ id: p.id, text: `${moodLabel('player', p.satisfaction)}: ${p.moodLog[0]?.text ?? 'wants more'}`, icon: 'warning' });
  }
  for (const p of [...players].sort((a, b) => b.satisfaction - a.satisfaction)) {
    if (p.satisfaction >= 85 && notes.length < 4) notes.push({ id: p.id, text: 'Happy with his role', icon: 'person' });
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
  const fromRound = s.calendar.phase === 'postseason' ? Infinity : s.calendar.round;
  const g = s.schedule.find((x) => x.season === season && x.round >= fromRound && !x.result && (x.homeId === s.userClubId || x.awayId === s.userClubId));
  if (!g) return <Panel title="Next match"><p className="muted">No games left this season.</p></Panel>;
  const days = daysUntilRound(s.calendar, g.round);
  const upNow = ev?.type === 'leagueGame' && ev.status === 'pending';
  const table = computeStandings(s);
  return (
    <Panel
      title="Next match"
      className="next-match"
      action={
        <span className={`nm-days ${days === 0 || upNow ? 'today' : ''}`}>
          <Icon name="time" size={15} /> {upNow ? 'Up now' : inDays(days)}
        </span>
      }
    >
      <ul className="nm-rows">
        {[g.homeId, g.awayId].map((id) => (
          <NextMatchTeam key={id} state={s} clubId={id} home={id === g.homeId} rank={table.findIndex((r) => r.clubId === id)} row={table.find((r) => r.clubId === id)!} />
        ))}
      </ul>
      <p className="nm-meta">Round {g.round} · {ballparkName(s.clubs[g.homeId])}</p>
    </Panel>
  );
}

const ordinal = (n: number) => `${n}${n % 10 === 1 && n % 100 !== 11 ? 'st' : n % 10 === 2 && n % 100 !== 12 ? 'nd' : n % 10 === 3 && n % 100 !== 13 ? 'rd' : 'th'}`;

/** One side of the next match: crest, name, table position and record, last five results, team OVR. */
function NextMatchTeam({ state: s, clubId, home, rank, row }: { state: GameState; clubId: string; home: boolean; rank: number; row: { wins: number; losses: number } }) {
  const club = s.clubs[clubId];
  const form = s.schedule
    .filter((x) => x.season === s.calendar.season && x.result && (x.homeId === clubId || x.awayId === clubId))
    .sort((a, b) => a.round - b.round)
    .slice(-5)
    .map((x) => {
      const r = x.result!;
      const ours = x.homeId === clubId ? r.homeRuns : r.awayRuns;
      const theirs = x.homeId === clubId ? r.awayRuns : r.homeRuns;
      return { won: ours > theirs, text: `${ours}–${theirs} ${x.homeId === clubId ? 'vs' : '@'} ${s.clubs[x.homeId === clubId ? x.awayId : x.homeId].name}` };
    });
  const o = teamOvr(s, clubId);
  const ovr = o ? ovrDisplay(o.overall) : null;
  const played = row.wins + row.losses;
  return (
    <li className={`nm-row ${clubId === s.userClubId ? 'me' : ''}`}>
      <Crest club={club} size={34} />
      <span className="nm-id">
        <strong>
          {club.name}
          {home && <span className="nm-home">Home</span>}
        </strong>
        <small>{played ? `${ordinal(rank + 1)} · ${row.wins}–${row.losses}` : 'No games yet'}</small>
      </span>
      <span className="nm-form" aria-label={form.length ? `Last ${form.length}: ${form.map((f) => (f.won ? 'W' : 'L')).join(' ')}` : 'No results yet'}>
        {form.length === 0 ? (
          <small className="muted">–</small>
        ) : (
          form.map((f, i) => (
            <span key={i} className={`nm-res ${f.won ? 'w' : 'l'}`} title={f.text} aria-hidden="true">
              {f.won ? 'W' : 'L'}
            </span>
          ))
        )}
      </span>
      {ovr !== null ? (
        <span className={`ovr ovr-sm nm-ovr ovr-${overallTier(ovr)}`} title={`Team OVR ${ovr} (${TIER_LABEL[overallTier(ovr)]}) · ${ovrProfile(o!)}. Batting ${ovrDisplay(o!.batting)}, pitching ${ovrDisplay(o!.pitching)}, defense ${ovrDisplay(o!.defense)}.`}>
          {ovr}
          <span className="ovr-lbl">OVR</span>
        </span>
      ) : (
        <span className="muted">—</span>
      )}
    </li>
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


/**
 * Coming days and known fixtures only (never a copy of today's stack, never
 * invented random events): tomorrow, the next game and the next board check-in.
 */
function LookingAhead() {
  const s = useGame();
  const cal = s.calendar;
  const items: { tag: string; label: string; ball?: boolean }[] = [];
  if (cal.phase !== 'postseason') {
    const t = nextDay(cal);
    items.push({ tag: `Tomorrow · ${shortDate(dateOf(seasonDayOf(t)))}`, label: describeDay(s, t) });
  }
  const fromRound = cal.phase === 'postseason' ? Infinity : cal.round;
  const g = s.schedule.find((x) => x.season === cal.season && x.round >= fromRound && !x.result && (x.homeId === s.userClubId || x.awayId === s.userClubId));
  if (g) {
    const days = daysUntilRound(cal, g.round);
    const home = g.homeId === s.userClubId;
    const opp = s.clubs[home ? g.awayId : g.homeId];
    const when = days === 0 ? 'Today' : shortDate(dateOf({ season: cal.season, day: matchSeasonDay(g.round) }));
    items.push({ tag: when, label: `${home ? 'Home vs' : 'Away at'} ${opp.name}`, ball: true });
  }
  const board = boardCheckpoints().find((c) => c.round > cal.round && !s.cycle.boardChecks.includes(`${cal.season}:${c.key}`));
  if (board && cal.phase !== 'postseason') {
    items.push({ tag: `From ${shortDate(dateOf({ season: cal.season, day: 2 + (board.round - 1) * BALANCE.season.daysPerRound }))}`, label: `Board check-in · Round ${board.round}` });
  } else if (cal.phase === 'regular') {
    items.push({ tag: shortDate(dateOf({ season: cal.season, day: seasonLength() })), label: 'Season review' });
  }
  return (
    <Panel title="Looking ahead">
      <ol className="timeline">
        {items.slice(0, 3).map((it, i) => (
          <li key={i}>
            <span className="tl-dot">{i + 1}</span>
            <span>
              <small>
                {it.tag} {it.ball && <BallIcon />}
              </small>
              <strong>{it.label}</strong>
            </span>
          </li>
        ))}
      </ol>
    </Panel>
  );
}
