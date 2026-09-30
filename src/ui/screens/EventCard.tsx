import { useEffect, useMemo, useRef, useState } from 'react';
import { PlayerAvatar } from '../components/PlayerAvatar';
import { optionBlocker, totalCost } from '../../application/engine';
import { BALANCE } from '../../balance/config';
import { effectiveRating } from '../../domain/lineup';
import { fitnessLabel } from '../../domain/mood';
import type { EventInstance, EventOption } from '../../domain/state';
import { clubName, shortName, userClub } from '../../domain/state';
import { leagueGameForecast, leagueGameOptionNotes, type LeagueGameChoice, lineupForChoice } from '../../events/templates/leagueGame';
import { SLOT_LABELS } from '../../events/planner';
import { advanceBlocker } from '../../application/engine';
import { dayLabel, describeDay, nextDay } from '../../domain/calendar';
import { viewTime } from '../../domain/time';
import { Avatar, Crest, EventArt } from '../components/art';
import { EffectList, OvrBadge, Ribbon } from '../components/common';
import { overallAt } from '../../domain/ratings';
import { Icon } from '../components/icons';
import { money } from '../format';
import { href, useController, useGame, useNow, useSnapshot } from '../hooks';
import { MatchView } from './MatchView';

export function EventCard() {
  const s = useGame();
  const ev = s.currentEvent;
  if (!ev) return <DayDone />;
  if (ev.status === 'pending') return <EventDecision ev={ev} key={ev.id} />;
  if (ev.type === 'leagueGame' && ev.resolution?.matchId) return <MatchView ev={ev} key={ev.id} />;
  return <EventResult ev={ev} key={ev.id} />;
}

/**
 * Every event of today is handled: the manager moves the calendar on. One day
 * costs 1 Time; tomorrow is previewed so the choice to advance is informed.
 */
function DayDone() {
  const s = useGame();
  const c = useController();
  const snap = useSnapshot();
  const now = useNow();
  const ref = useRef<HTMLButtonElement>(null);
  useEffect(() => ref.current?.focus({ preventScroll: true }), []);
  const tomorrow = nextDay(s.calendar);
  const blocker = advanceBlocker(s, now);
  const t = viewTime(s.time, now);
  const quiet = s.calendar.planned === 0;
  const wait = t.msToNext !== null && t.current < BALANCE.time.costPerDay ? ` Next Time in ${Math.ceil(t.msToNext / 60000)} min.` : '';
  return (
    <section className="event-card day-done" aria-live="polite">
      <Ribbon>{dayLabel(s.calendar)}</Ribbon>
      <h1 className="event-title">{quiet ? 'A quiet day' : 'Day complete'}</h1>
      <p className="event-context">{quiet ? 'Nothing needed your attention today.' : "Every event of today has been handled."}</p>
      <div className="day-next">
        <small>Tomorrow</small>
        <strong>{describeDay(s, tomorrow)}</strong>
      </div>
      <button ref={ref} className="btn btn-primary btn-confirm" onClick={() => void c.dispatch({ type: 'advanceDay', revision: s.revision })} disabled={!!blocker || snap.busy}>
        <span>Next day</span>
        <span className="btn-cost">
          <Icon name="time" size={18} /> {t.unlimited ? '∞' : BALANCE.time.costPerDay}
          <Icon name="chevron" />
        </span>
      </button>
      {blocker && (
        <p className="muted small">
          {blocker}
          {wait}
        </p>
      )}
      {snap.commandError && (
        <p className="pm-blocker small" role="alert">
          {snap.commandError}
        </p>
      )}
    </section>
  );
}

function CostTags({ cost, unlimited }: { cost: { time: number; cash: number; influence: number }; unlimited: boolean }) {
  return (
    <span className="cost-tags">
      {cost.cash > 0 && (
        <span className="cost-tag">
          <Icon name="cash" size={16} className="ico-cash" /> {money(cost.cash)}
        </span>
      )}
      {cost.influence > 0 && (
        <span className="cost-tag">
          <Icon name="influence" size={16} className="ico-influence" /> {cost.influence}
        </span>
      )}
      {cost.time > 0 && (
        <span className="cost-tag">
          <Icon name="time" size={16} /> {unlimited ? '∞' : cost.time}
        </span>
      )}
    </span>
  );
}

