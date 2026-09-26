import { useEffect, useMemo, useRef, useState } from 'react';
import type { EventInstance } from '../../domain/state';
import { clubName, shortName } from '../../domain/state';
import type { MatchResult, MatchSequence, PlayerId } from '../../domain/types';
import { isHighlight, type MatchContext } from '../../presentation/adapter';
import { toView, VIEW } from '../../presentation/fieldConfig';
import type { Frame } from '../../presentation/frame';
import { ordinal } from '../../simulation/match';
import { Avatar, Crest } from '../components/art';
import { Ribbon } from '../components/common';
import { Icon } from '../components/icons';
import { useGame, useReducedMotion } from '../hooks';
import { MatchSummary } from '../screens/MatchView';
import { BallSprite, FieldBackground, kitFor, PlayerSprite } from './Field';
import { useMatchPlayback } from './usePlayback';

const HITS = new Set(['single', 'double', 'triple', 'homeRun']);

/** Visual match view for a resolved league game: scoreboard, field, players, log and controls. */
export function MatchScene({ ev, match }: { ev: EventInstance; match: MatchResult }) {
  const s = useGame();
  const reduced = useReducedMotion();
  const ctx: MatchContext = useMemo(
    () => ({ match, name: (id) => s.players[id]?.lastName ?? '?', bats: (id) => s.players[id]?.bats ?? 'R' }),
    // The stored match never changes and names/bats are stable, so the context is built once per match.
    [match.id],
  );
  const { pb, next, skip, setAuto, setMode } = useMatchPlayback(ctx, match.id, reduced);
  const seq = match.sequence!;
  const frame = pb.frame();
  const p = pb.presentation;
  const current: MatchSequence | null = p ? seq[p.seqIndex] : null;
  const display = frame?.state ?? { ...seq[seq.length - 1].after, inning: match.innings, half: 'bottom' as const };
  const finished = pb.phase === 'finished';
  const revealed = seq.slice(0, pb.logThrough + 1);
  const home = s.clubs[match.homeId];
  const away = s.clubs[match.awayId];

  const outsText = `${display.outs >= 3 ? 3 : display.outs} out${display.outs === 1 ? '' : 's'}`;
  const status = finished
    ? match.decidedBy === 'suddenDeath'
      ? 'Final · prototype sudden-death'
      : match.innings > 9
        ? `Final · ${match.innings} innings`
        : 'Final'
    : `${display.half === 'top' ? 'Top' : 'Bottom'} ${ordinal(display.inning)} · ${outsText}`;

  return (
    <div className="match-screen">
      <aside className="match-left">
        <GameStats match={match} revealed={revealed} />
        <BattingOrder match={match} current={current} />
      </aside>

      <section className="match-center" aria-label="Match">
        <div className="match-board">
          <Ribbon>League game</Ribbon>
          <div className="scoreboard">
            <div className="sb-team">
              <Crest club={away} size={56} />
              <span className="sb-name">{clubName(away)}</span>
            </div>
            <div className="sb-score" aria-live="polite" aria-label={`${away.name} ${display.score.away}, ${home.name} ${display.score.home}`}>
              <span>{display.score.away}</span>
              <span className="sb-sep" aria-hidden="true" />
              <span>{display.score.home}</span>
            </div>
            <div className="sb-team">
              <Crest club={home} size={56} />
              <span className="sb-name">{clubName(home)}</span>
            </div>
          </div>
          <div className="sb-strip">
            <span className="sb-status">{status}</span>
            {!finished && <OutsDots outs={Math.min(3, display.outs)} />}
            {!finished && <BasesDiamond bases={display.bases} />}
          </div>
        </div>

        <FieldStage match={match} frame={frame} t={pb.t} current={current} finished={finished} />

        {!finished && current && <ActivePlayers match={match} current={current} revealed={revealed} />}

        <p className="commentary" aria-live="polite">
          <Icon name="chat" size={18} />
          <span>{finished ? `Final: ${away.name} ${match.runs.away}, ${home.name} ${match.runs.home}.` : pb.cursor < 0 ? 'Players take the field.' : frame?.commentary}</span>
        </p>

        {!finished ? (
          <div className="playback">
            <button className="btn btn-primary" onClick={next} disabled={pb.phase !== 'ready'} aria-label="Next highlight">
              {pb.mode === 'all' ? 'Next play' : 'Next highlight'} <Icon name="play" size={18} />
            </button>
            <button className="btn btn-secondary" onClick={skip}>
              Skip to result <Icon name="forward" size={18} />
            </button>
            <label className="auto-toggle">
              <input type="checkbox" className="switch" checked={pb.auto} onChange={(e) => setAuto(e.target.checked)} /> Auto play
            </label>
            <label className="mode-pick">
              <span className="sr-only">Show</span>
              <select value={pb.mode} onChange={(e) => setMode(e.target.value as 'highlights' | 'all')}>
                <option value="highlights">Highlights</option>
                <option value="all">Every play</option>
              </select>
            </label>
          </div>
        ) : (
          <div className="event-card match-summary">
            <MatchSummary ev={ev} m={match} />
          </div>
        )}
      </section>

      <aside className="match-right">
        <MatchLog match={match} revealed={revealed} />
      </aside>
    </div>
  );
}

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [w, setW] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => setW(el.clientWidth);
    update();
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', update);
      return () => window.removeEventListener('resize', update);
    }
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return { ref, w };
}

