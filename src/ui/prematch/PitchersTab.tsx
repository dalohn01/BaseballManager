import { BALANCE } from '../../balance/config';
import { pitcherRole, setHook, setPitcherRole } from '../../domain/lineupDraft';
import { fmtIp, pitcherWorkload, playerNotes } from '../../domain/playerStats';
import { normalizeStaff, pitcherReadiness, ROLE_LABEL, staffRole } from '../../domain/staff';
import { playerName, userClub } from '../../domain/state';
import type { Player, PitchingHook } from '../../domain/types';
import { forecastForLineup } from '../../events/templates/leagueGame';
import { Icon } from '../components/icons';
import { StaffEditor } from '../tactics/StaffEditor';
import { instructionSummary } from '../tactics/TacticsControls';
import type { DraftApi } from './PreMatchScreen';
import { FitnessMeter, HappinessMeter, Legend, Notes, pitcherValues, Portrait, Values } from './shared';

const HOOK_TEXT: Record<PitchingHook, string> = {
  early: 'Early',
  balanced: 'Balanced',
  long: 'Let him pitch',
};

function workloadText(state: DraftApi['state'], p: Player): string {
  const w = pitcherWorkload(state, p);
  if (!w.last) return 'No appearances yet this season';
  const when = w.last.gamesAgo === 1 ? 'last game' : `${w.last.gamesAgo} games ago`;
  return `Last outing: ${when} · ${w.last.battersFaced} batters, ${fmtIp(w.last.outs)} IP${w.last.started ? ' (start)' : ''}`;
}

/**
 * Pitching for today's game. The starter defaults to the next ready pitcher
 * in the rotation (changeable for this game only); the bullpen works from the
 * standing roles, which can be adjusted here too; a pitcher can be rested today.
 */
