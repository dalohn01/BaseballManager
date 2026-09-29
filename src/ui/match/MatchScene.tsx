import { useEffect, useMemo, useRef, useState } from 'react';
import { MatchSummaryPanel } from './MatchSummaryPanel';
import { TEMPO, type Speed } from '../../presentation/playback';
import { PlayerAvatar } from '../components/PlayerAvatar';
import type { EventInstance } from '../../domain/state';
import { clubName, shortName } from '../../domain/state';
import type { ClubId, MatchResult, PlayerId } from '../../domain/types';
import { batterFocus, batterToday, buildCommentary, ordinalOf, pitcherLine, type CommentaryStep } from '../../presentation/commentary';
import { battingBeforeMatch, fmtRate } from '../../domain/playerStats';
import { tiresAfterBatters } from '../../simulation/match';
import { Crest } from '../components/art';
import { Icon } from '../components/icons';
import { useGame, useReducedMotion } from '../hooks';
import { PostMatch } from './PostMatch';
import { MatchIntro } from './MatchIntro';
import { SchematicField } from './SchematicField';
import { readPosition, useCommentaryPlayback } from './usePlayback';

/**
 * Commentary-driven match view for a resolved league game: arena intro, then
 * one commentary step at a time with scoreboard, outs and the schematic field
 * all driven by the same presented step.
 */
/** How long the FINAL line stays before the post-match screen (ms). */
const POST_MATCH_DELAY_MS = 2600;