const OPTION_ICON: Record<string, 'bat' | 'glove' | 'recovery' | 'fans' | 'person' | 'chat' | 'rest' | 'stadium' | 'trophy' | 'clipboard'> = {
  batting: 'bat',
  defense: 'glove',
  recovery: 'recovery',
  current: 'clipboard',
  strongest: 'trophy',
  rest: 'rest',
  lower: 'fans',
  forum: 'chat',
  hold: 'stadium',
  star: 'person',
  prospect: 'person',
  decline: 'chat',
  autographs: 'fans',
  statement: 'chat',
  quiet: 'chat',
  pass: 'clipboard',
  accept: 'person',
  counter: 'chat',
  funds: 'trophy',
  cuts: 'clipboard',
  brief: 'chat',
  injection: 'trophy',
  ads: 'stadium',
  build: 'stadium',
  commercial: 'stadium',
  local: 'fans',
  contend: 'trophy',
  patience: 'chat',
  deflect: 'chat',
  young: 'person',
  start: 'person',
  program: 'bat',
  keep: 'clipboard',
  extra: 'bat',
  trust: 'chat',
  scrimmage: 'bat',
  video: 'clipboard',
  off: 'recovery',
  winNow: 'trophy',
  rebuild: 'person',
  balanced: 'stadium',
  promise: 'clipboard',
  keepStarting: 'person',
  rotate: 'rest',
  renew: 'clipboard',
  firm: 'chat',
  credit: 'trophy',
  humble: 'chat',
  standBy: 'chat',
  backtrack: 'chat',
  showProgress: 'person',
  raise: 'trophy',
  excuse: 'chat',
  talk: 'chat',
  grant: 'person',
  refuse: 'chat',
  freeze: 'clipboard',
  plan: 'clipboard',
  push: 'chat',
  meet: 'fans',
  cut: 'fans',
  ignore: 'chat',
  all: 'clipboard',
  none: 'clipboard',
  stay: 'clipboard',
  close: 'trophy',
};

function EventDecision({ ev }: { ev: EventInstance }) {
  const s = useGame();
  const c = useController();
  const snap = useSnapshot();
  const now = useNow(5000);
  const club = userClub(s);
  const firstAvailable = ev.options.find((o) => optionBlocker(s, ev, o, null, now) === null);
  const [selectedId, setSelectedId] = useState<string>((ev.options.find((o) => o.primary && !optionBlocker(s, ev, o, null, now)) ?? firstAvailable ?? ev.options[0]).id);
  const [boostOn, setBoostOn] = useState(false);
  // After a re-scout the old candidate options are gone; fall back to the first available one.
  const selected = ev.options.find((o) => o.id === selectedId) ?? firstAvailable ?? ev.options[0];
  const boost = ev.boosts.find((b) => b.appliesTo.includes(selected.id)) ?? null;
  const activeBoost = boostOn && boost ? boost : null;
  const blocker = optionBlocker(s, ev, selected, activeBoost, now);
  const cost = totalCost(selected, activeBoost);
  const unlimited = s.time.mode === 'unlimited';

  const titleRef = useRef<HTMLHeadingElement>(null);
  // A new event replaced the Continue button: move focus to its title (screen readers announce it; Tab reaches the options).
  useEffect(() => {
    if (document.activeElement === document.body) titleRef.current?.focus({ preventScroll: true });
  }, []);

  const confirm = () => {
    void c.dispatch({ type: 'resolveEvent', eventId: ev.id, revision: s.revision, optionId: selected.id, boostId: activeBoost?.id ?? null });
  };

  return (
    <section className="event-card" aria-labelledby="event-title">
      <Ribbon>Next event</Ribbon>
      <h1 className="event-title" id="event-title" tabIndex={-1} ref={titleRef}>
        {ev.type === 'leagueGame' ? 'League Game' : ev.title}
      </h1>
      {ev.type === 'leagueGame' ? <PreMatch ev={ev} choice={selected.id as LeagueGameChoice} /> : <EventArt type={ev.type} club={club} />}
      {ev.type !== 'leagueGame' && <p className="event-context">{ev.context}</p>}
      {ev.subjects.playerIds.length > 0 && ev.type !== 'leagueGame' && (
        <div className="subjects">
          {ev.subjects.playerIds.map((id) => {
            const p = s.players[id];
            const theirs = p.clubId !== s.userClubId;
            return (
              <a key={id} className="subject" href={href(`team/${id}`)}>
                <Avatar player={p} club={s.clubs[p.clubId] ?? club} size={36} />
                <OvrBadge player={p} size="sm" />
                <span>
                  <strong>
                    {shortName(p)}
                    {theirs && s.clubs[p.clubId] ? ` (${s.clubs[p.clubId].abbreviation})` : ''}
                  </strong>
                  <small>
                    {p.isPitcher ? `PIT ${p.ratings.pitching}` : `CON ${p.ratings.contact} · POW ${p.ratings.power}`} · age {p.age}
                    {theirs ? '' : ` · Sat. ${Math.round(p.satisfaction)}`}
                  </small>
                </span>
              </a>
            );
          })}
        </div>
      )}
      <fieldset className="options">
        <legend className="event-prompt">{ev.prompt}</legend>
        {ev.options.map((o) => (
          <OptionRow key={o.id} option={o} ev={ev} checked={o.id === selected.id} onSelect={() => setSelectedId(o.id)} now={now} unlimited={unlimited} />
        ))}
      </fieldset>
      {ev.rerollCost !== null && (
        <div className="reroll">
          <button
            className="btn btn-small btn-secondary"
            disabled={ev.rerolled || s.influence < ev.rerollCost || snap.busy}
            onClick={() => void c.dispatch({ type: 'rerollCandidates', eventId: ev.id, revision: s.revision })}
          >
            <Icon name="influence" size={16} className="ico-influence" /> Scout new candidates · {ev.rerollCost}
          </button>
          <small className="muted">
            {ev.rerolled ? 'Already re-scouted for this event.' : s.influence < ev.rerollCost ? 'Not enough Influence.' : 'Costs Influence only, no Time. Once per event; the new list replaces this one.'}
          </small>
        </div>
      )}
      {boost && (
        <label className={`boost ${optionBlocker(s, ev, selected, boost, now) && !boostOn ? 'boost-disabled' : ''}`}>
          <input
            type="checkbox"
            className="switch"
            checked={boostOn}
            disabled={!boostOn && optionBlocker(s, ev, selected, boost, now) !== null}
            onChange={(e) => setBoostOn(e.target.checked)}
          />
          <span>
            <strong>{boost.label}</strong> · <Icon name="influence" size={16} className="ico-influence" /> {boost.cost.influence} Influence
            <small className="muted"> — {boost.description}</small>
          </span>
        </label>
      )}
      {blocker && (
        <p className="blocker" role="status">
          <Icon name="warning" size={18} /> {blocker}
        </p>
      )}
      {snap.commandError && !blocker && (
        <p className="blocker" role="alert">
          {snap.commandError}
        </p>
      )}
      <button className="btn btn-primary btn-confirm" onClick={confirm} disabled={!!blocker || snap.busy}>
        <span>{snap.busy ? 'Saving…' : `Confirm ${ev.type === 'leagueGame' ? 'lineup & play' : ev.kicker}`}</span>
        {cost.cash > 0 || cost.influence > 0 || cost.time > 0 ? (
          <span className="btn-cost">
            <CostTags cost={cost} unlimited={unlimited} />
            <Icon name="chevron" />
          </span>
        ) : (
          <Icon name="chevron" />
        )}
      </button>
    </section>
  );
}

