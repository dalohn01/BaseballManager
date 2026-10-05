import { closeLineup } from '../match/MatchDay';
import { useState } from 'react';
import { optionBlocker } from '../../application/engine';
import { draftErrors, draftFromClub, draftIssues, suggestPitching, type LineupDraft } from '../../domain/lineupDraft';
import { playerNotes, type StatsPeriod } from '../../domain/playerStats';
import type { EventInstance, GameState } from '../../domain/state';
import { clubName, userClub } from '../../domain/state';
import { Crest } from '../components/art';
import { describeLineupChange } from '../../events/templates/leagueGame';
import { validateBatters } from '../../domain/lineup';
import { Icon } from '../components/icons';
import { useController, useGame, useNow, useSnapshot } from '../hooks';
import { BattersTab } from './BattersTab';
import { PitchersTab } from './PitchersTab';
import { MatchPlanSummary, TacticsDialog } from '../tactics/TacticsControls';
import { RELIEF_SLOTS, SLOT_LABEL } from '../../domain/todayPitching';

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
  // Two steps: the nine batters first, then the pitchers; Confirm only on the second.
  const [tab, setTab] = useState<Tab>('batters');
  // Season stats in the rows (the header keeps only what the step needs).
  const period: StatsPeriod = 'season';
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
  const club = userClub(s);
  const isHome = game.homeId === s.userClubId;
  const opp = s.clubs[isHome ? game.awayId : game.homeId];
  const option = ev.options.find((o) => o.id === 'current') ?? ev.options[0];
  const issues = draftIssues(s, draft);
  const errors = issues.filter((i) => i.severity === 'error');
  const blocker = optionBlocker(s, ev, option, null, now) ?? errors[0]?.text ?? null;
  const batterErrors = validateBatters(s, s.userClubId, draft.lineup).filter((i) => i.severity === 'error');
  const goTo = (step: Tab) => {
    if (step === 'pitchers' && batterErrors.length) return;
    setTab(step);
    setNotice(null);
    window.scrollTo({ top: 0 });
  };

  const starters = draft.lineup.battingOrder.map((x) => s.players[x.playerId]).filter(Boolean);
  const needRest = starters.filter((p) => playerNotes(s, p, { starting: true }).some((n) => n.text === 'Needs rest')).length;
  const promisedOut = s.promises.filter((pr) => pr.status === 'active' && !starters.some((p) => p.id === pr.playerId)).length;

  const confirm = () => {
    void c
      .dispatch({ type: 'resolveEvent', eventId: ev.id, revision: s.revision, optionId: option.id, boostId: null, selection: { lineup: draft.lineup, pitchingPlan: draft.plan } })
      .then((ok) => ok && saveDraft(ev.id, null));
  };

  return (
    <div className="prematch">
      {/* One compact bar: the way back, the title and the matchup; the lineup gets the height. */}
      <header className="pm-head">
        <div className="pm-titles">
          <button className="link pm-back" onClick={closeLineup} aria-label="Back to match day">
            <Icon name="back" size={16} /> Match day
          </button>
          <span className="ribbon">Pre-match</span>
          <h1 className="pm-title">Set your lineup</h1>
        </div>
        <div className="pm-matchup">
          <Crest club={club} size={36} />
          <div>
            <strong>
              {club.name} <span className="muted">vs</span> {clubName(opp)}
            </strong>
            <small>
              {isHome ? 'Home' : 'Away'} · Round {ev.round}
            </small>
          </div>
          <Crest club={opp} size={36} />
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
        <MatchPlanSummary />
      </div>

      <div className="pm-body">
        {tab === 'batters' && <BattersTab api={api} />}
        {tab === 'pitchers' && <PitchersTab api={api} gameId={game.id} />}
      </div>

      <footer className="pm-footer">
        <div className="pm-quick">
          {tab === 'batters' && (
            <>
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
          {(tab === 'batters' ? batterErrors : errors).length ? (
            <span className="note-chip note-warn">! {(tab === 'batters' ? batterErrors : errors)[0].text}</span>
          ) : (
            <>
              {needRest > 0 && <span className="note-chip note-warn">! {needRest} starter{needRest > 1 ? 's' : ''} need{needRest > 1 ? '' : 's'} rest</span>}
              {promisedOut > 0 && <span className="note-chip note-warn">! {promisedOut} promised player{promisedOut > 1 ? 's are' : ' is'} on the bench</span>}
            </>
          )}
        </div>
        <div className="pm-confirm-bar">
          {tab === 'batters' ? (
            <button className="btn btn-primary pm-confirm" onClick={() => goTo('pitchers')} disabled={batterErrors.length > 0} title={batterErrors[0]?.text}>
              Next: Pitchers <Icon name="chevron" />
            </button>
          ) : (
            <>
              <button className="btn btn-secondary pm-step-back" onClick={() => goTo('batters')} aria-label="Back to batters">
                <Icon name="back" size={18} /> <span className="lbl">Batters</span>
              </button>
              <button className="btn btn-primary pm-confirm" onClick={confirm} disabled={!!blocker || snap.busy} title={blocker ?? undefined}>
                <Icon name="check" /> {snap.busy ? 'Saving…' : 'Confirm lineup'}
              </button>
            </>
          )}
          {tab === 'pitchers' && blocker && !errors.length && <p className="pm-blocker small">{blocker}</p>}
          {snap.commandError && <p className="pm-blocker small" role="alert">{snap.commandError}</p>}
        </div>
      </footer>
      {tactics && <TacticsDialog playerId={tactics.playerId} onClose={() => setTactics(null)} />}
    </div>
  );
}

function QuickButton({ icon, label, onClick }: { icon: 'trophy' | 'rest' | 'chart' | 'back'; label: string; onClick: () => void }) {
  return (
    <button className="btn btn-small btn-secondary" onClick={onClick}>
      <Icon name={icon} size={18} /> {label}
    </button>
  );
}