export function MatchScene({ ev, match }: { ev: EventInstance; match: MatchResult }) {
  const s = useGame();
  const reduced = useReducedMotion();
  const steps = useMemo(
    () => buildCommentary({ match, name: (id) => s.players[id]?.lastName ?? '?', clubName: (id) => s.clubs[id]?.name ?? '?' }),
    // The stored match never changes, so the steps are built once per match.
    [match.id],
  );
  // Re-entering a match that has already started resumes it without the intro.
  const [started, setStarted] = useState(() => readPosition(match.id) !== null);
  const { pb, next, skip, setAuto, setSpeed } = useCommentaryPlayback(steps, match.id, started);
  const [logOpen, setLogOpen] = useState(false);
  const nextRef = useRef<HTMLButtonElement>(null);

  const ready = started && pb.index >= 0;
  // Keyboard focus lands on the primary action once the first comment is shown.
  useEffect(() => {
    if (ready) nextRef.current?.focus({ preventScroll: true });
  }, [ready]);

  // After the final comment the view moves on to its own post-match screen.
  // Reloading a finished match opens that screen directly; after going back
  // to the match view it only returns on request.
  const [post, setPost] = useState(() => (readPosition(match.id) ?? -1) >= steps.length - 1 && steps.length > 0);
  const [stayOnMatch, setStayOnMatch] = useState(false);
  const ended = started && pb.finished;
  useEffect(() => {
    if (!ended || post || stayOnMatch) return;
    // Let the FINAL line land first, then transition.
    const id = window.setTimeout(() => setPost(true), reduced ? 900 : POST_MATCH_DELAY_MS);
    return () => window.clearTimeout(id);
  }, [ended, post, stayOnMatch, reduced]);
  const skipToResult = () => {
    skip();
    setPost(true);
  };

  if (started && post && pb.finished) {
    return <PostMatch ev={ev} match={match} steps={steps} reduced={reduced} onBack={() => { setStayOnMatch(true); setPost(false); }} />;
  }

  if (!started) return <MatchIntro match={match} round={ev.round} reduced={reduced} onDone={() => setStarted(true)} />;

  const step = pb.step;
  if (!step) {
    return (
      <p className="match-loading" role="status">
        Loading the match…
      </p>
    );
  }
  const finished = pb.finished;
  const st = step.state;
  const home = s.clubs[match.homeId];
  const away = s.clubs[match.awayId];
  const prevScore = steps[pb.index - 1]?.state.score ?? st.score;
  const scoredSide = st.score.home > prevScore.home ? 'home' : st.score.away > prevScore.away ? 'away' : null;
  const inningText = `${st.half === 'top' ? 'Top' : 'Bottom'} ${ordinalOf(st.inning)}`;
  const outs = Math.min(3, st.outs);
  const statusText = finished ? finalLabel(match) : `${inningText} · ${outs} out${outs === 1 ? '' : 's'}`;

  return (
    <div className={`cm-screen ${reduced ? 'reduced' : ''}`}>
      <header className="cm-board" aria-label="Scoreboard">
        <TeamScore club={away} runs={st.score.away} scored={scoredSide === 'away' ? step.runs : 0} />
        <div className="cm-mid">
          <span className="cm-status">{statusText}</span>
          {!finished && <OutsDots outs={outs} />}
        </div>
        <TeamScore club={home} runs={st.score.home} scored={scoredSide === 'home' ? step.runs : 0} home />
      </header>

      <aside className="cm-left">
        <BattingOrder match={match} steps={steps} index={pb.index} />
      </aside>

      <section className="cm-center panel" aria-label="Live commentary">
        <header className="cm-head">
          <h2>
            <Icon name="mic" size={22} /> Live commentary
          </h2>
          <span className="muted">{finished ? 'Final' : `${inningText} · ${outs} out${outs === 1 ? '' : 's'}`}</span>
          <button className="link cm-loglink" onClick={() => setLogOpen(true)}>
            Full log
          </button>
        </header>
        <Commentary steps={steps} index={pb.index} match={match} />
        {!finished && <Players match={match} steps={steps} index={pb.index} />}
      </section>

      <aside className="cm-right">
        <section className="panel cm-field" aria-label="On the field">
          <header className="cm-head">
            <h2>On the field</h2>
            <span className="muted small">{fieldCaption(step, s.players)}</span>
          </header>
          <SchematicField match={match} state={st} focus={step.focus} reduced={reduced} />
          {st.advancing.length > 0 && <p className="cm-advancing small">Runners advancing…</p>}
        </section>
        <MatchSummaryPanel match={match} steps={steps} index={pb.index} />
      </aside>

      <footer className="cm-controls" aria-label="Playback">
        <span className="cm-live">{finished ? 'Final' : 'Live play'}</span>
        {!finished && (
          <>
            <button ref={nextRef} className="btn btn-primary cm-next" onClick={next}>
              Next moment <Icon name="play" size={18} />
            </button>
            <button className="btn btn-secondary cm-skip" onClick={skipToResult} aria-label="Skip to result">
              <span className="lbl">Skip to result</span> <Icon name="forward" size={18} />
            </button>
            <label className="auto-toggle">
              <input type="checkbox" className="switch" checked={pb.auto} onChange={(e) => setAuto(e.target.checked)} /> Auto play
            </label>
            {/* Compact pause/play for narrow screens, same controller as the switch. */}
            <button className="btn btn-secondary cm-autobtn" aria-pressed={pb.auto} aria-label={pb.auto ? 'Pause auto play' : 'Start auto play'} onClick={() => setAuto(!pb.auto)}>
              <Icon name={pb.auto ? 'pause' : 'play'} size={18} />
            </button>
            <div className="segmented cm-speed" role="radiogroup" aria-label="Tempo">
              {(Object.keys(TEMPO) as Speed[]).map((v) => (
                <button key={v} role="radio" className={pb.speed === v ? 'on' : ''} aria-checked={pb.speed === v} onClick={() => setSpeed(v)}>
                  {TEMPO[v].label}
                </button>
              ))}
            </div>
          </>
        )}
        {finished && (
          <button className="btn btn-primary cm-next" onClick={() => setPost(true)}>
            Match summary <Icon name="chevron" size={18} />
          </button>
        )}
        <button className="btn btn-secondary btn-small cm-logbtn" onClick={() => setLogOpen(true)} aria-label="Full match log">
          <Icon name="list" size={18} /> <span className="lbl">Full match log</span>
        </button>
      </footer>

      {logOpen && <FullLog steps={steps} index={pb.index} match={match} onClose={() => setLogOpen(false)} />}
    </div>
  );
}

function finalLabel(m: MatchResult) {
  if (m.decidedBy === 'suddenDeath') return 'Final · prototype sudden-death';
  return m.innings > 9 ? `Final · ${m.innings} innings` : 'Final';
}

function TeamScore({ club, runs, scored, home }: { club: ReturnType<typeof useGame>['clubs'][string]; runs: number; scored: number; home?: boolean }) {
  return (
    <div className={`cm-team ${home ? 'home' : ''}`}>
      <Crest club={club} size={52} />
      <span className="cm-team-name">{clubName(club)}</span>
      <span key={scored ? `r${runs}` : 'r'} className={`cm-runs ${scored ? 'just' : ''}`} aria-label={`${club.name} ${runs}`}>
        {runs}
      </span>
      {scored > 0 && <span className="run-chip">+{scored} RUN{scored > 1 ? 'S' : ''}</span>}
    </div>
  );
}