function OptionRow({ option: o, ev, checked, onSelect, now, unlimited }: { option: EventOption; ev: EventInstance; checked: boolean; onSelect: () => void; now: number; unlimited: boolean }) {
  const s = useGame();
  const blocker = optionBlocker(s, ev, o, null, now);
  const forecast = ev.type === 'leagueGame' ? leagueGameForecast(s, String(ev.data.gameId), o.id as LeagueGameChoice) : null;
  const candidate = o.candidateId ? ev.candidates.find((c) => c.id === o.candidateId) : undefined;
  return (
    <label className={`option ${checked ? 'option-checked' : ''} ${blocker ? 'option-blocked' : ''}`}>
      <input type="radio" name={`opt-${ev.id}`} value={o.id} checked={checked} onChange={onSelect} className="sr-only" />
      {candidate ? (
        <OvrBadge player={candidate} size="md" />
      ) : (
        <Icon name={OPTION_ICON[o.id] ?? OPTION_ICON[o.id.split(':')[0]] ?? 'clipboard'} size={30} className="option-icon" />
      )}
      <span className="option-main">
        <span className="option-label">{o.label}</span>
        <span className="option-summary">{o.summary}</span>
      </span>
      <span className="option-effects">
        {forecast && <span className="eff neutral">Win chance {Math.round(forecast.winChance * 100)}%</span>}
        {(ev.type === 'leagueGame' ? leagueGameOptionNotes(s, o.id as LeagueGameChoice) : o.certain).map((e, i) => (
          <span key={i} className={`eff ${e.tone}`}>
            {e.text}
          </span>
        ))}
        {o.uncertain.map((e, i) => (
          <span key={`u${i}`} className={`eff uncertain ${e.tone}`} title="Uncertain: depends on ability and chance">
            ~ {e.text}
          </span>
        ))}
        {(o.cost.cash > 0 || o.cost.influence > 0) && <CostTags cost={{ ...o.cost, time: 0 }} unlimited={unlimited} />}
        {blocker && <span className="eff negative">{blocker}</span>}
      </span>
      <span className="radio-dot" aria-hidden="true">
        {checked && <Icon name="check" size={18} />}
      </span>
    </label>
  );
}

