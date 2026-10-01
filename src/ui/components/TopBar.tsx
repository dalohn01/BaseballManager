import { userClub } from '../../domain/state';
import { BALANCE } from '../../balance/config';
import { viewTime } from '../../domain/time';
import { duration } from '../format';
import { CashPill } from './CashPill';
import { href, useGame, useNow, type Route } from '../hooks';
import { Crest } from './art';
import { Icon } from './icons';

const NAV: { key: Route['name']; label: string; path: string }[] = [
  { key: 'home', label: 'Home', path: 'home' },
  { key: 'team', label: 'Team', path: 'team' },
  { key: 'club', label: 'Club', path: 'club' },
  { key: 'league', label: 'League', path: 'league' },
  { key: 'history', label: 'History', path: 'history' },
];

export function TopBar({ route }: { route: Route }) {
  const s = useGame();
  const now = useNow();
  const club = userClub(s);
  const t = viewTime(s.time, now);
  const active = route.name === 'player' ? 'team' : route.name;
  return (
    <>
      <header className="topbar">
        <a className="brand" href={href('home')}>
          <Crest club={club} size={44} />
          <span className="brand-name">
            <span className="brand-slash" style={{ color: club.colors.secondary }}>/</span>
            {club.city} {club.name}
          </span>
        </a>
        <nav className="mainnav" aria-label="Main">
          {NAV.map((n) => (
            <a key={n.key} href={href(n.path)} aria-current={active === n.key ? 'page' : undefined}>
              {n.label}
            </a>
          ))}
        </nav>
        <div className="resources">
          <CashPill state={s} />
          <span className="pill" title="Time">
            <Icon name="time" />
            <span className="sr-only">Time</span>
            {t.unlimited ? (
              <span>∞ <small className="test-tag">TEST</small></span>
            ) : (
              <span>
                {t.current}/{t.cap}
                {t.msToNext !== null && <small className="pill-sub">+1 in {duration(t.msToNext)}</small>}
              </span>
            )}
          </span>
          <span className="pill" title={`Influence ${Math.floor(s.influence)} / ${BALANCE.influence.cap}`}>
            <Icon name="influence" className="ico-influence" />
            <span className="sr-only">Influence</span>
            {Math.floor(s.influence)}
          </span>
          <a className="icon-btn" href={href('settings')} aria-label="Settings" aria-current={active === 'settings' ? 'page' : undefined}>
            <Icon name="gear" size={24} />
          </a>
        </div>
      </header>
      <nav className="bottomnav" aria-label="Main (mobile)">
        {NAV.map((n) => (
          <a key={n.key} href={href(n.path)} aria-current={active === n.key ? 'page' : undefined}>
            {n.label}
          </a>
        ))}
      </nav>
    </>
  );
}