function OutsDots({ outs }: { outs: number }) {
  return (
    <span className="outs" aria-label={`${outs} outs`}>
      {[0, 1, 2].map((i) => (
        <span key={i} className={`out-dot ${i < outs ? 'on' : ''}`} aria-hidden="true" />
      ))}
    </span>
  );
}

function fieldCaption(step: CommentaryStep, players: Record<PlayerId, { lastName: string }>) {
  const st = step.state;
  if (st.scoredId) return `${players[st.scoredId]?.lastName} scores`;
  if (st.inProgress) return 'Play in progress';
  const n = st.bases.filter(Boolean).length;
  return n === 0 ? 'Bases empty' : n === 3 ? 'Bases loaded' : `${n} on base`;
}

function leadText(match: MatchResult, score: { home: number; away: number }, names: Record<ClubId, { name: string }>) {
  if (score.home === score.away) return `TIED ${score.home}–${score.away}`;
  const homeAhead = score.home > score.away;
  return `${names[homeAhead ? match.homeId : match.awayId].name.toUpperCase()} LEAD ${Math.max(score.home, score.away)}–${Math.min(score.home, score.away)}`;
}

function Commentary({ steps, index, match }: { steps: CommentaryStep[]; index: number; match: MatchResult }) {
  const s = useGame();
  const step = steps[index];
  const earlier = steps.slice(Math.max(0, index - 3), index);
  const scoringClub = step.runs > 0 ? s.clubs[step.state.battingClubId] : null;
  return (
    <div className="cm-feed">
      <ol className="cm-earlier" aria-label="Recent commentary">
        {Array.from({ length: 3 - earlier.length }, (_, i) => (
          <li key={`pad${i}`} className="cm-old pad" aria-hidden="true" />
        ))}
        {earlier.map((e) => (
          <li key={e.id} className={`cm-old tone-${e.tone}`}>
            {e.headline && <strong>{e.headline} </strong>}
            {e.text}
          </li>
        ))}
      </ol>
      <div key={step.id} className={`cm-now tone-${step.tone} ${step.headline ? 'big' : ''} em-${step.emphasis}`} aria-live="polite" aria-atomic="true">
        {step.badge && <span className="cm-badge">{step.badge}</span>}
        {step.headline && <strong className="cm-headline">{step.headline}</strong>}
        <p className="cm-text">{step.text}</p>
        {step.runs > 0 && (
          <div className="cm-lead">
            {scoringClub && <Crest club={scoringClub} size={36} />}
            <span className="lead-chip">{leadText(match, step.state.score, s.clubs)}</span>
            <span className="run-chip">
              +{step.runs} RUN{step.runs > 1 ? 'S' : ''}
            </span>
          </div>
        )}
      </div>
      <p className={`cm-progress small ${step.state.inProgress ? '' : 'idle'}`} aria-hidden={!step.state.inProgress}>
        {step.state.inProgress ? (
          <>
            Play in progress <span className="dots" aria-hidden="true"><i /><i /><i /></span>
          </>
        ) : (
          ' '
        )}
      </p>
    </div>
  );
}


