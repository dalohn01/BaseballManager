import { useEffect, useRef } from 'react';
import { PlayerAvatar } from '../components/PlayerAvatar';
import { ballparkName } from '../../content/ballparks';
import { clubName } from '../../domain/state';
import type { Club, MatchResult, Player } from '../../domain/types';
import { Crest } from '../components/art';
import { Icon } from '../components/icons';
import { useGame } from '../hooks';

/** Suggested intro length (brief: 4–6 s); reduced motion keeps it short and still. */
export const INTRO_MS = 5200;
export const INTRO_REDUCED_MS = 3200;

/**
 * Short arrival at the home team's ballpark between Confirm lineup and the
 * first commentary. Purely presentational: the match is already simulated and
 * saved, so skipping only ends the intro and opens the same match session.
 */
export function MatchIntro({ match, round, reduced, onDone }: { match: MatchResult; round: number; reduced: boolean; onDone: () => void }) {
  const s = useGame();
  const home = s.clubs[match.homeId];
  const away = s.clubs[match.awayId];
  const skipRef = useRef<HTMLButtonElement>(null);
  const doneRef = useRef(onDone);
  doneRef.current = onDone;

  useEffect(() => {
    skipRef.current?.focus({ preventScroll: true });
    const id = window.setTimeout(() => doneRef.current(), reduced ? INTRO_REDUCED_MS : INTRO_MS);
    return () => window.clearTimeout(id);
  }, [reduced]);

  const pitcher = (side: 'home' | 'away') => s.players[match.lineups[side].pitcherId];

  return (
    <section className={`match-intro ${reduced ? 'reduced' : ''}`} aria-label="Match intro" style={{ ['--intro-ms' as string]: `${reduced ? INTRO_REDUCED_MS : INTRO_MS}ms` }}>
      <div className="intro-stage">
        <ArenaArt club={home} name={ballparkName(home)} />
        <span className="intro-confirmed">
          <Icon name="check" size={18} /> Lineup confirmed
        </span>
        <div className="intro-title">
          <span className="intro-ribbon">League game · Round {round}</span>
          <h1>Welcome to {ballparkName(home)}</h1>
          <p>Home of the {clubName(home)}</p>
        </div>
        <div className="intro-card">
          <div className="intro-teams">
            <TeamSide club={away} label="Away" />
            <span className="intro-vs">VS</span>
            <TeamSide club={home} label="Home" />
          </div>
          <h2 className="intro-sub">Starting pitchers</h2>
          <div className="intro-pitchers">
            <PitcherCard player={pitcher('away')} club={away} />
            <PitcherCard player={pitcher('home')} club={home} />
          </div>
        </div>
      </div>
      <div className="intro-bar">
        <Icon name="mic" size={24} />
        <p aria-live="polite">The teams are ready. First pitch is coming up…</p>
        <span className="intro-progress" aria-hidden="true">
          <span />
        </span>
        <span className="muted small intro-entering">Entering the game…</span>
        <button ref={skipRef} className="btn btn-secondary" onClick={onDone}>
          Skip intro <Icon name="chevron" size={16} />
        </button>
      </div>
    </section>
  );
}

function TeamSide({ club, label }: { club: Club; label: string }) {
  return (
    <div className="intro-team">
      <Crest club={club} size={64} />
      <div>
        <strong>{clubName(club)}</strong>
        <small>{label}</small>
      </div>
    </div>
  );
}

function PitcherCard({ player, club }: { player: Player | undefined; club: Club }) {
  if (!player) return <div className="intro-pitcher" />;
  return (
    <div className="intro-pitcher">
      <PlayerAvatar player={player} club={club} size={72} />
      <div>
        <strong>
          {player.firstName} {player.lastName}
        </strong>
        <small>
          {player.throws}HP · {club.city}
        </small>
      </div>
    </div>
  );
}

/**
 * Neutral ballpark illustration drawn in code with the home club's colours and
 * crest. A text-free painted arena background can replace it later.
 */
