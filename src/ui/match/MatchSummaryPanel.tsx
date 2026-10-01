import { useEffect, useRef, useState } from 'react';
import { playerName, shortName } from '../../domain/state';
import type { MatchResult } from '../../domain/types';
import { inningsPitched, presentedBox, standouts } from '../../presentation/boxscore';
import type { CommentaryStep } from '../../presentation/commentary';
import { PlayerAvatar } from '../components/PlayerAvatar';
import { useGame } from '../hooks';

/**
 * Match summary under the field: team totals, up to two standouts and a link
 * to the full box score — all read from the presented state, never from the
 * pre-computed result.
 */
export function MatchSummaryPanel({ match, steps, index }: { match: MatchResult; steps: CommentaryStep[]; index: number }) {
  const s = useGame();
  const [open, setOpen] = useState(false);
  const box = presentedBox(match, steps, index);
  const picks = standouts(match, steps, index);
  const clubs = [match.awayId, match.homeId];
  return (
    <section className="panel cm-summary-panel" aria-label="Match summary">
      <header className="cm-head">
        <h2>Match summary</h2>
      </header>
      <table className="mini-table ms-table">
        <thead>
          <tr>
            <th scope="col">Team</th>
            <th scope="col" title="Runs">R</th>
            <th scope="col" title="Hits by the team's batters">H</th>
            <th scope="col" title="Home runs by the team's batters">HR</th>
            <th scope="col" title="Walks drawn by the team's batters">BB</th>
            <th scope="col" title="Strikeouts by the team's batters (not by its pitchers)">K</th>
          </tr>
        </thead>
        <tbody>
          {clubs.map((id) => {
            const t = box.teams[id];
            return (
              <tr key={id} className={id === s.userClubId ? 'me' : ''}>
                <td>{s.clubs[id]?.name ?? '—'}</td>
                <td>{t?.r ?? '—'}</td>
                <td>{t?.h ?? '—'}</td>
                <td>{t?.hr ?? '—'}</td>
                <td>{t?.bb ?? '—'}</td>
                <td>{t?.k ?? '—'}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <h3 className="ms-sub">Standouts</h3>
      {picks.length === 0 ? (
        <p className="muted small ms-none">Nobody has stood out yet.</p>
      ) : (
        <ul className="ms-standouts">
          {picks.map((p) => {
            const pl = s.players[p.id];
            if (!pl) return null;
            return (
              <li key={p.id}>
                <PlayerAvatar player={pl} club={s.clubs[pl.clubId] ?? s.clubs[p.clubId]} size={40} />
                <span>
                  <strong>{playerName(pl)}</strong> <small className="muted">{s.clubs[p.clubId]?.name}</small>
                  <span className="ms-line">{p.line}</span>
                </span>
              </li>
            );
          })}
        </ul>
      )}
      <button className="link ms-boxlink" onClick={() => setOpen(true)}>
        Full box score →
      </button>
      {open && <BoxScoreDialog match={match} steps={steps} index={index} onClose={() => setOpen(false)} />}
    </section>
  );
}

/**
 * Batting and pitching for both teams, as far as the commentary has come
 * (final values after the last step). Opening or closing it never touches the
 * playback: autoplay and tempo keep running, as with the match log.
 */
export function BoxScoreDialog({ match, steps, index, onClose }: { match: MatchResult; steps: CommentaryStep[]; index: number; onClose: () => void }) {
  const s = useGame();
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  const box = presentedBox(match, steps, index);
  const finished = index >= steps.length - 1;
  const name = (id: string) => (s.players[id] ? shortName(s.players[id]) : '—');
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal box-modal" role="dialog" aria-modal="true" aria-label="Full box score" onClick={(e) => e.stopPropagation()}>
        <header className="cm-head">
          <h2>Box score {finished ? '· Final' : '· so far'}</h2>
          <button ref={closeRef} className="icon-btn" aria-label="Close" onClick={onClose}>
            ✕
          </button>
        </header>
        <div className="box-body">
          {[match.awayId, match.homeId].map((clubId) => {
            const bat = box.batting[clubId];
            const pit = box.pitching[clubId];
            const t = box.teams[clubId];
            const sum = (k: 'ab' | 'h' | 'r' | 'rbi' | 'hr' | 'bb' | 'k') => bat.reduce((a, l) => a + l[k], 0);
            return (
              <section key={clubId} className="box-team">
                <h3 className="subhead">{s.clubs[clubId]?.name}</h3>
                <div className="table-wrap">
                  <table className="mini-table box-table">
                    <caption className="sr-only">{s.clubs[clubId]?.name} batting</caption>
                    <thead>
                      <tr>
                        <th scope="col">Batting</th>
                        <th scope="col" title="At-bats">AB</th>
                        <th scope="col" title="Hits">H</th>
                        <th scope="col" title="Runs">R</th>
                        <th scope="col" title="Runs batted in">RBI</th>
                        <th scope="col" title="Home runs">HR</th>
                        <th scope="col" title="Walks">BB</th>
                        <th scope="col" title="Strikeouts">K</th>
                      </tr>
                    </thead>
                    <tbody>
                      {bat.map((l) => (
                        <tr key={l.id}>
                          <th scope="row">{name(l.id)}</th>
                          <td>{l.ab}</td>
                          <td>{l.h}</td>
                          <td>{l.r}</td>
                          <td>{l.rbi}</td>
                          <td>{l.hr}</td>
                          <td>{l.bb}</td>
                          <td>{l.k}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr>
                        <th scope="row">Team</th>
                        <td>{sum('ab')}</td>
                        <td>{sum('h')}</td>
                        <td>{t.r}</td>
                        <td>{sum('rbi')}</td>
                        <td>{sum('hr')}</td>
                        <td>{sum('bb')}</td>
                        <td>{sum('k')}</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
                <div className="table-wrap">
                  <table className="mini-table box-table">
                    <caption className="sr-only">{s.clubs[clubId]?.name} pitching</caption>
                    <thead>
                      <tr>
                        <th scope="col">Pitching</th>
                        <th scope="col" title="Innings pitched (3.2 = three innings and two outs)">IP</th>
                        <th scope="col" title="Hits allowed">H</th>
                        <th scope="col" title="Runs allowed">R</th>
                        <th scope="col" title="Walks allowed">BB</th>
                        <th scope="col" title="Strikeouts">K</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pit.map((l) => (
                        <tr key={l.id}>
                          <th scope="row">{name(l.id)}</th>
                          <td>{inningsPitched(l.outs)}</td>
                          <td>{l.h}</td>
                          <td>{l.r}</td>
                          <td>{l.bb}</td>
                          <td>{l.k}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            );
          })}
        </div>
      </div>
    </div>
  );
}