function FieldStage({ match, frame, t, current, finished }: { match: MatchResult; frame: Frame | null; t: number; current: MatchSequence | null; finished: boolean }) {
  const s = useGame();
  const { ref, w } = useWidth<HTMLDivElement>();
  const home = s.clubs[match.homeId];
  const away = s.clubs[match.awayId];
  const kits = { [home.id]: kitFor(home, true), [away.id]: kitFor(away, false) };
  const actors = frame ? [...frame.actors].sort((a, b) => a.pos.y - b.pos.y) : [];
  const labels = frame?.labels ?? [];
  const scale = w / VIEW.width;

  // Name plates in screen pixels (fixed readable size), positioned with the same transform as the figures.
  const plates = placeLabels(
    labels
      .map((id) => actors.find((a) => a.id === id))
      .filter((a): a is NonNullable<typeof a> => !!a)
      .map((a) => {
        const v = toView(a.pos);
        const pl = s.players[a.id];
        const text = pl ? (w < 520 ? pl.lastName : shortName(pl)) : '?';
        return { id: a.id, x: v.x * scale, y: v.y * scale, text, color: s.clubs[a.clubId]?.colors.primary ?? '#0f2a5c' };
      }),
    w,
    (w * VIEW.height) / VIEW.width,
  );

  return (
    <div className="field-stage" ref={ref}>
      <svg viewBox={`0 0 ${VIEW.width} ${VIEW.height}`} role="img" aria-label="Field view" preserveAspectRatio="xMidYMid meet">
        <FieldBackground />
        {actors.map((a) => {
          const pl = s.players[a.id];
          return (
            <PlayerSprite
              key={a.id}
              a={a}
              t={t}
              kit={kits[a.clubId] ?? kitFor(home, true)}
              withBat={!!current && a.id === current.batterId && a.role === 'offense' && a.pos.y > 0.8 && (a.pose === 'ready' || a.pose === 'swing')}
              highlighted={labels.includes(a.id)}
              ring={pl ? s.clubs[a.clubId]?.colors.secondary ?? '#fff' : '#fff'}
            />
          );
        })}
        {frame?.ball && <BallSprite ball={frame.ball} />}
      </svg>
      {plates.map((pl) => (
        <span key={pl.id} className="name-plate" style={{ left: pl.left, top: pl.top, borderColor: pl.color }}>
          {pl.text}
          <span className={`plate-pointer ${pl.below ? 'up' : ''}`} style={{ left: pl.pointer }} aria-hidden="true" />
        </span>
      ))}
      {frame?.call && !finished && <span className="call-banner">{frame.call}</span>}
      {finished && <span className="call-banner final">FINAL</span>}
    </div>
  );
}

