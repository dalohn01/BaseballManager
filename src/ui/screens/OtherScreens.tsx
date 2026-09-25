import { useRef, useState } from 'react';
import { BALANCE } from '../../balance/config';
import { moodLabel } from '../../domain/mood';
import { clubName, userClub } from '../../domain/state';
import { FACILITY_LABELS, payrollPerSeason, projectedAttendance, projectedTicketRevenue, seasonForecast, ticketPrice, upkeepPerRound } from '../../simulation/economy';
import { computeStandings } from '../../simulation/standings';
import { Crest } from '../components/art';
import { EffectList, Meter, Panel } from '../components/common';
import { money, moneyExact } from '../format';
import { readPref, useController, useGame, useSnapshot, writePref } from '../hooks';

export function ClubScreen() {
  const s = useGame();
  const club = userClub(s);
  const f = seasonForecast(s, club.id);
  const ledger = [...s.ledger].reverse().slice(0, 40);
  return (
    <div className="page">
      <h1 className="page-title">Club</h1>
      <div className="cols-3">
        <Panel title="Finances">
          <dl className="facts">
            <div>
              <dt>Club Cash</dt>
              <dd className={club.cash < 0 ? 'bad' : ''}>{moneyExact(club.cash)}</dd>
            </div>
            <div>
              <dt>Payroll</dt>
              <dd>{moneyExact(payrollPerSeason(s, club.id))} / season</dd>
            </div>
            <div>
              <dt>Facility running costs</dt>
              <dd>{moneyExact(upkeepPerRound(club))} / round</dd>
            </div>
            <div>
              <dt>Tickets</dt>
              <dd>
                ${ticketPrice(club)} · ≈{projectedAttendance(club).toLocaleString('en-US')} fans · ≈{money(projectedTicketRevenue(club))} per home game
              </dd>
            </div>
            <div>
              <dt>Sponsor</dt>
              <dd>
                {club.sponsor ? `${club.sponsor.name}, ${money(club.sponsor.perSeason)}/season, ${club.sponsor.seasonsLeft} season(s) left` : 'None'}
                {club.sponsor?.bonus && (
                  <small className="block muted">
                    Bonus {money(club.sponsor.bonus.amount)} for a top-3 finish · {club.sponsor.bonus.paid ? 'paid' : 'not yet earned'}
                  </small>
                )}
              </dd>
            </div>
          </dl>
          <h3 className="subhead">Rest of season forecast</h3>
          <dl className="facts">
            <div>
              <dt>Ticket income ({f.homeGamesLeft} home games)</dt>
              <dd>+{money(f.ticketIncome)}</dd>
            </div>
            <div>
              <dt>Sponsor income</dt>
              <dd>+{money(f.sponsorIncome)}</dd>
            </div>
            <div>
              <dt>Salaries ({f.roundsLeft} rounds)</dt>
              <dd>−{money(f.salaries)}</dd>
            </div>
            <div>
              <dt>Running costs</dt>
              <dd>−{money(f.upkeep)}</dd>
            </div>
            <div>
              <dt>Projected cash at season end</dt>
              <dd className={f.projectedCash < 0 ? 'bad' : 'strong'}>{money(f.projectedCash)}</dd>
            </div>
          </dl>
        </Panel>
        <Panel title="Stakeholders">
          <Meter label="Owner confidence" value={club.ownerConfidence} caption={moodLabel('owners', club.ownerConfidence)} reasons={club.reasons.ownerConfidence} />
          <Meter label="Fan support" value={club.fanSupport} caption={`${moodLabel('fans', club.fanSupport)} · fan base ${club.fanBase.toLocaleString('en-US')} (size ≠ happiness)`} reasons={club.reasons.fanSupport} />
          <h3 className="subhead">Brand</h3>
          <Meter label="Local roots" value={club.brand.local} caption="Patience from the community, gate demand" tone="blue" />
          <Meter label="Commercial reach" value={club.brand.commercial} caption="Size of sponsor offers" tone="blue" />
          {club.publicStance && (
            <p className="small">
              <strong>Public stance:</strong> {club.publicStance.stance === 'contend' ? '“Going for the title”' : '“Building something”'} (said in round {club.publicStance.round})
            </p>
          )}
          <h3 className="subhead">Facilities</h3>
          <ul className="plain">
            <li>Training Center — level {club.facilities.training} (training progress ×{(1 + (club.facilities.training - 1) * 0.2).toFixed(1)})</li>
            <li>Scouting Department — level {club.facilities.scouting} (potential estimates ±{BALANCE.recruitment.scoutRangeHalfWidth[club.facilities.scouting - 1]})</li>
            <li>Stadium &amp; Fan Facilities — level {club.facilities.stadium} (capacity {BALANCE.economy.stadiumCapacity[club.facilities.stadium - 1].toLocaleString('en-US')})</li>
          </ul>
          {club.project && (
            <p className="small">
              <strong>Under construction:</strong> {FACILITY_LABELS[club.project.facility]} → level {club.project.toLevel}, ready after round{' '}
              {club.project.completesRound - (s.calendar.season - 1) * BALANCE.season.rounds}.
            </p>
          )}
        </Panel>
        <Panel title="Economy log">
          {ledger.length === 0 ? (
            <p className="muted">No transactions yet.</p>
          ) : (
            <div className="table-wrap">
              <table className="ledger">
                <thead>
                  <tr>
                    <th scope="col">Rd</th>
                    <th scope="col">Item</th>
                    <th scope="col" className="num">
                      Amount
                    </th>
                    <th scope="col" className="num">
                      Balance
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {ledger.map((e) => (
                    <tr key={e.id}>
                      <td>{e.round}</td>
                      <td>{e.note}</td>
                      <td className={`num ${e.amount < 0 ? 'bad' : 'good'}`}>{moneyExact(e.amount)}</td>
                      <td className="num">{moneyExact(e.balanceAfter)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      </div>
    </div>
  );
}

export function LeagueScreen() {
  const s = useGame();
  const table = computeStandings(s);
  const rounds = Array.from({ length: BALANCE.season.rounds }, (_, i) => i + 1);
  return (
    <div className="page">
      <h1 className="page-title">League · Season {s.calendar.season}</h1>
      <div className="cols-2">
        <Panel title="Standings">
          <div className="table-wrap">
            <table className="standings">
              <thead>
                <tr>
                  <th scope="col">#</th>
                  <th scope="col">Team</th>
                  <th scope="col">W</th>
                  <th scope="col">L</th>
                  <th scope="col">RS</th>
                  <th scope="col">RA</th>
                  <th scope="col">Diff</th>
                  <th scope="col">Strk</th>
                </tr>
              </thead>
              <tbody>
                {table.map((r, i) => (
                  <tr key={r.clubId} className={r.clubId === s.userClubId ? 'me' : ''}>
                    <td>{i + 1}</td>
                    <th scope="row" className="team-cell">
                      <Crest club={s.clubs[r.clubId]} size={26} /> {clubName(s.clubs[r.clubId])}
                    </th>
                    <td>{r.wins}</td>
                    <td>{r.losses}</td>
                    <td>{r.runsFor}</td>
                    <td>{r.runsAgainst}</td>
                    <td>{r.diff > 0 ? `+${r.diff}` : r.diff}</td>
                    <td>{r.streak}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="small muted">Ties: wins → run differential → head-to-head → club id. Leader after 20 rounds is champion.</p>
        </Panel>
        <Panel title="Schedule & results">
          <div className="schedule">
            {rounds.map((r) => {
              const games = s.schedule.filter((g) => g.season === s.calendar.season && g.round === r);
              return (
                <div key={r} className={`sched-round ${r === (s.currentEvent?.round ?? 0) ? 'current' : ''}`}>
                  <h3>Round {r}</h3>
                  <ul>
                    {games.map((g) => {
                      const mine = g.homeId === s.userClubId || g.awayId === s.userClubId;
                      return (
                        <li key={g.id} className={mine ? 'me' : ''}>
                          <span>{s.clubs[g.awayId].abbreviation}</span>
                          <span className="res">{g.result ? `${g.result.awayRuns}–${g.result.homeRuns}` : '@'}</span>
                          <span>{s.clubs[g.homeId].abbreviation}</span>
                          {g.result && g.result.decidedBy !== 'regulation' && <small>{g.result.decidedBy === 'suddenDeath' ? 'SD' : `${g.result.innings} inn`}</small>}
                        </li>
                      );
                    })}
                  </ul>
                </div>
              );
            })}
          </div>
        </Panel>
      </div>
    </div>
  );
}

export function HistoryScreen() {
  const s = useGame();
  const items = [...s.history].reverse();
  return (
    <div className="page">
      <h1 className="page-title">History</h1>
      <p className="muted">Every decision you made, what it cost and what actually changed.</p>
      {items.length === 0 && <p className="muted">No decisions yet.</p>}
      <ol className="history">
        {items.map((h) => (
          <li key={h.eventId}>
            <details>
              <summary>
                <span className="h-when">
                  S{h.season} R{h.round}
                </span>
                <span className="h-title">
                  <strong>{h.title}</strong> — {h.choice}
                </span>
                <span className="h-head">{h.headline}</span>
              </summary>
              <p className="small muted">
                Cost: {h.costPaid.time} Time
                {h.costPaid.cash ? `, ${moneyExact(h.costPaid.cash)}` : ''}
                {h.costPaid.influence ? `, ${h.costPaid.influence} Influence` : ''}
              </p>
              <EffectList effects={h.effects} />
            </details>
          </li>
        ))}
      </ol>
    </div>
  );
}

export function SettingsScreen() {
  const s = useGame();
  const c = useController();
  const snap = useSnapshot();
  const fileRef = useRef<HTMLInputElement>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [confirmNew, setConfirmNew] = useState(false);
  const [reduced, setReduced] = useState(readPref('reducedMotion') ?? false);
  const unlimited = s.time.mode === 'unlimited';

  const doExport = () => {
    const text = c.exportCurrent();
    if (!text) return;
    const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `baseball-manager-s${s.calendar.season}-r${s.calendar.round}.json`;
    a.click();
    URL.revokeObjectURL(url);
    setMessage('Save exported.');
  };
  const doImport = async (file: File) => {
    const err = await c.importSave(await file.text());
    setMessage(err ? `Import failed: ${err} Your current game is unchanged.` : 'Save imported.');
  };

  return (
    <div className="page narrow">
      <h1 className="page-title">Settings</h1>
      <Panel title="Test mode">
        <label className="setting">
          <input type="checkbox" className="switch" checked={unlimited} disabled={snap.busy} onChange={(e) => void c.dispatch({ type: 'setTimeMode', mode: e.target.checked ? 'unlimited' : 'economy' })} />
          <span>
            <strong>Unlimited Time (test mode)</strong>
            <small className="muted">
              For playtesting whole seasons. Shown as “∞ TEST” in the top bar. Economy mode: cap {BALANCE.time.cap}, +1 every {BALANCE.time.regenIntervalMs / 60000} minutes.
            </small>
          </span>
        </label>
      </Panel>
      <Panel title="Display">
        <label className="setting">
          <input
            type="checkbox"
            className="switch"
            checked={reduced}
            onChange={(e) => {
              setReduced(e.target.checked);
              writePref('reducedMotion', e.target.checked);
            }}
          />
          <span>
            <strong>Reduced motion</strong>
            <small className="muted">Shorter animations and faster auto-play.</small>
          </span>
        </label>
      </Panel>
      <Panel title="Save file">
        <p className="muted small">The game saves automatically in this browser after every action. A previous working save is kept as backup.</p>
        <div className="lineup-actions">
          <button className="btn btn-secondary btn-small" onClick={doExport}>
            Export save
          </button>
          <button className="btn btn-secondary btn-small" onClick={() => fileRef.current?.click()} disabled={snap.busy}>
            Import save…
          </button>
          <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={(e) => e.target.files?.[0] && doImport(e.target.files[0])} />
        </div>
        {message && (
          <p role="status" className="small">
            {message}
          </p>
        )}
      </Panel>
      <Panel title="New game">
        {!confirmNew ? (
          <button className="btn btn-secondary btn-small" onClick={() => setConfirmNew(true)}>
            Start a new game…
          </button>
        ) : (
          <NewGameForm onCancel={() => setConfirmNew(false)} warning="This replaces your current game. Export it first if you want to keep it." />
        )}
      </Panel>
    </div>
  );
}

const COLOR_PRESETS = [
  { primary: '#0f2a5c', secondary: '#f26b1d', name: 'Navy & orange' },
  { primary: '#7a1f2b', secondary: '#e8c547', name: 'Maroon & gold' },
  { primary: '#1d5c3a', secondary: '#f2f2f2', name: 'Forest & white' },
  { primary: '#1b1b1b', secondary: '#e0262c', name: 'Black & red' },
  { primary: '#2f6fe4', secondary: '#ffd23f', name: 'Royal & yellow' },
];

export function NewGameForm({ onCancel, warning }: { onCancel?: () => void; warning?: string }) {
  const c = useController();
  const snap = useSnapshot();
  const [city, setCity] = useState('Harbor');
  const [name, setName] = useState('Foxes');
  const [colors, setColors] = useState(COLOR_PRESETS[0]);
  const [seed, setSeed] = useState(() => String(Math.floor(Math.random() * 1e6)));
  const [testMode, setTestMode] = useState(false);
  const start = async () => {
    await c.newGame({ seed: Number(seed) >>> 0, clubCity: city, clubName: name, primaryColor: colors.primary, secondaryColor: colors.secondary, timeMode: testMode ? 'unlimited' : 'economy' });
    location.hash = '#/home';
  };
  return (
    <form
      className="newgame"
      onSubmit={(e) => {
        e.preventDefault();
        void start();
      }}
    >
      {warning && <p className="blocker">{warning}</p>}
      <div className="field-row">
        <label>
          City
          <input value={city} onChange={(e) => setCity(e.target.value)} maxLength={20} required />
        </label>
        <label>
          Club name
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={20} required />
        </label>
      </div>
      <fieldset className="colors">
        <legend>Club colours</legend>
        {COLOR_PRESETS.map((p) => (
          <label key={p.name} className={`swatch ${colors.name === p.name ? 'on' : ''}`}>
            <input type="radio" name="colors" className="sr-only" checked={colors.name === p.name} onChange={() => setColors(p)} />
            <span className="sw" style={{ background: `linear-gradient(135deg, ${p.primary} 60%, ${p.secondary} 60%)` }} />
            {p.name}
          </label>
        ))}
      </fieldset>
      <div className="field-row">
        <label>
          Seed
          <input value={seed} onChange={(e) => setSeed(e.target.value.replace(/\D/g, ''))} inputMode="numeric" maxLength={9} />
        </label>
        <label className="setting inline">
          <input type="checkbox" className="switch" checked={testMode} onChange={(e) => setTestMode(e.target.checked)} />
          <span>Unlimited Time (test mode)</span>
        </label>
      </div>
      <div className="lineup-actions">
        <button className="btn btn-primary" type="submit" disabled={snap.busy}>
          Start career
        </button>
        {onCancel && (
          <button className="btn btn-secondary" type="button" onClick={onCancel}>
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}