function BattingOrder({ match, steps, index }: { match: MatchResult; steps: CommentaryStep[]; index: number }) {
  const s = useGame();
  const focus = batterFocus(match, steps, index);
  const side = focus.clubId === match.homeId ? 'home' : 'away';
  const order = match.lineups[side].battingOrder;
  const at = order.findIndex((x) => x.playerId === focus.id);
  const tags = [focus.label, 'On deck', 'In the hole'];
  return (
    <section className="panel cm-order" aria-label="Batting order">
      <header className="cm-head">
        <h2>Batting order</h2>
        <span className="muted small">{s.clubs[focus.clubId].name}</span>
      </header>
      <ol>
        {order.map((slot, i) => {
          const pl = s.players[slot.playerId];
          const rel = (i - at + order.length) % order.length;
          return (
            <li key={slot.playerId} className={rel === 0 ? 'now' : rel < 3 ? 'soon' : ''} aria-current={rel === 0 ? 'true' : undefined}>
              <span className="n">{i + 1}</span>
              <span className="nm">
                {pl ? shortName(pl) : '?'}
                {rel < 3 && <small>{tags[rel]}</small>}
              </span>
              <span className="pos">{slot.position}</span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}


function Players({ match, steps, index }: { match: MatchResult; steps: CommentaryStep[]; index: number }) {
  const s = useGame();
  const step = steps[index];
  const focus = batterFocus(match, steps, index);
  const batter = s.players[focus.id];
  const pitcher = s.players[step.state.pitcherId];
  const pl = pitcher ? pitcherLine(match, steps, index, pitcher.id) : null;
  const fieldingClubId = step.state.battingClubId === match.homeId ? match.awayId : match.homeId;
  return (
    <div className="cm-players">
      {batter && <BatterPanel match={match} steps={steps} index={index} playerId={batter.id} label={focus.label} clubId={focus.clubId} />}
      {pitcher && pl && <PitcherCard match={match} pitcherId={pitcher.id} line={pl} fieldingClubId={fieldingClubId} />}
    </div>
  );
}

/** Rates need a few plate appearances before they mean anything. */
const MIN_PA_FOR_RATES = 5;

/**
 * The batter in focus: identity, his season before this game (the saved
 * match is subtracted so nothing leaks) and today's line from plays already
 * shown. Label, name and numbers always refer to the same player.
 */
function BatterPanel({ match, steps, index, playerId, label, clubId }: { match: MatchResult; steps: CommentaryStep[]; index: number; playerId: string; label: 'At bat' | 'Due up'; clubId: string }) {
  const s = useGame();
  const p = s.players[playerId];
  const side = clubId === match.homeId ? 'home' : 'away';
  const pos = match.lineups[side].battingOrder.find((x) => x.playerId === playerId)?.position ?? '—';
  const season = battingBeforeMatch(s, p, match);
  const enough = season.pa >= MIN_PA_FOR_RATES;
  const today = batterToday(match, steps, index, playerId);
  const extras = [today.r ? `${today.r} R` : '', today.rbi ? `${today.rbi} RBI` : '', today.bb ? `${today.bb} BB` : ''].filter(Boolean);
  return (
    <div className="mp-panel mp-batter">
      <PlayerAvatar player={p} club={s.clubs[p.clubId] ?? s.clubs[clubId]} size={104} />
      <div className="mp-main">
        <p className="mp-meta">
          <span className={`mp-role ${label === 'At bat' ? 'at-bat' : ''}`}>{label}</span>
          <span>
            {pos} · Bats {p.bats === 'S' ? 'S (switch)' : p.bats}
          </span>
        </p>
        <strong className="mp-name">
          {p.firstName} {p.lastName}
        </strong>
        <div className="mp-row" aria-label="Season before this game">
          <span className="mp-key" title={enough ? undefined : `Rates shown from ${MIN_PA_FOR_RATES} plate appearances (${season.pa} so far).`}>
            Season
          </span>
          <span className="mp-stats">
            <span>
              <b>{enough ? fmtRate(season.avg) : '—'}</b> AVG
            </span>
            <span>
              <b>{season.hr}</b> HR
            </span>
            <span>
              <b>{season.rbi}</b> RBI
            </span>
            <span>
              <b>{enough ? fmtRate(season.ops) : '—'}</b> OPS
            </span>
          </span>
        </div>
        <div className="mp-row" aria-label="Today">
          <span className="mp-key">Today</span>
          <b className="mp-today">
            {today.h}–{today.ab}
          </b>
          {extras.length > 0 && <span className="mp-extras">{extras.join(' · ')}</span>}
          <span className="mp-chips" aria-label="Plate appearances today">
            {today.results.length === 0 ? <span className="muted small">First time up</span> : today.results.map((r, i) => <span key={i} className="mp-chip">{r}</span>)}
          </span>
        </div>
      </div>
    </div>
  );
}

const ip = (outs: number) => `${Math.floor(outs / 3)}.${outs % 3}`;

/**
 * The pitcher: identity, today's line (IP in baseball notation, only plays
 * already shown), workload against the engine's tiring rule, and the planned
 * automatic change. Tiring and the change plan are separate rules and may
 * point at different moments.
 */
function PitcherCard({ match, pitcherId, line, fieldingClubId }: { match: MatchResult; pitcherId: string; line: ReturnType<typeof pitcherLine>; fieldingClubId: string }) {
  const s = useGame();
  const p = s.players[pitcherId];
  const style = match.pitchStyles?.[pitcherId] ?? 'balanced';
  const limit = tiresAfterBatters(style);
  const drop = Math.max(0, line.bf - limit);
  const left = limit - line.bf;
  const status = drop > 0 ? 'tired' : left <= 3 ? 'tiring' : 'fresh';
  const side = fieldingClubId === match.homeId ? 'home' : 'away';
  const isStarter = match.lineups[side].pitcherId === pitcherId;
  const hook = match.hooks?.[side];
  const ours = fieldingClubId === s.userClubId;
  return (
    <div className={`mp-panel mp-pitcher ${status}`}>
      <PlayerAvatar player={p} club={s.clubs[p.clubId] ?? s.clubs[fieldingClubId]} size={104} />
      <div className="mp-main">
        <p className="mp-meta">
          <span className="mp-role pitching">Pitching</span>
          <span>
            {p.throws}HP · Pitching {p.ratings.pitching}
            {style !== 'balanced' ? ` · ${style}` : ''}
          </span>
        </p>
        <strong className="mp-name">
          {p.firstName} {p.lastName}
        </strong>
        <p className="mp-line" aria-label="Today's pitching line" title="IP in baseball notation: 3.2 = three innings and two outs.">
          <b>{ip(line.outs)}</b> IP · <b>{line.h}</b> H · <b>{line.r}</b> R · <b>{line.bb}</b> BB · <b>{line.k}</b> K{line.hr ? <> · <b>{line.hr}</b> HR</> : null}
        </p>
        <div className="mp-row mp-work">
          <span className="mp-key" title="BF = batters faced. After about this many batters he tires: each further batter costs 1 pitching.">
            Workload
          </span>
          <span className={`mp-workload ${status}`}>
            {line.bf} BF · {drop > 0 ? `tired: −${drop} pitching` : left <= 0 ? 'tires from the next batter' : `~${left} until tired`}
          </span>
          <span className="mp-bar" aria-hidden="true">
            <span style={{ width: `${Math.min(100, (line.bf / limit) * 100)}%` }} />
          </span>
        </div>
        {ours && (
          <div className="mp-row">
            <span className="mp-key" title="Your pitching plan: the starter is replaced automatically when either condition is met (one change per game).">
              Auto change
            </span>
            {!isStarter ? (
              <span className="muted small">None — one change per game</span>
            ) : hook && hook.reliever !== false ? (
              <span className="mp-chips">
                <span className="mp-chip" title={`Replaced after facing ${hook.maxBatters} batters.`}>
                  {hook.maxBatters} BF
                </span>
                <span className="mp-or">or</span>
                <span className="mp-chip" title={`Replaced when he has allowed ${hook.pullRuns} runs, once he has faced at least ${hook.minBatters} batters.`}>
                  {hook.pullRuns} R after {hook.minBatters} BF
                </span>
              </span>
            ) : (
              <span className="muted small">No reliever available: he pitches the whole game</span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}


function FullLog({ steps, index, match, onClose }: { steps: CommentaryStep[]; index: number; match: MatchResult; onClose: () => void }) {
  const s = useGame();
  const [away, home] = [s.clubs[match.awayId].abbreviation, s.clubs[match.homeId].abbreviation];
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  // Only steps already presented: the log never shows what is still to come.
  const shown = steps.slice(0, index + 1);
  const groups: { key: string; title: string; items: CommentaryStep[] }[] = [];
  for (const st of shown) {
    const key = `${st.state.inning}-${st.state.half}`;
    let g = groups[groups.length - 1];
    if (!g || g.key !== key) {
      g = { key, title: `${st.state.half === 'top' ? 'Top' : 'Bottom'} ${ordinalOf(st.state.inning)}`, items: [] };
      groups.push(g);
    }
    g.items.push(st);
  }
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal cm-log" role="dialog" aria-modal="true" aria-label="Full match log" onClick={(e) => e.stopPropagation()}>
        <header className="cm-head">
          <h2>Full match log</h2>
          <button ref={closeRef} className="icon-btn" aria-label="Close" onClick={onClose}>
            ✕
          </button>
        </header>
        <div className="cm-log-body">
          {groups
            .slice()
            .reverse()
            .map((g) => (
              <section key={g.key}>
                <h3 className="subhead">{g.title}</h3>
                <ol>
                  {g.items
                    .slice()
                    .reverse()
                    .map((st) => (
                      <li key={st.id} className={`tone-${st.tone}`}>
                        {st.headline && <strong>{st.headline} </strong>}
                        {st.text}
                        <span className="muted small">
                          {' '}
                          · {away} {st.state.score.away}–{st.state.score.home} {home}
                        </span>
                      </li>
                    ))}
                </ol>
              </section>
            ))}
        </div>
      </div>
    </div>
  );
}
