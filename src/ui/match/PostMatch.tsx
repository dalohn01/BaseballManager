import { useEffect, useRef, useState } from 'react';
import type { EffectRecord, EventInstance, GameState, LedgerEntry } from '../../domain/state';
import { clubName, playerName, shortName, userClub } from '../../domain/state';
import type { MatchResult, PlayerId } from '../../domain/types';
import { ballparkName } from '../../content/ballparks';
import { presentedBox, standouts } from '../../presentation/boxscore';
import type { CommentaryStep } from '../../presentation/commentary';
import { matchRecap, pitcherDecisions } from '../../presentation/decisions';
import { Crest } from '../components/art';
import { Icon } from '../components/icons';
import { PlayerAvatar } from '../components/PlayerAvatar';
import { moneyExact, signed } from '../format';
import { useGame } from '../hooks';
import { ContinueButton, Reactions } from '../screens/EventCard';
import { LineScore } from '../screens/MatchView';
import { ArenaArt } from './MatchIntro';
import { BoxScoreDialog } from './MatchSummaryPanel';

type Page = 'match' | 'club';

/**
 * The post-match screen the match view transitions into, in two steps:
 * the Match report (score, pitchers of record, highlights, player updates),
 * then the Club report (crowd, the game's income and costs, club cash, fan and
 * board reactions) with the Continue button. Everything shown was already
 * decided and saved when the lineup was confirmed; this only presents it.
 */
export function PostMatch({ ev, match, steps, reduced, onBack }: { ev: EventInstance; match: MatchResult; steps: CommentaryStep[]; reduced: boolean; onBack: () => void }) {
  const [page, setPage] = useState<Page>('match');
  const topRef = useRef<HTMLElement>(null);
  useEffect(() => {
    // The screen replaces the match view, so start from the top of the page.
    window.scrollTo({ top: 0, behavior: reduced ? 'auto' : 'smooth' });
    topRef.current?.focus({ preventScroll: true });
  }, [reduced, page]);
  const go = (p: Page) => setPage(p);
  return (
    <div className={`post-match ${reduced ? 'reduced' : ''}`} key={page}>
      {page === 'match' ? (
        <MatchReport ev={ev} match={match} steps={steps} topRef={topRef} onPage={go} onBack={onBack} />
      ) : (
        <ClubReport ev={ev} match={match} topRef={topRef} onPage={go} />
      )}
    </div>
  );
}

function Steps({ page, onPage }: { page: Page; onPage: (p: Page) => void }) {
  return (
    <nav className="post-steps" aria-label="Post-match reports">
      <button className={page === 'match' ? 'on' : ''} aria-current={page === 'match' ? 'step' : undefined} onClick={() => onPage('match')}>
        Match report
      </button>
      <span aria-hidden="true">›</span>
      <button className={page === 'club' ? 'on' : ''} aria-current={page === 'club' ? 'step' : undefined} onClick={() => onPage('club')}>
        Club report
      </button>
    </nav>
  );
}

function finalTail(m: MatchResult) {
  return m.walkOff ? 'Walk-off' : m.decidedBy === 'suddenDeath' ? 'Prototype sudden-death' : m.innings > 9 ? `${m.innings} innings` : null;
}

// ---------------------------------------------------------------- Match report

