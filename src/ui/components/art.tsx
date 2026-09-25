import type { ReactNode } from 'react';
import type { Club, Player } from '../../domain/types';

/** Club crest drawn locally: shield in club colours with the club initial and a stitched ball. */
export function Crest({ club, size = 48 }: { club: Club; size?: number }) {
  const { primary, secondary } = club.colors;
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" role="img" aria-label={`${club.city} ${club.name} crest`}>
      <path d="M32 3l25 8v18c0 16-11 27-25 32C18 56 7 45 7 29V11z" fill={primary} stroke={secondary} strokeWidth="3" />
      <circle cx="32" cy="30" r="15" fill="#fff" />
      <path d="M22 20c4 4 4 16 0 20 M42 20c-4 4-4 16 0 20" stroke="#d6453d" strokeWidth="1.6" fill="none" strokeDasharray="2 2" />
      <text x="32" y="36" textAnchor="middle" fontFamily="'Barlow Condensed', sans-serif" fontWeight="800" fontStyle="italic" fontSize="18" fill={primary}>
        {club.name[0]}
      </text>
    </svg>
  );
}

function hash(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

const SKIN = ['#f1c7a5', '#e0ac85', '#c98e67', '#a86f4c', '#7d4f33', '#f5d5bb'];
const HAIR = ['#2b1d14', '#4a3222', '#7a5230', '#1b1b1b', '#9a6b3f', '#c9a063'];

/** Simple generated portrait (cap in club colours) — no external images. */
export function Avatar({ player, club, size = 56 }: { player: Player; club: Club; size?: number }) {
  const h = hash(player.id + player.lastName);
  const skin = SKIN[h % SKIN.length];
  const hair = HAIR[(h >> 3) % HAIR.length];
  const { primary, secondary } = club.colors;
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" role="img" aria-label={`${player.firstName} ${player.lastName}`} className="avatar">
      <rect width="64" height="64" rx="14" fill="#dfe9f6" />
      <path d="M8 64c2-12 12-17 24-17s22 5 24 17z" fill="#f7f9fc" stroke={primary} strokeWidth="2.5" />
      <path d="M26 48l6 6 6-6" fill="none" stroke={primary} strokeWidth="2.5" />
      <text x="32" y="62" textAnchor="middle" fontFamily="'Barlow Condensed', sans-serif" fontWeight="700" fontSize="9" fill={primary}>
        {player.number}
      </text>
      <rect x="27" y="38" width="10" height="9" fill={skin} />
      <ellipse cx="32" cy="30" rx="11" ry="12.5" fill={skin} />
      <path d="M21 29c0-3 1-5 2-6h18c1 1 2 3 2 6" fill={hair} opacity="0.9" />
      <path d="M19.5 24c0-8 5.5-12 12.5-12s12.5 4 12.5 12z" fill={primary} />
      <path d="M31 24h17c1 0 1 2.5-1 2.5H31z" fill={primary} stroke={secondary} strokeWidth="0.8" />
      <circle cx="32" cy="17.5" r="2.6" fill={secondary} />
      <circle cx="28" cy="31" r="1.2" fill="#2a1e17" />
      <circle cx="36" cy="31" r="1.2" fill="#2a1e17" />
      <path d="M28.5 36.5c2 1.5 5 1.5 7 0" stroke="#7a3d2c" strokeWidth="1.3" fill="none" strokeLinecap="round" />
    </svg>
  );
}

