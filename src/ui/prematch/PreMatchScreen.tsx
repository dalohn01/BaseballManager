import { closeLineup } from '../match/MatchDay';
import { useState } from 'react';
import { optionBlocker } from '../../application/engine';
import { bestLineup, draftErrors, draftFromClub, draftIssues, suggestPitching, type LineupDraft } from '../../domain/lineupDraft';
import { playerNotes, type StatsPeriod } from '../../domain/playerStats';
import type { EventInstance, GameState } from '../../domain/state';
import { clubName, userClub } from '../../domain/state';
import { describeLineupChange, forecastForLineup } from '../../events/templates/leagueGame';
import { Crest } from '../components/art';
import { Icon } from '../components/icons';
import { useController, useGame, useNow, useSnapshot } from '../hooks';
import { BattersTab } from './BattersTab';
import { PitchersTab } from './PitchersTab';
import { opponentReport } from '../../simulation/opponentReport';
import { MatchPlanSummary, TacticsDialog } from '../tactics/TacticsControls';
import { RELIEF_SLOTS, SLOT_LABEL } from '../../domain/todayPitching';
import { TeamStatusBar } from '../components/Modifiers';

export type Tab = 'batters' | 'pitchers';

export interface DraftApi {
  state: GameState;
  draft: LineupDraft;
  /** Edits the draft only; nothing is saved to the game until confirmation. */
  update: (next: LineupDraft) => void;
  /** Quick actions show what changed and can be undone. */
  quick: (label: string, next: LineupDraft) => void;
  period: StatsPeriod;
  /** Opens tactics (team, or one player's instructions) without leaving the lineup. */
  openTactics: (playerId: string | null) => void;
}

const draftKey = (eventId: string) => `bm.draft.${eventId}`;

function loadDraft(state: GameState, eventId: string): LineupDraft | null {
  try {
    const raw = localStorage.getItem(draftKey(eventId));
    if (!raw) return null;
    const d = JSON.parse(raw) as LineupDraft;
    // The squad may have changed since the draft was saved: only a still-valid draft is restored.
    return draftErrors(state, d).length === 0 ? d : null;
  } catch {
    return null;
  }
}
function saveDraft(eventId: string, d: LineupDraft | null) {
  try {
    if (d) localStorage.setItem(draftKey(eventId), JSON.stringify(d));
    else localStorage.removeItem(draftKey(eventId));
  } catch {
    /* the draft simply is not kept across reloads */
  }
}
function readPref<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  try {
    const v = localStorage.getItem(`bm.${key}`) as T | null;
    return v && allowed.includes(v) ? v : fallback;
  } catch {
    return fallback;
  }
}
function writePref(key: string, v: string) {
  try {
    localStorage.setItem(`bm.${key}`, v);
  } catch {
    /* per-viewer convenience only */
  }
}

/**
 * Pre-match team selection: Field, Batting order and Pitchers edit one shared
 * draft. Confirm sends the draft together with the league game decision, so the
 * lineup and the game are applied as one unit (one Time charge, no double game).
 */
