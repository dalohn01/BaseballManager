import { useState } from 'react';
import { optionBlocker } from '../../application/engine';
import { bestLineup, draftErrors, draftFromClub, draftIssues, rotateTired, suggestOrder, suggestPitching, type LineupDraft } from '../../domain/lineupDraft';
import { playerNotes, type StatsPeriod } from '../../domain/playerStats';
import type { EventInstance, GameState } from '../../domain/state';
import { clubName, userClub } from '../../domain/state';
import { describeLineupChange, forecastForLineup } from '../../events/templates/leagueGame';
import { Crest } from '../components/art';
import { Icon } from '../components/icons';
import { useController, useGame, useNow, useSnapshot } from '../hooks';
import { BattingTab } from './BattingTab';
import { FieldTab } from './FieldTab';
import { PitchersTab } from './PitchersTab';
import { opponentReport } from '../../simulation/opponentReport';
import { MatchPlanSummary, TacticsDialog } from '../tactics/TacticsControls';
import type { DataMode } from './shared';

export type Tab = 'field' | 'order' | 'pitchers';

export interface DraftApi {
  state: GameState;
  draft: LineupDraft;
  /** Edits the draft only; nothing is saved to the game until confirmation. */
  update: (next: LineupDraft) => void;
  /** Quick actions show what changed and can be undone. */
  quick: (label: string, next: LineupDraft) => void;
  mode: DataMode;
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
  const [tab, setTab] = useState<Tab>(() => readPref('pmTab', ['field', 'order', 'pitchers'] as const, 'field'));
  const [mode, setMode] = useState<DataMode>(() => readPref('pmMode', ['attributes', 'stats'] as const, 'attributes'));
  const [period, setPeriod] = useState<StatsPeriod>(() => readPref('pmPeriod', ['season', 'last5'] as const, 'season'));
  const [notice, setNotice] = useState<{ label: string; changes: string[]; undo: LineupDraft } | null>(null);
  const [tactics, setTactics] = useState<{ playerId: string | null } | null>(null);

  const update = (next: LineupDraft) => {
    setDraft(next);
    saveDraft(ev.id, next);
  };
  const quick = (label: string, next: LineupDraft) => {
    const changes = describeLineupChange(s, draft.lineup, next.lineup);
    if (draft.plan.relieverId !== next.plan.relieverId && next.plan.relieverId) changes.push(`Reliever: ${s.players[next.plan.relieverId].lastName}`);
    const rested = next.plan.rest.filter((id) => !draft.plan.rest.includes(id));
    if (rested.length) changes.push(`Rest today: ${rested.map((id) => s.players[id].lastName).join(', ')}`);
    setNotice({ label, changes, undo: draft });
    update(next);
  };
  const api: DraftApi = { state: s, draft, update, quick, mode, period, openTactics: (playerId) => setTactics({ playerId }) };

  const game = s.schedule.find((g) => g.id === String(ev.data.gameId))!;
  const isHome = game.homeId === s.userClubId;
  const opp = s.clubs[isHome ? game.awayId : game.homeId];
  const club = userClub(s);
  const option = ev.options.find((o) => o.id === 'current') ?? ev.options[0];
  const issues = draftIssues(s, draft);
  const errors = issues.filter((i) => i.severity === 'error');
  const blocker = optionBlocker(s, ev, option, null, now) ?? errors[0]?.text ?? null;
  const win = errors.length === 0 ? forecastForLineup(s, game.id, draft.lineup) : null;

  const starters = draft.lineup.battingOrder.map((x) => s.players[x.playerId]);
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
    <div className="prematch">
      <header className="pm-head">
        <span className="ribbon">Pre-match</span>
        <h1 className="pm-title">Set your lineup</h1>
        <div className="pm-matchup">
          <Crest club={club} size={44} />
          <div>
            <strong>
              {club.name} <span className="muted">vs</span> {clubName(opp)}
            </strong>
            <small>
              {isHome ? 'Home' : 'Away'} · Round {ev.round}
            </small>
          </div>
          <Crest club={opp} size={44} />
        </div>
        <p className="pm-tagline muted">Choose who starts. Keep your squad ready and motivated.</p>
      </header>

      <div className="pm-toolbar">
        <Segmented label="View" value={tab} onChange={setAndStore<Tab>('pmTab', setTab)} options={[['field', 'Field'], ['order', 'Batting order'], ['pitchers', 'Pitchers']]} role="tablist" />
        <Segmented label="Data" value={mode} onChange={setAndStore<DataMode>('pmMode', setMode)} options={[['attributes', 'Attributes'], ['stats', 'Stats']]} />
        {mode === 'stats' && (
          <Segmented
            label="Period"
            value={period}
            onChange={setAndStore<StatsPeriod>('pmPeriod', setPeriod)}
            options={[['season', 'Season'], ['last5', 'Last 5 games']]}
            hint="Season: this season through the last completed game. Last 5 games: your club's five latest games (a player who did not play shows no sample)."
          />
        )}
      </div>

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

      <OpponentReport gameId={String(ev.data.gameId)} onAdjust={() => setTactics({ playerId: null })} />
      <MatchPlanSummary />

      <div className="pm-body">
        {tab === 'field' && <FieldTab api={api} />}
        {tab === 'order' && <BattingTab api={api} />}
        {tab === 'pitchers' && <PitchersTab api={api} gameId={game.id} />}
      </div>

      <footer className="pm-footer">
        <div className="pm-quick">
          {tab === 'field' && (
            <>
              <QuickButton icon="trophy" label="Best lineup" onClick={() => quick('Best lineup', bestLineup(s, draft))} />
              <QuickButton icon="rest" label="Rotate tired players" onClick={() => quick('Rotate tired players', rotateTired(s, draft))} />
            </>
          )}
          {tab === 'order' && (
            <>
              <QuickButton icon="chart" label="Suggest order" onClick={() => quick('Suggest order', suggestOrder(s, draft))} />
              <QuickButton icon="back" label="Reset" onClick={() => quick('Reset', { ...draft, lineup: { ...draft.lineup, battingOrder: resetOrder(s, draft) } })} />
            </>
          )}
          {tab === 'pitchers' && (
            <>
              <QuickButton icon="trophy" label="Suggest setup" onClick={() => quick('Suggest setup', suggestPitching(s, draft))} />
              <QuickButton icon="back" label="Reset" onClick={() => quick('Reset', { ...draft, lineup: { ...draft.lineup, pitcherId: club.lineup.pitcherId }, plan: structuredClone(club.pitchingPlan) })} />
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
            <span className="btn-cost">
              <Icon name="time" size={16} /> {s.time.mode === 'unlimited' ? '∞' : option.cost.time}
            </span>
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

/** Reset the batting order to the saved lineup's order for players who are still in the draft. */
function resetOrder(s: GameState, d: LineupDraft) {
  const saved = userClub(s).lineup.battingOrder.map((x) => x.playerId);
  return [...d.lineup.battingOrder].sort((a, b) => {
    const ia = saved.indexOf(a.playerId);
    const ib = saved.indexOf(b.playerId);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
  });
}