function PreMatch({ ev, choice }: { ev: EventInstance; choice: LeagueGameChoice }) {
  const s = useGame();
  const club = userClub(s);
  const opp = s.clubs[String(ev.data.opponentId)];
  const isHome = Boolean(ev.data.isHome);
  const f = leagueGameForecast(s, String(ev.data.gameId), choice);
  const lineup = useMemo(() => lineupForChoice(s, choice), [s, choice]);
  const sp = s.players[lineup.pitcherId];
  const [home, away] = isHome ? [club, opp] : [opp, club];
  return (
    <div className="prematch">
      <div className="versus">
        <div className="versus-team">
          <Crest club={away} size={56} />
          <span>{clubName(away)}</span>
        </div>
        <div className="versus-mid">
          <span className="at">@</span>
          <small>{isHome ? 'Home' : 'Away'} · Round {ev.round}</small>
        </div>
        <div className="versus-team">
          <Crest club={home} size={56} />
          <span>{clubName(home)}</span>
        </div>
      </div>
      <div className="forecast" aria-label={`Forecast: ${Math.round(f.winChance * 100)} percent win chance`}>
        <span>{club.abbreviation} {Math.round(f.winChance * 100)}%</span>
        <div className="forecast-bar">
          <div style={{ width: `${f.winChance * 100}%`, background: club.colors.primary }} />
        </div>
        <span>{Math.round((1 - f.winChance) * 100)}% {opp.abbreviation}</span>
      </div>
      <p className="event-context">{ev.context}</p>
      <ol className="mini-lineup">
        {lineup.battingOrder.map((slot, i) => {
          const p = s.players[slot.playerId];
          return (
            <li key={slot.playerId} className={p.fitness < BALANCE.fitness.warnBelow ? 'tired' : ''}>
              <span className="order">{i + 1}</span>
              <span className="name">
                {shortName(p)} <span className="ovr-inline" title="Overall at this position">{overallAt(p, slot.position)}</span>
              </span>
              <span className="pos">{slot.position}</span>
              <span className="fat" title={`Fitness: ${fitnessLabel(p.fitness)}`}>
                {p.fitness < BALANCE.fitness.warnBelow ? '⚠ ' : ''}{p.fitness}%
              </span>
            </li>
          );
        })}
        <li className={sp && sp.fitness < BALANCE.fitness.warnBelow ? 'tired' : ''}>
          <span className="order">SP</span>
          <span className="name">{sp ? shortName(sp) : '—'}</span>
          <span className="pos">{sp ? Math.round(effectiveRating(sp, 'pitching')) : ''}</span>
          <span className="fat">{sp?.fitness}%</span>
        </li>
      </ol>
      <a className="link" href={href('team')}>
        Edit lineup on the Team page →
      </a>
    </div>
  );
}

export function ContinueButton({ ev }: { ev: EventInstance }) {
  const c = useController();
  const s = useGame();
  const snap = useSnapshot();
  const next = s.nextEvent;
  const label = next ? (next.type === 'leagueGame' ? 'League game' : SLOT_LABELS[next.templateId] ?? next.title) : 'End of the day';
  const onClick = () => void c.dispatch({ type: 'acknowledgeEvent', eventId: ev.id });
  const ref = useRef<HTMLButtonElement>(null);
  // The confirm button that had focus is gone; keep keyboard users on the primary action.
  useEffect(() => ref.current?.focus({ preventScroll: true }), []);
  return (
    <button ref={ref} className="btn btn-primary btn-confirm" onClick={onClick} disabled={snap.busy}>
      <span>Continue</span>
      <span className="btn-cost">
        <small>Next: {label}</small>
        <Icon name="chevron" />
      </span>
    </button>
  );
}

function EventResult({ ev }: { ev: EventInstance }) {
  const s = useGame();
  const r = ev.resolution!;
  return (
    <section className="event-card" aria-live="polite">
      <Ribbon>{ev.kicker} · Result</Ribbon>
      <h1 className="event-title result-title">{r.headline}</h1>
      <p className="muted">
        You chose <strong>{r.optionLabel}</strong>
        {r.boostId ? ' with extra coaching' : ''}.
      </p>
      {r.narrative.map((n, i) => (
        <p key={i} className="event-context">
          {n}
        </p>
      ))}
      {r.reactions.length > 0 && <Reactions reactions={r.reactions} />}
      <h2 className="subhead">What changed</h2>
      <EffectList effects={r.effects} />
      <ContinueButton ev={ev} />
      {s.nextEvent === null && <p className="muted">That was the last event today.</p>}
    </section>
  );
}

export function Reactions({ reactions }: { reactions: { playerId: string; text: string }[] }) {
  const s = useGame();
  return (
    <ul className="reactions">
      {reactions.map((r, i) => {
        const p = s.players[r.playerId];
        return (
          <li key={i}>
            <PlayerAvatar player={p} club={s.clubs[p.clubId]} size={44} />
            <div>
              <strong>{shortName(p)}</strong>
              <q>{r.text}</q>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