export function PitchersTab({ api, gameId }: { api: DraftApi; gameId: string }) {
  const { state: s, draft, update, mode, period } = api;
  const club = userClub(s);
  const staff = normalizeStaff(s, club.id, club.staff);
  const all = club.roster.map((id) => s.players[id]).filter((p) => p.isPitcher);
  // Rotation in order first, then the bullpen and depth.
  const order = (p: Player) => {
    const i = staff.rotation.indexOf(p.id);
    return i >= 0 ? i : 10 + ['closer', 'setup', 'long', 'depth'].indexOf(staffRole(staff, p.id));
  };
  const pitchers = [...all].sort((a, b) => order(a) - order(b) || a.id.localeCompare(b.id));
  const starter = s.players[draft.lineup.pitcherId];
  const others = pitchers.filter((p) => p.id !== starter.id);
  const alt = others.slice().sort((a, b) => b.ratings.pitching - a.ratings.pitching)[0];
  const winNow = forecastForLineup(s, gameId, draft.lineup);
  const winAlt = alt ? forecastForLineup(s, gameId, { ...draft.lineup, pitcherId: alt.id }) : null;
  const hook = BALANCE.match.hooks[draft.plan.hook];
  const turn = staff.rotation[staff.next];

  const roleTag = (p: Player) => {
    const i = staff.rotation.indexOf(p.id);
    if (i >= 0) return `Rotation #${i + 1}${p.id === turn ? ' · next in turn' : ''}`;
    return ROLE_LABEL[staffRole(staff, p.id)];
  };

  return (
    <div className="pm-pitch-layout">
      <section className="panel pm-starters">
        <header className="panel-head">
          <h2>Today's starter</h2>
          <small className="muted">The rotation decides; you can start someone else today.</small>
        </header>
        <ul className="starter-list">
          {pitchers.map((p) => {
            const isStarter = p.id === starter.id;
            return (
              <li key={p.id} className={`starter-card ${isStarter ? 'on' : ''}`}>
                <Portrait state={s} player={p} size={64} />
                <div className="sc-main">
                  <strong className="sc-name">{playerName(p)}</strong>
                  <small className="muted">
                    Throws {p.throws} · {roleTag(p)}
                  </small>
                  <Values vals={pitcherValues(s, p, mode, period)} />
                  <span className="pc-status">
                    <FitnessMeter value={p.fitness} showLabel />
                    <HappinessMeter value={p.satisfaction} />
                  </span>
                  <small className="readiness">{isStarter ? 'Starting today' : pitcherReadiness(s, p, staffRole(staff, p.id))}</small>
                  <small className="muted">{workloadText(s, p)}</small>
                  <small className="instr-line">
                    <span className="muted">Instructions:</span> {instructionSummary(s, p)}{' '}
                    <button className="link" onClick={() => api.openTactics(p.id)} aria-label={`Instructions for ${p.lastName}`}>
                      Change
                    </button>
                  </small>
                  <Notes notes={playerNotes(s, p, { starting: isStarter })} max={2} />
                </div>
                {isStarter ? (
                  <span className="starting-tag">
                    <Icon name="check" size={16} /> Starting today
                  </span>
                ) : (
                  <button className="btn btn-small btn-secondary" onClick={() => update(setPitcherRole(draft, p.id, 'starter'))}>
                    Start today
                  </button>
                )}
              </li>
            );
          })}
        </ul>
        {alt && winAlt !== null && (
          <div className="tradeoff">
            <Icon name="influence" size={22} />
            <div>
              <strong>Today's trade-off</strong>
              <p>
                {starter.lastName}: pitching {starter.ratings.pitching}, fitness {starter.fitness}%. {alt.lastName}: pitching {alt.ratings.pitching}, fitness {alt.fitness}%.
              </p>
              <p className="small muted">
                Forecast with {starter.lastName}: {Math.round(winNow * 100)}% · with {alt.lastName}: {Math.round(winAlt * 100)}%. Fitness below 100% lowers today's pitching by {BALANCE.match.fitnessPenaltyPerPoint} per point.
              </p>
            </div>
          </div>
        )}
      </section>

      <section className="panel pm-bullpen">
        <header className="panel-head">
          <h2>Bullpen</h2>
          <small className="muted">Standing roles (saved for every game). Up to {BALANCE.pitching.maxPitchersPerGame} pitchers per game.</small>
        </header>
        <StaffEditor todayStarterId={starter.id} compact bullpenOnly />

        <h3 className="subhead">Rest today</h3>
        <ul className="rest-list">
          {others.map((p) => {
            const resting = pitcherRole(draft, p.id) === 'rest';
            return (
              <li key={p.id} className={resting ? 'resting' : ''}>
                <span>
                  <strong>{playerName(p)}</strong> <small className="muted">{roleTag(p)} · {p.fitness}%</small>
                </span>
                <button className="btn btn-small btn-secondary" aria-pressed={resting} onClick={() => update(setPitcherRole(draft, p.id, resting ? 'available' : 'rest'))}>
                  {resting ? 'Resting today' : 'Available'}
                </button>
              </li>
            );
          })}
        </ul>

        <h3 className="subhead">When to take out the starter</h3>
        <div className="segmented" role="group" aria-label="When to replace the starter">
          {(Object.keys(HOOK_TEXT) as PitchingHook[]).map((h) => (
            <button key={h} className={draft.plan.hook === h ? 'on' : ''} aria-pressed={draft.plan.hook === h} onClick={() => update(setHook(draft, h))}>
              {HOOK_TEXT[h]}
            </button>
          ))}
        </div>
        <p className="small">
          The starter comes out after {hook.maxBatters} batters, or once he has allowed {hook.pullRuns} runs after at least {hook.minBatters} batters. Then long relief takes over to the{' '}
          {BALANCE.pitching.longReliefUntilInning}th, setup in the {BALANCE.pitching.setupFromInning}th–8th, and the closer in a save situation (a lead of {BALANCE.pitching.saveLead[0]}–
          {BALANCE.pitching.saveLead[1]} runs from the 9th). The hook setting stays for future games; resting applies to this game only.
        </p>
        {mode === 'stats' && <Legend keys={['ERA', 'WHIP', 'K', 'IP']} />}
      </section>
    </div>
  );
}
