import { useEffect, useState } from 'react';
import type { EventInstance } from '../../domain/state';
import { clubName, shortName } from '../../domain/state';
import type { MatchResult, PlayRecord } from '../../domain/types';
import { ordinal } from '../../simulation/match';
import { Crest } from '../components/art';
import { EffectList, Ribbon } from '../components/common';
import { Icon } from '../components/icons';
import { useGame, useReducedMotion } from '../hooks';
import { ContinueButton, Reactions } from './EventCard';

const HIGHLIGHT_KINDS = new Set(['homeRun', 'triple', 'double', 'single', 'walk', 'sacFly', 'groundOut', 'doublePlay', 'steal', 'caughtStealing', 'strikeout', 'walkOff', 'suddenDeath', 'pitchingChange', 'ghostRunner']);

/**
 * Presents an already-simulated and saved match. Stepping through highlights is
 * purely presentational; skipping never changes the result.
 */
export function MatchView({ ev }: { ev: EventInstance }) {
  const s = useGame();
  const m = s.matches[ev.resolution!.matchId!];
  const plays = m.plays.filter((p) => HIGHLIGHT_KINDS.has(p.kind));
  const reduced = useReducedMotion();
  const [shown, setShown] = useState(0);
  const [auto, setAuto] = useState(false);
  const done = shown >= plays.length;

  useEffect(() => {
    if (!auto || done) return;
    const id = setTimeout(() => setShown((n) => n + 1), reduced ? 400 : 1400);
    return () => clearTimeout(id);
  }, [auto, done, shown, reduced]);

  const current: PlayRecord | undefined = plays[shown - 1];
  const score = done ? m.runs : current?.score ?? { home: 0, away: 0 };
  const home = s.clubs[m.homeId];
  const away = s.clubs[m.awayId];

  return (
    <section className="event-card match-card">
      <Ribbon>League game</Ribbon>
      <div className="scoreboard">
        <div className="sb-team">
          <Crest club={away} size={60} />
          <span className="sb-name">{clubName(away)}</span>
        </div>
        <div className="sb-score" aria-live="polite">
          <span>{score.away}</span>
          <span className="sb-sep" aria-hidden="true" />
          <span>{score.home}</span>
        </div>
        <div className="sb-team">
          <Crest club={home} size={60} />
          <span className="sb-name">{clubName(home)}</span>
        </div>
      </div>
      <p className="sb-status">
        {done ? (m.decidedBy === 'suddenDeath' ? 'Final · prototype sudden-death' : m.innings > 9 ? `Final · ${m.innings} innings` : 'Final') : current ? `${current.half === 'top' ? 'Top' : 'Bottom'} ${ordinal(current.inning)} · ${current.outs} out${current.outs === 1 ? '' : 's'}` : 'First pitch'}
      </p>

      {!done && (
        <>
          <p className="commentary" aria-live="polite">
            <Icon name="chat" size={18} /> {current ? current.text : 'Players take the field. Step through the highlights or skip to the result.'}
          </p>
          <div className="playback">
            <button className="btn btn-primary" onClick={() => setShown((n) => n + 1)}>
              Next highlight <Icon name="play" size={18} />
            </button>
            <button className="btn btn-secondary" onClick={() => setShown(plays.length)}>
              Skip to result <Icon name="forward" size={18} />
            </button>
            <label className="auto-toggle">
              <input type="checkbox" className="switch" checked={auto} onChange={(e) => setAuto(e.target.checked)} /> Auto play
            </label>
          </div>
          {shown > 0 && (
            <ol className="playlog" reversed>
              {plays
                .slice(0, shown)
                .reverse()
                .map((p, i) => (
                  <PlayItem key={i} p={p} m={m} />
                ))}
            </ol>
          )}
        </>
      )}

      {done && <MatchSummary ev={ev} m={m} />}
    </section>
  );
}

