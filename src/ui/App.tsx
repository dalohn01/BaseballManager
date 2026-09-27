import { TopBar } from './components/TopBar';
import { useController, useRoute, useSnapshot } from './hooks';
import { HomeScreen } from './screens/HomeScreen';
import { ClubScreen, HistoryScreen, LeagueScreen, NewGameForm, SettingsScreen } from './screens/OtherScreens';
import { PlayerScreen } from './screens/PlayerScreen';
import { TeamScreen } from './screens/TeamScreen';

export function App() {
  const snap = useSnapshot();
  const route = useRoute();
  const c = useController();

  if (snap.status === 'loading') return <div className="splash">Loading…</div>;
  if (snap.status === 'loadError') {
    return (
      <div className="splash">
        <div className="panel splash-card">
          <h1 className="page-title">Could not load your game</h1>
          <p>{snap.loadError}</p>
          <p className="muted small">Starting a new game keeps the old save as a backup copy.</p>
          <NewGameForm />
        </div>
      </div>
    );
  }
  if (snap.status === 'noGame' || !snap.state) {
    return (
      <div className="splash">
        <div className="panel splash-card">
          <p className="kicker">Baseball Manager · prototype</p>
          <h1 className="page-title">Take over the club</h1>
          <p className="muted">You inherit an established club with a couple of prospects, a popular veteran and a budget with room for choices. Name it and pick its colours.</p>
          <NewGameForm />
        </div>
      </div>
    );
  }

  return (
    <div className="app">
      <a className="skip" href="#main">
        Skip to content
      </a>
      <TopBar route={route} />
      {snap.status === 'conflict' && (
        <div className="banner banner-bad" role="alert">
          This game was changed in another tab. <button className="btn btn-small btn-secondary" onClick={() => void c.reloadFromStorage()}>Load latest</button>
        </div>
      )}
      {snap.saveError && (
        <div className="banner banner-bad" role="alert">
          {snap.saveError} Nothing was charged twice.{' '}
          <button className="btn btn-small btn-secondary" onClick={() => void c.retrySave()} disabled={snap.busy}>
            Retry save
          </button>
        </div>
      )}
      {snap.state.time.mode === 'unlimited' && <div className="banner banner-test">Test mode · unlimited Time</div>}
      <main id="main">
        {route.name === 'home' && <HomeScreen />}
        {route.name === 'team' && <TeamScreen tab={route.tab} />}
        {route.name === 'player' && <PlayerScreen id={route.id} />}
        {route.name === 'club' && <ClubScreen tab={route.tab} />}
        {route.name === 'league' && <LeagueScreen />}
        {route.name === 'history' && <HistoryScreen />}
        {route.name === 'settings' && <SettingsScreen />}
      </main>
    </div>
  );
}
