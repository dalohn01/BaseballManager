import { pitcherPosition } from '../../domain/pitching';
import { effectiveValue, restText } from '../../domain/effective';
import { draftFromClub } from '../../domain/lineupDraft';
import { useSyncExternalStore } from 'react';
import { ballparkName } from '../../content/ballparks';
import type { EventInstance } from '../../domain/state';
import { clubName, playerName, userClub } from '../../domain/state';
import { forecastForLineup } from '../../events/templates/leagueGame';
import { opponentReport } from '../../simulation/opponentReport';
import { Crest } from '../components/art';
import { Icon } from '../components/icons';
import { PlayerAvatar } from '../components/PlayerAvatar';
import { TeamOvrBadge } from '../components/TeamOvr';
import { useGame } from '../hooks';

/*
 * Match day is an event of its own: its card in today's stack shows the
 * fixture, and "Set lineup" opens the pre-match screen. Whether the lineup
 * screen is open is a UI state (kept per event for this browser session),
 * never game data.
 */

const KEY = 'bm.lineupOpen';
const listeners = new Set<() => void>();
const read = (): string | null => {
  try {
    return sessionStorage.getItem(KEY);
  } catch {
    return null;
  }
};
const write = (id: string | null) => {
  try {
    if (id) sessionStorage.setItem(KEY, id);
    else sessionStorage.removeItem(KEY);
  } catch {
    /* storage unavailable: the state simply is not kept */
  }
  memory = id;
  listeners.forEach((l) => l());
};
let memory: string | null = read();

export const openLineup = (eventId: string) => write(eventId);
export const closeLineup = () => write(null);
export function useLineupOpen(eventId: string | undefined): boolean {
  const open = useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => memory,
  );
  return !!eventId && open === eventId;
}

/** The match day card: who, where, how it looks, and the way into the lineup. */
export function MatchDayCard({ ev }: { ev: EventInstance }) {
  const s = useGame();
  const club = userClub(s);
  const gameId = String(ev.data.gameId);
  const g = s.schedule.find((x) => x.id === gameId);
  if (!g) return null;
  const home = s.clubs[g.homeId];
  const away = s.clubs[g.awayId];
  const isHome = g.homeId === club.id;
  const opp = isHome ? away : home;
  // The lineup screen opens on the strongest setup by effective value; the card previews it.
  const preset = draftFromClub(s).lineup;
  const win = forecastForLineup(s, gameId, preset);
  const starter = s.players[preset.pitcherId];
  const sv = starter ? effectiveValue(s, starter, 'SP') : null;
  const report = opponentReport(s, gameId).observations[0];
  return (
    <section className="event-card match-day" aria-labelledby="matchday-title">
      <h1 id="matchday-title" className="sr-only">
        Match day: {clubName(home)} vs {clubName(away)}
      </h1>
      <div className="md-matchup">
        <div className="md-side">
          <Crest club={home} size={72} />
          <strong>{clubName(home)}</strong>
          <TeamOvrBadge state={s} clubId={home.id} size="xs" />
        </div>
        <span className="md-vs">VS</span>
        <div className="md-side">
          <Crest club={away} size={72} />
          <strong>{clubName(away)}</strong>
          <TeamOvrBadge state={s} clubId={away.id} size="xs" />
        </div>
      </div>
      <p className="md-where">
        {isHome ? 'Home' : 'Away'} · {ballparkName(home)} · Round {ev.round}
      </p>
      <div className="md-facts">
        {starter && (
          <div className="md-fact">
            <PlayerAvatar player={starter} club={club} size={44} />
            <span>
              <small>Probable starter</small>
              <strong>{playerName(starter)}</strong>
              <small className="muted">
                {pitcherPosition(starter)} · OVR {sv!.ovr} · EFF {sv!.effective} · {restText(starter)}
              </small>
            </span>
          </div>
        )}
        <div className="md-fact">
          <Icon name="chart" size={28} />
          <span>
            <small>Forecast</small>
            <strong>{Math.round(win * 100)}% win chance</strong>
            <small className="muted">With the strongest lineup</small>
          </span>
        </div>
      </div>
      {report && (
        <p className="md-report small">
          <strong>Scouting {opp.name}:</strong> {report.text}
        </p>
      )}
      <button className="btn btn-primary btn-confirm" onClick={() => openLineup(ev.id)}>
        <span>Set lineup</span>
        <span className="btn-cost">
          <small>Then play the game</small>
          <Icon name="chevron" />
        </span>
      </button>
    </section>
  );
}