/** Places name plates above the figures, nudging to avoid overlaps and never leaving the stage. */
export function placeLabels(items: { id: PlayerId; x: number; y: number; text: string; color: string }[], w: number, h: number) {
  const placed: { id: PlayerId; left: number; top: number; width: number; pointer: number; color: string; text: string; below: boolean }[] = [];
  const HEIGHT = 24;
  // Just above the figure's head (figures are ~48 view units tall) at any stage width.
  const headOffset = 48 * (w / VIEW.width) + 6;
  for (const it of [...items].sort((a, b) => a.y - b.y)) {
    const width = it.text.length * 7.6 + 22;
    let left = Math.min(Math.max(4, it.x - width / 2), Math.max(4, w - width - 4));
    let top = it.y - headOffset - HEIGHT;
    let below = false;
    if (top < 4) {
      top = it.y + 8;
      below = true;
    }
    for (let guard = 0; guard < 6; guard++) {
      const hit = placed.find((p) => left < p.left + p.width + 4 && left + width + 4 > p.left && top < p.top + HEIGHT + 2 && top + HEIGHT + 2 > p.top);
      if (!hit) break;
      top = below ? hit.top + HEIGHT + 4 : hit.top - HEIGHT - 4;
      if (top < 4) {
        top = hit.top + HEIGHT + 4;
        below = true;
      }
    }
    top = Math.min(Math.max(4, top), h - HEIGHT - 4);
    left = Math.min(Math.max(4, left), Math.max(4, w - width - 4));
    placed.push({ id: it.id, left, top, width, pointer: Math.min(width - 10, Math.max(10, it.x - left)), color: it.color, text: it.text, below });
  }
  return placed;
}

function OutsDots({ outs }: { outs: number }) {
  return (
    <span className="outs" aria-label={`${outs} outs`}>
      <span className="muted small">OUTS</span>
      {[0, 1, 2].map((i) => (
        <span key={i} className={`out-dot ${i < outs ? 'on' : ''}`} aria-hidden="true" />
      ))}
    </span>
  );
}

function BasesDiamond({ bases }: { bases: (PlayerId | null)[] }) {
  const on = ['first', 'second', 'third'].filter((_, i) => bases[i]);
  return (
    <svg className="bases-mini" viewBox="0 0 48 30" role="img" aria-label={on.length ? `Runners on ${on.join(', ')}` : 'Bases empty'}>
      {[
        [34, 17],
        [24, 7],
        [14, 17],
      ].map(([x, y], i) => (
        <rect key={i} x={x - 6} y={y - 6} width={12} height={12} transform={`rotate(45 ${x} ${y})`} className={bases[i] ? 'base on' : 'base'} />
      ))}
    </svg>
  );
}

function todayLine(revealed: MatchSequence[], id: PlayerId) {
  let ab = 0;
  let h = 0;
  for (const st of revealed) {
    if (st.kind !== 'plateAppearance' || st.batterId !== id) continue;
    if (st.outcome !== 'walk' && st.outcome !== 'sacFly') ab++;
    if (HITS.has(st.outcome!)) h++;
  }
  return { ab, h };
}

function ActivePlayers({ match, current, revealed }: { match: MatchResult; current: MatchSequence; revealed: MatchSequence[] }) {
  const s = useGame();
  const batter = current.batterId ? s.players[current.batterId] : null;
  const pitcher = s.players[current.pitcherId];
  const side = current.half === 'top' ? 'away' : 'home';
  const pos = batter ? match.lineups[side].battingOrder.find((x) => x.playerId === batter.id)?.position : null;
  const line = batter ? todayLine(revealed, batter.id) : null;
  const faced = revealed.filter((st) => st.kind === 'plateAppearance' && st.pitcherId === current.pitcherId);
  const ks = faced.filter((st) => st.outcome === 'strikeout').length;
  return (
    <div className="active-players">
      {batter ? (
        <div className="ap ap-batter">
          <Avatar player={batter} club={s.clubs[batter.clubId] ?? s.clubs[current.battingClubId]} size={64} />
          <div>
            <small>At bat</small>
            <strong>{batter.firstName} {batter.lastName}</strong>
            <span className="muted">
              {line!.h} for {line!.ab} today{pos ? ` · ${pos}` : ''} · bats {batter.bats}
            </span>
          </div>
        </div>
      ) : (
        <div className="ap" />
      )}
      {pitcher && (
        <div className="ap ap-pitcher">
          <div>
            <small>Pitching</small>
            <strong>{pitcher.firstName} {pitcher.lastName}</strong>
            <span className="muted">
              {pitcher.throws}HP · {faced.length} batters, {ks} K today
            </span>
          </div>
          <Avatar player={pitcher} club={s.clubs[pitcher.clubId] ?? s.clubs[match.homeId]} size={64} />
        </div>
      )}
    </div>
  );
}