/** Illustrations for event types, drawn in the UI palette. */
export function EventArt({ type, club }: { type: string; club: Club }) {
  const { primary, secondary } = club.colors;
  const sky = (
    <>
      <defs>
        <linearGradient id="sky" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="#8fc3f0" />
          <stop offset="1" stopColor="#dcecfb" />
        </linearGradient>
      </defs>
      <rect width="400" height="150" fill="url(#sky)" />
      <path d="M0 105h400v45H0z" fill="#4fa64f" />
      <path d="M0 105h400" stroke="#3d8a3d" strokeWidth="3" />
      {[40, 110, 290, 360].map((x) => (
        <g key={x}>
          <rect x={x} y="22" width="4" height="60" fill="#9aa9bb" />
          <rect x={x - 12} y="14" width="28" height="12" rx="2" fill="#f4f7fb" stroke="#9aa9bb" />
        </g>
      ))}
    </>
  );
  if (type === 'leagueGame') {
    return (
      <svg viewBox="0 0 400 150" className="event-art" aria-hidden="true">
        {sky}
        <path d="M200 70l75 45-75 30-75-30z" fill="#c9895a" />
        <path d="M200 88l38 22-38 16-38-16z" fill="#4fa64f" />
        <rect x="195" y="98" width="10" height="6" fill="#fff" />
        <circle cx="200" cy="112" r="7" fill={primary} />
      </svg>
    );
  }
  if (type === 'fanInteraction') {
    return (
      <svg viewBox="0 0 400 150" className="event-art" aria-hidden="true">
        {sky}
        {Array.from({ length: 14 }, (_, i) => (
          <g key={i} transform={`translate(${20 + i * 27} ${i % 2 ? 92 : 100})`}>
            <circle cx="0" cy="0" r="9" fill={SKIN[i % SKIN.length]} />
            <path d="M-12 30c0-12 6-18 12-18s12 6 12 18z" fill={i % 3 ? primary : secondary} />
          </g>
        ))}
        <rect x="150" y="30" width="100" height="26" rx="4" fill="#fff" stroke={primary} strokeWidth="3" />
        <text x="200" y="49" textAnchor="middle" fontFamily="'Barlow Condensed', sans-serif" fontWeight="800" fontStyle="italic" fontSize="17" fill={primary}>
          GO {club.name.toUpperCase()}!
        </text>
      </svg>
    );
  }
  if (type === 'seasonReview') {
    return (
      <svg viewBox="0 0 400 150" className="event-art" aria-hidden="true">
        {sky}
        <path d="M175 30h50v30a25 25 0 0 1-50 0z" fill="#f2c233" stroke="#b88a12" strokeWidth="3" />
        <rect x="192" y="85" width="16" height="14" fill="#b88a12" />
        <rect x="178" y="99" width="44" height="10" rx="2" fill={primary} />
      </svg>
    );
  }
  const indoor = (children: ReactNode) => (
    <svg viewBox="0 0 400 150" className="event-art" aria-hidden="true">
      <rect width="400" height="150" fill="#e6edf7" />
      <rect y="112" width="400" height="38" fill="#cfd9e8" />
      <rect x="20" y="16" width="360" height="8" rx="4" fill={primary} opacity="0.85" />
      {children}
    </svg>
  );
  if (type === 'media') {
    return indoor(
      <>
        <rect x="120" y="44" width="160" height="62" rx="6" fill="#fff" stroke="#9aa9bb" strokeWidth="2" />
        <text x="200" y="66" textAnchor="middle" fontFamily="'Barlow Condensed', sans-serif" fontWeight="800" fontStyle="italic" fontSize="16" fill={primary}>
          THE HARBOR HERALD
        </text>
        {[76, 84, 92].map((y) => (
          <rect key={y} x="134" y={y} width="132" height="4" rx="2" fill="#c6d1e0" />
        ))}
        <rect x="60" y="60" width="14" height="40" rx="7" fill="#2c3e55" />
        <rect x="64" y="96" width="6" height="18" fill="#2c3e55" />
        <rect x="326" y="60" width="14" height="40" rx="7" fill="#2c3e55" />
        <rect x="330" y="96" width="6" height="18" fill="#2c3e55" />
      </>,
    );
  }
  if (type === 'boardMeeting') {
    return indoor(
      <>
        <ellipse cx="200" cy="100" rx="130" ry="18" fill="#8a5a33" />
        {[100, 160, 240, 300].map((x, i) => (
          <g key={x}>
            <circle cx={x} cy="62" r="11" fill={SKIN[(i + 2) % SKIN.length]} />
            <path d={`M${x - 16} 96c0-16 7-24 16-24s16 8 16 24z`} fill={i % 2 ? '#2c3e55' : primary} />
          </g>
        ))}
        <rect x="186" y="40" width="28" height="36" rx="3" fill="#fff" stroke="#9aa9bb" />
        <path d="M192 66l6-8 6 4 6-12" stroke={secondary} strokeWidth="2.5" fill="none" />
      </>,
    );
  }
  if (type === 'facility') {
    return (
      <svg viewBox="0 0 400 150" className="event-art" aria-hidden="true">
        {sky}
        <rect x="150" y="50" width="120" height="55" fill="#f4f7fb" stroke="#9aa9bb" strokeWidth="2" />
        <path d="M140 50h140l-70-24z" fill={primary} />
        <path d="M300 105V20h6v85 M306 24h60 M360 24v30" stroke="#f2b01e" strokeWidth="5" fill="none" />
        <rect x="350" y="54" width="20" height="12" fill="#8a9bb0" />
      </svg>
    );
  }
  if (type === 'sponsor') {
    return (
      <svg viewBox="0 0 400 150" className="event-art" aria-hidden="true">
        {sky}
        <rect x="90" y="30" width="220" height="60" rx="4" fill="#fff" stroke={primary} strokeWidth="4" />
        <text x="200" y="68" textAnchor="middle" fontFamily="'Barlow Condensed', sans-serif" fontWeight="800" fontStyle="italic" fontSize="26" fill={primary}>
          YOUR BRAND HERE
        </text>
        <rect x="120" y="90" width="6" height="15" fill="#9aa9bb" />
        <rect x="274" y="90" width="6" height="15" fill="#9aa9bb" />
      </svg>
    );
  }
  if (type === 'trade' || type === 'freeAgent' || type === 'tryouts' || type === 'draft') {
    return (
      <svg viewBox="0 0 400 150" className="event-art" aria-hidden="true">
        {sky}
        {[140, 260].map((x, i) => (
          <g key={x} transform={`translate(${x} 58)`}>
            <circle r="15" fill={SKIN[(i * 3) % SKIN.length]} />
            <path d="M-15 -4c0-9 7-15 15-15s15 6 15 15z" fill={i === 0 ? primary : '#7a1f2b'} />
            <path d="M-26 62c0-28 10-44 26-44s26 16 26 44z" fill="#f7f9fc" stroke={i === 0 ? primary : '#7a1f2b'} strokeWidth="3" />
          </g>
        ))}
        <path d="M168 96h64" stroke="#2c3e55" strokeWidth="6" strokeLinecap="round" />
        <path d="M222 88l12 8-12 8 M178 88l-12 8 12 8" stroke="#2c3e55" strokeWidth="4" fill="none" strokeLinecap="round" />
      </svg>
    );
  }
  // Training
  return (
    <svg viewBox="0 0 400 150" className="event-art" aria-hidden="true">
      {sky}
      <rect x="250" y="40" width="120" height="70" fill="none" stroke="#2c3e55" strokeWidth="2" strokeDasharray="4 3" />
      <g transform="translate(150 60)">
        <circle cx="0" cy="0" r="13" fill={SKIN[1]} />
        <path d="M-13 -3c0-9 6-14 13-14s13 5 13 14z" fill={primary} />
        <path d="M-20 60c0-24 8-38 20-38s20 14 20 38z" fill="#f7f9fc" stroke={primary} strokeWidth="3" />
        <path d="M12 30l40-48" stroke="#b07a45" strokeWidth="7" strokeLinecap="round" />
      </g>
      {[300, 320, 340].map((x, i) => (
        <circle key={x} cx={x} cy={70 + i * 8} r="6" fill="#fff" stroke="#d6453d" strokeWidth="1.2" />
      ))}
    </svg>
  );
}
