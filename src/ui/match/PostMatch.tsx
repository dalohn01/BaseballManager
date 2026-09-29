import { useEffect, useRef } from 'react';
import type { EventInstance } from '../../domain/state';
import { clubName, shortName } from '../../domain/state';
import type { MatchResult } from '../../domain/types';
import { presentedBox, standouts } from '../../presentation/boxscore';
import type { CommentaryStep } from '../../presentation/commentary';
import { Crest } from '../components/art';
import { EffectList } from '../components/common';
import { Icon } from '../components/icons';
import { PlayerAvatar } from '../components/PlayerAvatar';
import { useGame } from '../hooks';
import { ContinueButton, Reactions } from '../screens/EventCard';
import { LineScore } from '../screens/MatchView';

/**
 * The post-match screen the match view transitions into: the final score up
 * front, the match story and standouts, then what changed for the club and
 * the Continue button. Everything here was already decided and saved when the
 * lineup was confirmed; this only presents it.
 */
export function PostMatch({ ev, match, steps, reduced, onBack }: { ev: EventInstance; match: MatchResult; steps: CommentaryStep[]; reduced: boolean; onBack: () => void }) {
  const s = useGame();
  const r = ev.resolution!;
  const topRef = useRef<HTMLElement>(null);
  useEffect(() => {
    // The screen replaces the match view, so start from the top of the page.
    window.scrollTo({ top: 0, behavior: reduced ? 'auto' : 'smooth' });
    topRef.current?.focus({ preventScroll: true });
  }, [reduced]);

  const home = s.clubs[match.homeId];
  const away = s.clubs[match.awayId];
  const userSide = match.homeId === s.userClubId ? 'home' : 'away';
  const won = match.runs[userSide] > match.runs[userSide === 'home' ? 'away' : 'home'];
  const tail = match.walkOff ? 'Walk-off' : match.decidedBy === 'suddenDeath' ? 'Prototype sudden-death' : match.innings > 9 ? `${match.innings} innings` : null;
  const last = steps.length - 1;
  const picks = last >= 0 ? standouts(match, steps, last) : [];
  const box = last >= 0 ? presentedBox(match, steps, last) : null;
  const ourBat = box ? box.batting[s.userClubId].filter((l) => l.h > 0 || l.rbi > 0 || l.bb > 0) : [];
  const ourPitch = box ? box.pitching[s.userClubId] : [];
  const main = r.effects.filter((e) => e.stat !== 'satisfaction');
  const moods = r.effects.filter((e) => e.stat === 'satisfaction');

  return (
    <div className={`post-match ${reduced ? 'reduced' : ''}`}>
      <section ref={topRef} tabIndex={-1} className={`post-hero ${won ? 'won' : 'lost'}`} aria-label="Final score">
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
        <LineScore m={match} />
      </section>

      <div className="post-columns">
        <section className="panel post-story" aria-label="Match story">
          <header className="panel-head">
            <h2>Match story</h2>
          </header>
          <div className="panel-body">
            {r.narrative.length > 0 && (
              <ul className="post-narrative">
                {r.narrative.map((n, i) => (
                  <li key={i}>{n}</li>
                ))}
              </ul>
            )}
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
            <div className="box-grid">
              <div>
                <h3 className="subhead">Your hitters</h3>
                {ourBat.length === 0 ? (
                  <p className="muted small">A quiet day at the plate.</p>
                ) : (
                  <ul className="box-list">
                    {ourBat.map((l) => (
                      <li key={l.id}>
                        <strong>{shortName(s.players[l.id])}</strong> {l.h}–{l.ab}
                        {l.hr ? ` · ${l.hr} HR` : ''}
                        {l.rbi ? ` · ${l.rbi} RBI` : ''}
                        {l.bb ? ` · ${l.bb} BB` : ''}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <div>
                <h3 className="subhead">Your pitchers</h3>
                <ul className="box-list">
                  {ourPitch.map((l) => (
                    <li key={l.id}>
                      <strong>{shortName(s.players[l.id])}</strong> {Math.floor(l.outs / 3)}.{l.outs % 3} IP · {l.r} R · {l.k} K
                    </li>
                  ))}
                </ul>
              </div>
            </div>
            {r.reactions.length > 0 && <Reactions reactions={r.reactions} />}
          </div>
        </section>

        <section className="panel post-changes" aria-label="What changed">
          <header className="panel-head">
            <h2>What changed</h2>
          </header>
          <div className="panel-body">
            <EffectList effects={main} />
            {moods.length > 0 && (
              <details className="more">
                <summary>Player satisfaction changes ({moods.length})</summary>
                <EffectList effects={moods} />
              </details>
            )}
            <ContinueButton ev={ev} />
            <button className="link post-back" onClick={onBack}>
              <Icon name="back" size={16} /> Back to the match view
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}