function GameStats({ match, revealed }: { match: MatchResult; revealed: MatchSequence[] }) {
  const s = useGame();
  const row = (clubId: string) => {
    const mine = revealed.filter((st) => st.battingClubId === clubId && st.kind === 'plateAppearance');
    return {
      h: mine.filter((st) => HITS.has(st.outcome!)).length,
      bb: mine.filter((st) => st.outcome === 'walk').length,
      k: mine.filter((st) => st.outcome === 'strikeout').length,
    };
  };
  return (
    <div className="panel match-panel">
      <header className="panel-head">
        <h2>Game so far</h2>
      </header>
      <table className="mini-table">
        <thead>
          <tr>
            <th scope="col">Team</th>
            <th scope="col">H</th>
            <th scope="col">BB</th>
            <th scope="col">K</th>
          </tr>
        </thead>
        <tbody>
          {[match.awayId, match.homeId].map((id) => {
            const r = row(id);
            return (
              <tr key={id} className={id === s.userClubId ? 'me' : ''}>
                <td>{s.clubs[id].name}</td>
                <td>{r.h}</td>
                <td>{r.bb}</td>
                <td>{r.k}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function BattingOrder({ match, current }: { match: MatchResult; current: MatchSequence | null }) {
  const s = useGame();
  const clubId = current?.battingClubId ?? match.awayId;
  const side = clubId === match.homeId ? 'home' : 'away';
  return (
    <div className="panel match-panel">
      <header className="panel-head">
        <h2>Batting order · {s.clubs[clubId].name}</h2>
      </header>
      <ol className="order-list">
        {match.lineups[side].battingOrder.map((slot, i) => {
          const pl = s.players[slot.playerId];
          const now = current?.batterId === slot.playerId;
          return (
            <li key={slot.playerId} className={now ? 'now' : ''} aria-current={now ? 'true' : undefined}>
              <span className="n">{i + 1}</span>
              <span className="nm">{pl ? shortName(pl) : '?'}</span>
              <span className="pos">{slot.position}</span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function MatchLog({ match, revealed }: { match: MatchResult; revealed: MatchSequence[] }) {
  const s = useGame();
  const seq = match.sequence!;
  const items = revealed.filter((st) => isHighlight(seq, st.index)).reverse().slice(0, 30);
  const leadText = (st: MatchSequence) => {
    const { home, away } = st.after.score;
    const h = s.clubs[match.homeId].name;
    const a = s.clubs[match.awayId].name;
    return home === away ? `TIED ${home}–${away}` : home > away ? `${h.toUpperCase()} LEAD ${home}–${away}` : `${a.toUpperCase()} LEAD ${away}–${home}`;
  };
  return (
    <div className="panel match-panel">
      <header className="panel-head">
        <h2>Match log</h2>
      </header>
      {items.length === 0 ? (
        <p className="muted small log-empty">Plays appear here once they have been shown.</p>
      ) : (
        <ol className="match-log">
          {items.map((st) => {
            const club = s.clubs[st.battingClubId];
            const scored = st.after.score.home + st.after.score.away > st.before.score.home + st.before.score.away;
            return (
              <li key={st.index} className={scored ? 'scoring' : ''}>
                <Crest club={club} size={28} />
                <div>
                  <small>
                    {st.half === 'top' ? '▲' : '▼'} {ordinal(st.inning)} · {club.name}
                  </small>
                  <span>{st.text}</span>
                  {scored && <span className="lead-chip">{leadText(st)}</span>}
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