export function PreMatchScreen({ ev }: { ev: EventInstance }) {
  const s = useGame();
  const c = useController();
  const snap = useSnapshot();
  const now = useNow(5000);
  const [draft, setDraft] = useState<LineupDraft>(() => loadDraft(s, ev.id) ?? draftFromClub(s));
  // What the screen opened with: Reset on the Pitchers tab returns today's pitching to it.
  const [opened] = useState(draft);
  const [tab, setTab] = useState<Tab>(() => readPref('pmTab', ['batters', 'pitchers'] as const, 'batters'));
  const [showInfo, setShowInfo] = useState(() => readPref('pmInfo', ['shown', 'hidden'] as const, 'hidden') === 'shown');
  const [period, setPeriod] = useState<StatsPeriod>(() => readPref('pmPeriod', ['season', 'last5'] as const, 'season'));
  const [notice, setNotice] = useState<{ label: string; changes: string[]; undo: LineupDraft } | null>(null);
  const [tactics, setTactics] = useState<{ playerId: string | null } | null>(null);

  const update = (next: LineupDraft) => {
    setDraft(next);
    saveDraft(ev.id, next);
  };
  const quick = (label: string, next: LineupDraft) => {
    const changes = describeLineupChange(s, draft.lineup, next.lineup);
    for (const slot of RELIEF_SLOTS) {
      const id = next.plan.bullpen?.[slot];
      if (id && id !== draft.plan.bullpen?.[slot]) changes.push(`${SLOT_LABEL[slot]}: ${s.players[id].lastName}`);
    }
    setNotice({ label, changes, undo: draft });
    update(next);
  };
  const api: DraftApi = { state: s, draft, update, quick, period, openTactics: (playerId) => setTactics({ playerId }) };

  const game = s.schedule.find((g) => g.id === String(ev.data.gameId))!;
  const isHome = game.homeId === s.userClubId;
  const opp = s.clubs[isHome ? game.awayId : game.homeId];
  const club = userClub(s);
  const option = ev.options.find((o) => o.id === 'current') ?? ev.options[0];
  const issues = draftIssues(s, draft);
  const errors = issues.filter((i) => i.severity === 'error');
  const blocker = optionBlocker(s, ev, option, null, now) ?? errors[0]?.text ?? null;
  const win = errors.length === 0 ? forecastForLineup(s, game.id, draft.lineup) : null;

  const starters = draft.lineup.battingOrder.map((x) => s.players[x.playerId]).filter(Boolean);
  const bench = club.roster.map((id) => s.players[id]).filter((p) => !p.isPitcher && !starters.some((st) => st.id === p.id));
  const needRest = starters.filter((p) => playerNotes(s, p, { starting: true }).some((n) => n.text === 'Needs rest')).length;
  const wantStarts = bench.filter((p) => playerNotes(s, p, { starting: false }).some((n) => n.text === 'Wants playing time')).length;
  const promisedOut = s.promises.filter((pr) => pr.status === 'active' && !starters.some((p) => p.id === pr.playerId)).length;

  const confirm = () => {
    void c
      .dispatch({ type: 'resolveEvent', eventId: ev.id, revision: s.revision, optionId: option.id, boostId: null, selection: { lineup: draft.lineup, pitchingPlan: draft.plan } })
      .then((ok) => ok && saveDraft(ev.id, null));
  };
  const setAndStore = <T extends string>(key: string, set: (v: T) => void) => (v: T) => {
    set(v);
    writePref(key, v);
  };

  return (
    <div className={`prematch ${showInfo ? "info-open" : ""}`}>
      {/* One compact bar: title, matchup and the view controls, so the field gets the height. */}
      <header className="pm-head">
        <div className="pm-titles">
          <button className="link pm-back" onClick={closeLineup} aria-label="Back to match day">
            <Icon name="back" size={16} /> Match day
          </button>
          <span className="ribbon">Pre-match</span>
          <h1 className="pm-title">Set your lineup</h1>
        </div>
        <div className="pm-matchup">
          <Crest club={club} size={40} />
          <div>
            <strong>
              {club.name} <span className="muted">vs</span> {clubName(opp)}
            </strong>
            <small>
              {isHome ? 'Home' : 'Away'} · Round {ev.round}
            </small>
          </div>
          <Crest club={opp} size={40} />
        </div>
        <div className="pm-toolbar">
        <Segmented label="View" value={tab} onChange={setAndStore<Tab>('pmTab', setTab)} options={[['batters', 'Batters / Fielders'], ['pitchers', 'Pitchers']]} role="tablist" />
        <Segmented
          label="Stats"
          value={period}
          onChange={setAndStore<StatsPeriod>('pmPeriod', setPeriod)}
          options={[['season', 'Season'], ['last5', 'Last 5 games']]}
          hint="Season: this season through the last completed game. Last 5 games: your club's five latest games (a player who did not play shows no sample)."
        />
        <span className="pm-tools">
          <button className="btn btn-small btn-secondary" aria-expanded={showInfo} onClick={() => setAndStore<'shown' | 'hidden'>('pmInfo', (v) => setShowInfo(v === 'shown'))(showInfo ? 'hidden' : 'shown')}>
            {showInfo ? 'Hide' : 'Show'} scouting &amp; team status
          </button>
          <button className="btn btn-small btn-secondary" onClick={() => setTactics({ playerId: null })}>
            Adjust tactics
          </button>
        </span>
        </div>
      </header>

      {notice && (
        <div className="pm-notice" role="status">
          <strong>{notice.label}:</strong> {notice.changes.length ? notice.changes.join(' · ') : 'no changes needed'}
          <button className="btn btn-small btn-secondary" onClick={() => { update(notice.undo); setNotice(null); }}>
            Undo
          </button>
          <button className="icon-btn small" aria-label="Dismiss" onClick={() => setNotice(null)}>
            ✕
          </button>
        </div>
      )}

      {/* Scouting and Team status are folded away by default so the lineup gets the room. */}
      <div className="pm-info">
        {showInfo && <OpponentReport gameId={String(ev.data.gameId)} onAdjust={() => setTactics({ playerId: null })} />}
        <MatchPlanSummary />
        {showInfo && <TeamStatusBar state={s} />}
      </div>

      <div className="pm-body">
        {tab === 'batters' && <BattersTab api={api} />}
        {tab === 'pitchers' && <PitchersTab api={api} gameId={game.id} />}
      </div>

      <footer className="pm-footer">
        <div className="pm-quick">
          {tab === 'batters' && (
            <>
              <QuickButton icon="trophy" label="Suggest lineup" onClick={() => quick('Suggest lineup', { ...bestLineup(s, draft), lineup: { ...bestLineup(s, draft).lineup, pitcherId: draft.lineup.pitcherId } })} />
              <QuickButton icon="back" label="Reset" onClick={() => quick('Reset', { ...draft, lineup: { ...draft.lineup, battingOrder: structuredClone(opened.lineup.battingOrder) } })} />
            </>
          )}
          {tab === 'pitchers' && (
            <>
              <QuickButton icon="trophy" label="Suggest setup" onClick={() => quick('Suggest setup', suggestPitching(s, draft))} />
              <QuickButton icon="back" label="Reset" onClick={() => quick('Reset', { ...draft, lineup: { ...draft.lineup, pitcherId: opened.lineup.pitcherId }, plan: { ...draft.plan, bullpen: opened.plan.bullpen } })} />
            </>
          )}
        </div>
        <div className="pm-status" aria-live="polite">
          {errors.length ? (
            <span className="note-chip note-warn">! {errors[0].text}</span>
          ) : (
            <>
              {needRest > 0 && <span className="note-chip note-warn">! {needRest} starter{needRest > 1 ? 's' : ''} need{needRest > 1 ? '' : 's'} rest</span>}
              {wantStarts > 0 && <span className="note-chip note-warn">! {wantStarts} bench player{wantStarts > 1 ? 's' : ''} want{wantStarts > 1 ? '' : 's'} playing time</span>}
              {promisedOut > 0 && <span className="note-chip note-warn">! {promisedOut} promised player{promisedOut > 1 ? 's are' : ' is'} on the bench</span>}
              {win !== null && <span className="note-chip note-info">Forecast: {Math.round(win * 100)}% win chance</span>}
            </>
          )}
        </div>
        <div className="pm-confirm-bar">
          <button className="btn btn-primary pm-confirm" onClick={confirm} disabled={!!blocker || snap.busy} title={blocker ?? undefined}>
            <Icon name="check" /> {snap.busy ? 'Saving…' : 'Confirm lineup'}
          </button>
          {blocker && !errors.length && <p className="pm-blocker small">{blocker}</p>}
          {snap.commandError && <p className="pm-blocker small" role="alert">{snap.commandError}</p>}
        </div>
      </footer>
      {tactics && <TacticsDialog playerId={tactics.playerId} onClose={() => setTactics(null)} />}
    </div>
  );
}