function ArenaArt({ club, name }: { club: Club; name: string }) {
  const { primary, secondary } = club.colors;
  const brick = '#a4533a';
  return (
    <svg className="arena-art" viewBox="0 0 1200 560" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <defs>
        <linearGradient id="arena-sky" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="#6fb0ea" />
          <stop offset="0.7" stopColor="#cfe5f8" />
          <stop offset="1" stopColor="#f6e7cf" />
        </linearGradient>
      </defs>
      <rect width="1200" height="560" fill="url(#arena-sky)" />
      {[
        [140, 90, 1.2],
        [930, 70, 1],
        [560, 50, 0.8],
      ].map(([x, y, k], i) => (
        <g key={i} fill="#fff" opacity="0.85" transform={`translate(${x} ${y}) scale(${k})`}>
          <ellipse cx="0" cy="0" rx="60" ry="18" />
          <ellipse cx="40" cy="-10" rx="40" ry="20" />
          <ellipse cx="-35" cy="-6" rx="30" ry="15" />
        </g>
      ))}
      {/* Light towers */}
      {[210, 990].map((x) => (
        <g key={x}>
          <rect x={x - 4} y="70" width="8" height="260" fill="#8d9bb0" />
          <rect x={x - 40} y="50" width="80" height="34" rx="3" fill="#eef3f9" stroke="#8d9bb0" strokeWidth="3" />
          {[0, 1, 2, 3].map((c) => (
            <circle key={c} cx={x - 28 + c * 19} cy="67" r="6" fill="#fff8d8" />
          ))}
        </g>
      ))}
      {/* Upper deck */}
      <path d="M150 250 Q600 150 1050 250 L1050 300 L150 300 Z" fill={primary} />
      <path d="M150 250 Q600 150 1050 250" stroke="#fff" strokeWidth="4" fill="none" opacity="0.6" />
      {/* Flags */}
      {[260, 380, 820, 940].map((x, i) => (
        <g key={x}>
          <rect x={x} y={i % 3 ? 170 : 190} width="3" height="70" fill="#5b6778" />
          <path d={`M${x + 3} ${i % 3 ? 172 : 192} l34 10 l-34 10z`} fill={secondary} />
        </g>
      ))}
      {/* Brick facade */}
      <rect x="120" y="290" width="960" height="210" fill={brick} />
      {Array.from({ length: 12 }, (_, i) => (
        <rect key={i} x={140 + i * 80} y="300" width="10" height="200" fill="#8e452f" />
      ))}
      <rect x="120" y="290" width="960" height="14" fill="#e7dccb" />
      {/* Arches */}
      {Array.from({ length: 9 }, (_, i) => {
        const x = 170 + i * 100;
        return <path key={i} d={`M${x} 500 v-90 a35 35 0 0 1 70 0 v90z`} fill="#26364d" stroke="#e7dccb" strokeWidth="4" />;
      })}
      {/* Main gate with the home crest */}
      <path d="M470 500 V360 a130 90 0 0 1 260 0 V500z" fill="#1d2a3f" stroke="#e7dccb" strokeWidth="6" />
      <path d="M490 500 V380 h220 V500" fill="#5fae5a" opacity="0.8" />
      <rect x="440" y="318" width="320" height="46" rx="8" fill={primary} stroke="#fff" strokeWidth="3" />
      <text x="600" y="351" textAnchor="middle" fontFamily="'Barlow Condensed', sans-serif" fontWeight="800" fontSize="30" letterSpacing="4" fill="#fff">
        {name.toUpperCase()}
      </text>
      <g transform="translate(560 208) scale(1.25)">
        <path d="M32 3l25 8v18c0 16-11 27-25 32C18 56 7 45 7 29V11z" fill={primary} stroke={secondary} strokeWidth="3" />
        <circle cx="32" cy="30" r="15" fill="#fff" />
        <text x="32" y="36" textAnchor="middle" fontFamily="'Barlow Condensed', sans-serif" fontWeight="800" fontStyle="italic" fontSize="18" fill={primary}>
          {club.name[0]}
        </text>
      </g>
      {/* Banners */}
      {[330, 850].map((x) => (
        <rect key={x} x={x} y="330" width="28" height="90" fill={secondary} stroke="#fff" strokeWidth="2" />
      ))}
      {/* Trees and plaza */}
      <rect y="500" width="1200" height="60" fill="#d9d2c4" />
      {[60, 1120, 20, 1170].map((x, i) => (
        <g key={i}>
          <rect x={x - 5} y="400" width="10" height="110" fill="#6b4a2d" />
          <circle cx={x} cy={i < 2 ? 380 : 430} r={i < 2 ? 70 : 55} fill={i % 2 ? '#3f8a3f' : '#4d9b45'} />
        </g>
      ))}
      {/* Crowd heading in */}
      {Array.from({ length: 60 }, (_, i) => {
        const x = 30 + ((i * 97) % 1140);
        const y = 515 + ((i * 13) % 30);
        return (
          <g key={i}>
            <circle cx={x} cy={y - 12} r="6" fill={['#f1c7a5', '#c98e67', '#7d4f33', '#e0ac85'][i % 4]} />
            <rect x={x - 7} y={y - 6} width="14" height="20" rx="5" fill={[primary, secondary, '#f7f9fc', '#3c4b61'][i % 4]} />
          </g>
        );
      })}
    </svg>
  );
}
