import { BALANCE } from '../../balance/config';
import { pitcherRole, setHook, setPitcherRole, type PitcherRole } from '../../domain/lineupDraft';
import { fmtIp, pitcherWorkload, playerNotes } from '../../domain/playerStats';
import { overall } from '../../domain/ratings';
import { playerName, userClub } from '../../domain/state';
import type { Player, PitchingHook } from '../../domain/types';
import { forecastForLineup } from '../../events/templates/leagueGame';
import { Icon } from '../components/icons';
import type { DraftApi } from './PreMatchScreen';
import { FitnessMeter, HappinessMeter, Legend, Notes, pitcherValues, Portrait, Values } from './shared';

const ROLE_LABEL: Record<PitcherRole, string> = {
  starter: 'Starting today',
  reliever: 'First reliever',
  available: 'Available',
  rest: 'Rest today',
};
const ROLE_HELP: Record<PitcherRole, string> = {
  starter: '',
  reliever: 'Comes in when the starter is replaced.',
  available: 'Used only if no reliever is planned (best rested is picked).',
  rest: 'Will not be used in this game.',
};
const NEXT_ROLE: Record<Exclude<PitcherRole, 'starter'>, Exclude<PitcherRole, 'starter'>> = { available: 'reliever', reliever: 'rest', rest: 'available' };

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

import { instructionSummary } from '../tactics/TacticsControls';

export function PitchersTab({ api, gameId }: { api: DraftApi; gameId: string }) {
  const { state: s, draft, update, mode, period } = api;
  const pitchers = userClub(s)
    .roster.map((id) => s.players[id])
    .filter((p) => p.isPitcher)
    .sort((a, b) => overall(b) - overall(a) || a.id.localeCompare(b.id));
  const starter = s.players[draft.lineup.pitcherId];
  const bullpen = pitchers.filter((p) => p.id !== starter.id);
  // Trade-off against the strongest alternative starter, using the same forecast as the match.
  const alt = bullpen.slice().sort((a, b) => b.ratings.pitching - a.ratings.pitching)[0];
  const winNow = forecastForLineup(s, gameId, draft.lineup);
  const winAlt = alt ? forecastForLineup(s, gameId, { ...draft.lineup, pitcherId: alt.id }) : null;
  const hook = BALANCE.match.hooks[draft.plan.hook];

  return (
    <div className="pm-pitch-layout">
      <section className="panel pm-starters">
        <header className="panel-head">
          <h2>Choose your starter</h2>
          <small className="muted">Compare quality, fitness and recent workload.</small>
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
                    Throws {p.throws} · {p.role === 'prospect' ? 'Prospect' : p.role === 'starter' ? 'Rotation' : 'Reserve'}
                  </small>
                  <Values vals={pitcherValues(s, p, mode, period)} />
                  <span className="pc-status">
                    <FitnessMeter value={p.fitness} showLabel />
                    <HappinessMeter value={p.satisfaction} />
                  </span>
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
                    Select starter
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
          <h2>Bullpen plan</h2>
          <small className="muted">One pitching change per game in this model. Tap Change to switch role.</small>
        </header>
        <ul className="bullpen-list">
          {bullpen.map((p) => {
            const role = pitcherRole(draft, p.id) as Exclude<PitcherRole, 'starter'>;
            return (
              <li key={p.id} className={`bullpen-row role-${role}`}>
                <Portrait state={s} player={p} size={48} />
                <div className="br-main">
                  <span className={`role-chip role-${role}`}>{ROLE_LABEL[role]}</span>
                  <strong>{playerName(p)}</strong>
                  <Values vals={pitcherValues(s, p, mode, period)} />
                  <span className="pc-status">
                    <FitnessMeter value={p.fitness} />
                    <HappinessMeter value={p.satisfaction} />
                  </span>
                  <small className="muted">{ROLE_HELP[role]} {workloadText(s, p)}</small>
                </div>
                <button className="btn btn-small btn-secondary" onClick={() => update(setPitcherRole(draft, p.id, NEXT_ROLE[role]))} aria-label={`Change role for ${p.lastName} (now ${ROLE_LABEL[role]})`}>
                  Change
                </button>
              </li>
            );
          })}
        </ul>

        <h3 className="subhead">When to change pitchers</h3>
        <div className="segmented" role="group" aria-label="When to replace the starter">
          {(Object.keys(HOOK_TEXT) as PitchingHook[]).map((h) => (
            <button key={h} className={draft.plan.hook === h ? 'on' : ''} aria-pressed={draft.plan.hook === h} onClick={() => update(setHook(draft, h))}>
              {HOOK_TEXT[h]}
            </button>
          ))}
        </div>
        <p className="small">
          The starter is replaced after facing {hook.maxBatters} batters, or earlier once he has allowed {hook.pullRuns} runs after at least {hook.minBatters} batters — if a reliever is available.
          This setting stays for future games; reliever and rest apply to this game only.
        </p>
        {mode === 'stats' && <Legend keys={['ERA', 'WHIP', 'K', 'IP']} />}
      </section>
    </div>
  );
}