/** Small, muted scouting note: at most three observations, each labelled by kind. */
function OpponentReport({ gameId, onAdjust }: { gameId: string; onAdjust: () => void }) {
  const s = useGame();
  const { opponentId, observations } = opponentReport(s, gameId);
  return (
    <aside className="opp-report" aria-label="Opponent report">
      <div className="opp-head">
        <strong>Opponent report · {s.clubs[opponentId].name}</strong>
        <button className="link opp-adjust" onClick={onAdjust}>
          Adjust tactics
        </button>
      </div>
      {observations.length === 0 ? (
        <p className="small muted">Nothing stands out about this opponent right now.</p>
      ) : (
        <ul>
          {observations.map((o) => (
            <li key={o.text}>
              <span className="opp-kind">{o.kind}</span> {o.text}
              {o.hint && <span className="muted"> {o.hint.text}</span>}
            </li>
          ))}
        </ul>
      )}
    </aside>
  );
}

function QuickButton({ icon, label, onClick }: { icon: 'trophy' | 'rest' | 'chart' | 'back'; label: string; onClick: () => void }) {
  return (
    <button className="btn btn-small btn-secondary" onClick={onClick}>
      <Icon name={icon} size={18} /> {label}
    </button>
  );
}

function Segmented<T extends string>({ label, value, onChange, options, role, hint }: { label: string; value: T; onChange: (v: T) => void; options: [T, string][]; role?: 'tablist'; hint?: string }) {
  return (
    <div className="segmented" role={role ?? 'group'} aria-label={label} title={hint}>
      {options.map(([v, text]) => (
        <button
          key={v}
          role={role ? 'tab' : undefined}
          aria-selected={role ? value === v : undefined}
          aria-pressed={role ? undefined : value === v}
          className={value === v ? 'on' : ''}
          onClick={() => onChange(v)}
        >
          {text}
        </button>
      ))}
    </div>
  );
}