function MatchReport({ ev, match, steps, topRef, onPage, onBack }: { ev: EventInstance; match: MatchResult; steps: CommentaryStep[]; topRef: React.RefObject<HTMLElement | null>; onPage: (p: Page) => void; onBack: () => void }) {
  const s = useGame();
  const r = ev.resolution!;
  const [boxOpen, setBoxOpen] = useState(false);
  const home = s.clubs[match.homeId];
  const away = s.clubs[match.awayId];
  const userSide = match.homeId === s.userClubId ? 'home' : 'away';
  const won = match.runs[userSide] > match.runs[userSide === 'home' ? 'away' : 'home'];
  const tail = finalTail(match);
  const last = steps.length - 1;
  const picks = last >= 0 ? standouts(match, steps, last) : [];
  const box = last >= 0 ? presentedBox(match, steps, last) : null;
  const decisions = pitcherDecisions(match);
  const recap = matchRecap(match, { [home.id]: home.name, [away.id]: away.name });
  // Manager notes from the game (the crowd moves to the club report).
  const notes = r.narrative.filter((n) => !/ fans at /.test(n) && !/^Construction finished|^Happening ended/.test(n));
  const pitchLine = (id: PlayerId) => {
    const l = box ? Object.values(box.pitching).flat().find((x) => x.id === id) : null;
    return l ? `${Math.floor(l.outs / 3)}.${l.outs % 3} IP · ${l.r} R · ${l.k} K` : '';
  };
  const cards = (
    [
      ['win', 'Win', decisions.win],
      ['loss', 'Loss', decisions.loss],
      ['save', 'Save', decisions.save],
    ] as const
  ).filter(([, , id]) => id && s.players[id]);

  return (
    <>
      <section ref={topRef} tabIndex={-1} className={`post-hero ${won ? 'won' : 'lost'}`} aria-label="Final score">
        <Steps page="match" onPage={onPage} />
        <span className="post-final">Final{tail ? ` · ${tail}` : ''}</span>
        <div className="post-score">
          <div className="post-side">
            <Crest club={away} size={64} />
            <span>{clubName(away)}</span>
          </div>
          <strong className="post-runs">
            {match.runs.away} <span aria-hidden="true">–</span> {match.runs.home}
          </strong>
          <div className="post-side">
            <Crest club={home} size={64} />
            <span>{clubName(home)}</span>
          </div>
        </div>
        <h1 className="post-headline">{r.headline}</h1>
        <div className="post-linescore">
          <LineScore m={match} />
          {steps.length > 0 && (
            <button className="link small post-box-link" onClick={() => setBoxOpen(true)}>
              Full box score →
            </button>
          )}
        </div>
      </section>

      {cards.length > 0 && (
        <div className="post-decisions" aria-label="Pitchers of record">
          {cards.map(([kind, label, id]) => {
            const p = s.players[id!];
            const club = s.clubs[p.clubId] ?? s.clubs[match.homeId];
            return (
              <div key={kind} className={`post-decision ${kind}`}>
                <PlayerAvatar player={p} club={club} size={72} />
                <span>
                  <span className="post-tag">{label}</span>
                  <strong>{playerName(p)}</strong>
                  <small>
                    {club.name} · {pitchLine(p.id)}
                  </small>
                </span>
              </div>
            );
          })}
        </div>
      )}

      <div className="post-columns">
        <section className="panel post-story" aria-label="Match highlights">
          <header className="panel-head">
            <h2>Match highlights</h2>
          </header>
          <div className="panel-body">
            <p className="post-recap">{recap}</p>
            {picks.length > 0 && (
              <>
                <h3 className="subhead">Standouts</h3>
                <ul className="ms-standouts">
                  {picks.map((p) => {
                    const pl = s.players[p.id];
                    if (!pl) return null;
                    return (
                      <li key={p.id}>
                        <PlayerAvatar player={pl} club={s.clubs[pl.clubId] ?? s.clubs[p.clubId]} size={44} />
                        <span>
                          <strong>{shortName(pl)}</strong> <small className="muted">{s.clubs[p.clubId]?.name}</small>
                          <span className="ms-line">{p.line}</span>
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </>
            )}
            {notes.length > 0 && (
              <details className="more">
                <summary>Manager notes ({notes.length})</summary>
                <ul className="post-notes">
                  {notes.map((n, i) => (
                    <li key={i}>{n}</li>
                  ))}
                </ul>
              </details>
            )}
            {r.reactions.length > 0 && <Reactions reactions={r.reactions} />}
          </div>
        </section>

        <section className="panel post-changes" aria-label="Player updates">
          <header className="panel-head">
            <h2>Player updates</h2>
          </header>
          <div className="panel-body">
            <PlayerUpdates s={s} effects={r.effects} />
            <button className="btn btn-primary btn-confirm" onClick={() => onPage('club')}>
              <span>Continue</span>
              <span className="btn-cost">
                <small>Next: Club report</small>
                <Icon name="chevron" />
              </span>
            </button>
            <button className="link post-back" onClick={onBack}>
              <Icon name="back" size={16} /> Back to the match view
            </button>
          </div>
        </section>
      </div>
      {boxOpen && <BoxScoreDialog match={match} steps={steps} index={last} onClose={() => setBoxOpen(false)} />}
    </>
  );
}

/** Priority for the player list: happiness first, then ratings, then fitness. */
const STAT_ORDER: Record<string, number> = { satisfaction: 0, contact: 1, power: 1, speed: 1, fielding: 1, pitching: 1, popularity: 2, fitness: 3 };

function PlayerUpdates({ s, effects }: { s: GameState; effects: EffectRecord[] }) {
  const byPlayer = new Map<PlayerId, EffectRecord[]>();
  for (const e of effects) {
    if (e.targetKind !== 'player' || !s.players[e.targetId]) continue;
    byPlayer.set(e.targetId, [...(byPlayer.get(e.targetId) ?? []), e]);
  }
  const rows = [...byPlayer.entries()]
    .map(([id, list]) => ({ id, list: [...list].sort((a, b) => (STAT_ORDER[a.stat] ?? 2) - (STAT_ORDER[b.stat] ?? 2)) }))
    .sort((a, b) => (STAT_ORDER[a.list[0].stat] ?? 2) - (STAT_ORDER[b.list[0].stat] ?? 2) || Math.abs(b.list[0].after - b.list[0].before) - Math.abs(a.list[0].after - a.list[0].before));
  if (rows.length === 0) return <p className="muted">No player changes from this game.</p>;
  const important = rows.filter((r) => r.list[0].stat !== 'fitness');
  const shown = (important.length ? important : rows).slice(0, 4);
  const rest = rows.filter((r) => !shown.includes(r));
  const row = (r: (typeof rows)[number]) => {
    const p = s.players[r.id];
    const reason = r.list.find((e) => e.reason)?.reason;
    return (
      <li key={r.id}>
        <PlayerAvatar player={p} club={s.clubs[p.clubId]} size={52} />
        <span className="pu-body">
          <strong className="pu-name">{shortName(p)}</strong>
          <span className="pu-changes">
            {r.list.map((e, i) => (
              <DeltaChip key={i} e={e} />
            ))}
          </span>
          {reason && <small className="muted">{reason}.</small>}
        </span>
      </li>
    );
  };
  return (
    <>
      <ul className="post-updates">{shown.map(row)}</ul>
      {rest.length > 0 && (
        <details className="more">
          <summary>All player changes ({rows.length})</summary>
          <ul className="post-updates compact">{rest.map(row)}</ul>
        </details>
      )}
    </>
  );
}

function DeltaChip({ e }: { e: EffectRecord }) {
  // Satisfaction drifts in fractions; the screen shows whole points.
  const before = Math.round(e.before);
  const after = Math.round(e.after);
  const good = e.after > e.before;
  return (
    <span className={`delta-chip ${good ? 'up' : 'down'}`}>
      {e.statLabel} <span>{before}</span> <span aria-hidden="true">→</span>
      <span className="sr-only"> to </span> <strong>{after}</strong>
    </span>
  );
}

// ----------------------------------------------------------------- Club report

const INCOME_ICON = { tickets: 'fans', sponsor: 'chart', event: 'clipboard', facility: 'stadium', salaries: 'person', upkeep: 'gear' } as const;

function ClubReport({ ev, match, topRef, onPage }: { ev: EventInstance; match: MatchResult; topRef: React.RefObject<HTMLElement | null>; onPage: (p: Page) => void }) {
  const s = useGame();
  const r = ev.resolution!;
  const club = userClub(s);
  const isHome = match.homeId === s.userClubId;
  const home = s.clubs[match.homeId];
  const away = s.clubs[match.awayId];
  const entries: LedgerEntry[] = s.ledger.filter((l) => l.eventId === ev.id);
  const income = entries.filter((l) => l.amount > 0);
  const costs = entries.filter((l) => l.amount < 0);
  const totalIn = income.reduce((a, l) => a + l.amount, 0);
  const totalOut = -costs.reduce((a, l) => a + l.amount, 0);
  const net = totalIn - totalOut;
  const cashBefore = entries.length ? entries[0].balanceAfter - entries[0].amount : club.cash;
  const cashAfter = entries.length ? entries[entries.length - 1].balanceAfter : club.cash;
  const gate = match.gate ?? gateFromLedger(entries);
  const reactions = r.effects.filter((e) => e.targetKind === 'club' && (e.stat === 'fanSupport' || e.stat === 'ownerConfidence'));
  const clubNotes = r.narrative.filter((n) => /^Construction finished|^Happening ended/.test(n));
  const park = ballparkName(home);
  const winner = match.runs.home > match.runs.away ? home : away;
  const loser = winner === home ? away : home;

  return (
    <>
      <section ref={topRef} tabIndex={-1} className="post-hero club" aria-label="Club report">
        <Steps page="club" onPage={onPage} />
        <h1 className="post-headline">Club report</h1>
        <p className="post-sub">
          {park} · Season {match.season}, Round {match.round}
        </p>
        <span className="post-final small-final">
          Final · {winner.name} {Math.max(match.runs.home, match.runs.away)}–{Math.min(match.runs.home, match.runs.away)} {loser.name}
        </span>
      </section>

      <div className="club-top">
        <section className="panel club-gate" aria-label="Attendance">
          <div className="club-gate-art" aria-hidden="true">
            <ArenaArt club={home} name={park} />
          </div>
          <div className="club-gate-text">
            <h2>Attendance</h2>
            {isHome && gate ? (
              <>
                <strong className="club-big">{gate.attendance.toLocaleString('en-US')}</strong>
                <span>Fans at {park}</span>
                {gate.capacity > 0 && (
                  <small className="muted">
                    {Math.round((gate.attendance / gate.capacity) * 100)}% capacity · {gate.capacity.toLocaleString('en-US')} seats
                  </small>
                )}
              </>
            ) : (
              <>
                <strong className="club-big road">Road game</strong>
                <span>At {park}: no gate income for us.</span>
              </>
            )}
          </div>
        </section>
        <section className="panel club-net" aria-label="Net match income">
          <header className="panel-head">
            <h2>Net match income</h2>
          </header>
          <div className="panel-body">
            <strong className={`club-net-value ${net >= 0 ? 'pos' : 'neg'}`}>
              {net >= 0 ? '+' : '−'}
              {moneyExact(Math.abs(net)).replace('−', '')}
            </strong>
            <p className="muted">
              Income {moneyExact(totalIn)} · Costs {moneyExact(totalOut)}
            </p>
          </div>
        </section>
      </div>

      <div className="club-money">
        <MoneyList title="Income" rows={income} total={totalIn} sign="+" />
        <MoneyList title="Costs" rows={costs} total={totalOut} sign="−" />
      </div>

      <section className="panel club-cash" aria-label="Club cash">
        <h2>Club cash</h2>
        <span className="club-cash-icon" aria-hidden="true">
          <Icon name="cash" size={26} />
        </span>
        <span>
          <small>Before match</small>
          <strong>{moneyExact(cashBefore)}</strong>
        </span>
        <span className="club-arrow" aria-hidden="true">
          →
        </span>
        <span>
          <small>After match</small>
          <strong>{moneyExact(cashAfter)}</strong>
        </span>
        <span className={`club-cash-delta ${net >= 0 ? 'pos' : 'neg'}`}>
          {net >= 0 ? '+' : '−'}
          {moneyExact(Math.abs(cashAfter - cashBefore)).replace('−', '')}
        </span>
      </section>

      <section className="panel" aria-label="Club reactions">
        <header className="panel-head">
          <h2>Club reactions</h2>
        </header>
        <div className="panel-body">
          {reactions.length === 0 ? (
            <p className="muted">Fans and owners took the result in their stride.</p>
          ) : (
            <ul className="club-reactions">
              {reactions.map((e, i) => (
                <li key={i}>
                  <span className="club-react-icon" aria-hidden="true">
                    <Icon name={e.stat === 'fanSupport' ? 'fans' : 'stadium'} size={30} />
                  </span>
                  <span>
                    <strong>{e.stat === 'fanSupport' ? 'Fans' : 'Board'}</strong>
                    <span className="club-react-line">
                      <DeltaChip e={e} />
                      <span className={`delta-chip ${e.after > e.before ? 'up' : 'down'}`}>{signed(Math.round(e.after) - Math.round(e.before))}</span>
                    </span>
                    {e.reason && <small className="muted">{e.reason}.</small>}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {clubNotes.length > 0 && (
            <ul className="post-notes">
              {clubNotes.map((n, i) => (
                <li key={i}>{n}</li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <div className="club-footer">
        <button className="link post-back" onClick={() => onPage('match')}>
          <Icon name="back" size={16} /> Back to Match report
        </button>
        <ContinueButton ev={ev} />
      </div>
    </>
  );
}

/** Older saves: the crowd is read from the ticket line ("Ticket sales (6,743 fans)"). */
function gateFromLedger(entries: LedgerEntry[]): { attendance: number; capacity: number } | null {
  const t = entries.find((l) => l.category === 'tickets');
  const m = t?.note.match(/\(([\d,]+) fans\)/);
  return m ? { attendance: Number(m[1].replace(/,/g, '')), capacity: 0 } : null;
}

function MoneyList({ title, rows, total, sign }: { title: string; rows: LedgerEntry[]; total: number; sign: '+' | '−' }) {
  return (
    <section className="panel club-list" aria-label={title}>
      <header className="panel-head">
        <h2>{title}</h2>
      </header>
      <div className="panel-body">
        {rows.length === 0 ? (
          <p className="muted">None this game.</p>
        ) : (
          <ul>
            {rows.map((l) => {
              const [label, detail] = splitNote(l);
              return (
                <li key={l.id}>
                  <span className={`club-list-icon ${sign === '+' ? 'in' : 'out'}`} aria-hidden="true">
                    <Icon name={INCOME_ICON[l.category] ?? 'cash'} size={20} />
                  </span>
                  <span>
                    <strong>{label}</strong>
                    {detail && <small className="muted">{detail}</small>}
                  </span>
                  <span className={`club-amount ${sign === '+' ? 'pos' : 'neg'}`}>
                    {sign}
                    {moneyExact(Math.abs(l.amount))}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
        <p className="club-total">
          <span>Total {title.toLowerCase()}</span>
          <strong>{moneyExact(total)}</strong>
        </p>
      </div>
    </section>
  );
}

/** "Ticket sales (6,743 fans)" → ["Ticket sales", "6,743 spectators"]; "Sponsor: X" → ["Sponsorship", "X"]. */
function splitNote(l: LedgerEntry): [string, string | null] {
  const fans = l.note.match(/^(.*) \(([\d,]+) fans\)$/);
  if (fans) return [fans[1], `${fans[2]} spectators`];
  const sponsor = l.note.match(/^Sponsor: (.*)$/);
  if (sponsor) return ['Sponsorship', sponsor[1]];
  return [l.note, null];
}