function PlayItem({ p, m }: { p: PlayRecord; m: MatchResult }) {
  const s = useGame();
  const club = s.clubs[p.battingClubId];
  return (
    <li className={p.runs > 0 || p.kind === 'walkOff' ? 'scoring' : ''}>
      <span className="pl-when" style={{ borderColor: club.colors.primary }}>
        {p.half === 'top' ? '▲' : '▼'}
        {p.inning} · {club.abbreviation}
      </span>
      <span>{p.text}</span>
      {p.runs > 0 && (
        <span className="pl-score">
          {s.clubs[m.awayId].abbreviation} {p.score.away}–{p.score.home} {s.clubs[m.homeId].abbreviation}
        </span>
      )}
    </li>
  );
}

function MatchSummary({ ev, m }: { ev: EventInstance; m: MatchResult }) {
  const s = useGame();
  const r = ev.resolution!;
  const userSide = m.homeId === s.userClubId ? 'home' : 'away';
  const ours = m.lineups[userSide];
  const innings = m.linescore.away.length;
  const headers = Array.from({ length: innings }, (_, i) => (m.decidedBy === 'suddenDeath' && i === innings - 1 ? 'SD' : String(i + 1)));
  const performers = ours.battingOrder
    .map((slot) => ({ p: s.players[slot.playerId], line: m.batting[slot.playerId] }))
    .filter((x) => x.line.h > 0 || x.line.rbi > 0 || x.line.sb > 0)
    .sort((a, b) => b.line.hr * 4 + b.line.h + b.line.rbi - (a.line.hr * 4 + a.line.h + a.line.rbi));
  const pitchers = m.pitchersUsed[userSide].map((id) => ({ p: s.players[id], line: m.pitching[id] }));

  return (
    <>
      <h1 className="event-title result-title">{r.headline}</h1>
      <div className="table-wrap">
        <table className="linescore">
          <caption className="sr-only">Line score</caption>
          <thead>
            <tr>
              <th scope="col">Team</th>
              {headers.map((h) => (
                <th key={h} scope="col">
                  {h}
                </th>
              ))}
              <th scope="col">R</th>
              <th scope="col">H</th>
            </tr>
          </thead>
          <tbody>
            {(['away', 'home'] as const).map((side) => (
              <tr key={side}>
                <th scope="row">{s.clubs[side === 'home' ? m.homeId : m.awayId].abbreviation}</th>
                {m.linescore[side].map((v, i) => (
                  <td key={i}>{v === null ? 'X' : v}</td>
                ))}
                <td className="strong">{m.runs[side]}</td>
                <td>{m.hits[side]}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {r.narrative.map((n, i) => (
        <p key={i} className="event-context">
          {n}
        </p>
      ))}
      <div className="box-grid">
        <div>
          <h2 className="subhead">Your hitters</h2>
          {performers.length === 0 ? (
            <p className="muted">A quiet day at the plate.</p>
          ) : (
            <ul className="box-list">
              {performers.slice(0, 5).map(({ p, line }) => (
                <li key={p.id}>
                  <strong>{shortName(p)}</strong> {line.h}-for-{line.ab}
                  {line.hr ? `, ${line.hr} HR` : ''}
                  {line.rbi ? `, ${line.rbi} RBI` : ''}
                  {line.sb ? `, ${line.sb} SB` : ''}
                </li>
              ))}
            </ul>
          )}
        </div>
        <div>
          <h2 className="subhead">Your pitchers</h2>
          <ul className="box-list">
            {pitchers.map(({ p, line }) => (
              <li key={p.id}>
                <strong>{shortName(p)}</strong> {Math.floor(line.outs / 3)}.{line.outs % 3} IP, {line.r} R, {line.so} K
              </li>
            ))}
          </ul>
        </div>
      </div>
      {r.reactions.length > 0 && <Reactions reactions={r.reactions} />}
      <h2 className="subhead">What changed</h2>
      <EffectList effects={r.effects.filter((e) => e.stat !== 'satisfaction')} />
      {r.effects.some((e) => e.stat === 'satisfaction') && (
        <details className="more">
          <summary>Player satisfaction changes ({r.effects.filter((e) => e.stat === 'satisfaction').length})</summary>
          <EffectList effects={r.effects.filter((e) => e.stat === 'satisfaction')} />
        </details>
      )}
      <ContinueButton ev={ev} />
    </>
  );
}
