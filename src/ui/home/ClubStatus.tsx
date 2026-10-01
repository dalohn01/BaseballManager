import { useState, type ReactElement } from 'react';
import { BALANCE } from '../../balance/config';
import { fitnessLabel, moodBand, moodLabel, type MoodActor } from '../../domain/mood';
import { clubPlayers, shortName, userClub } from '../../domain/state';
import type { Player } from '../../domain/types';
import { avg } from '../../simulation/training';
import { Panel, ReasonList } from '../components/common';
import { Icon } from '../components/icons';
import { href, useGame } from '../hooks';

/*
 * Club status: four rows (owners, fans, player happiness, fitness), each with
 * an illustration, the value, a meter, a short status word and details on
 * request. Colours follow the game's existing bands (BALANCE.moodBands for the
 * 0–100 satisfaction scale, fitnessLabel for fitness); every colour is paired
 * with a word and a number.
 */

type Tone = 'critical' | 'low' | 'warn' | 'neutral' | 'good' | 'great';

/** Satisfaction bands → tone: below 50 is bad, 65–84 sits around the neutral 75. */
const MOOD_TONE: Tone[] = ['critical', 'low', 'warn', 'neutral', 'great'];

function fitnessTone(v: number): Tone {
  const l = fitnessLabel(v);
  return l === 'Fresh' ? 'great' : l === 'Ready' ? 'good' : l === 'Tired' ? 'warn' : 'critical';
}

type RowKey = 'owners' | 'fans' | 'players' | 'fitness';

export function ClubStatus() {
  const s = useGame();
  const club = userClub(s);
  const players = clubPlayers(s, club.id);
  const happy = avg(players.map((p) => p.satisfaction));
  const fitness = Math.round(avg(players.map((p) => p.fitness)));
  const [open, setOpen] = useState<RowKey | null>(null);
  const toggle = (k: RowKey) => setOpen(open === k ? null : k);
  const mood = (actor: MoodActor, v: number) => ({ tone: MOOD_TONE[moodBand(v)], word: moodLabel(actor, v) });
  const rows: { key: RowKey; label: string; value: number; display: string; tone: Tone; word: string; neutral: boolean; icon: ReactElement }[] = [
    { key: 'owners', label: 'Owners', value: club.ownerConfidence, display: String(Math.round(club.ownerConfidence)), ...mood('owners', club.ownerConfidence), neutral: true, icon: <OwnersArt /> },
    { key: 'fans', label: 'Fans', value: club.fanSupport, display: String(Math.round(club.fanSupport)), ...mood('fans', club.fanSupport), neutral: true, icon: <FansArt /> },
    { key: 'players', label: 'Player happiness', value: happy, display: String(Math.round(happy)), ...mood('player', happy), neutral: true, icon: <PlayerArt band={moodBand(happy)} /> },
    { key: 'fitness', label: 'Fitness', value: fitness, display: `${fitness}%`, tone: fitnessTone(fitness), word: fitness >= 95 ? 'Match ready' : fitnessLabel(fitness), neutral: false, icon: <FitnessArt /> },
  ];
  return (
    <Panel title="Club status" className="club-status">
      <ul className="cs-rows">
        {rows.map((r) => (
          <li key={r.key} className={`cs-row tone-${r.tone} ${open === r.key ? 'open' : ''}`}>
            <button className="cs-main" onClick={() => toggle(r.key)} aria-expanded={open === r.key} aria-controls={`cs-${r.key}`}>
              <span className="cs-art" aria-hidden="true">
                {r.icon}
              </span>
              <span className="cs-text">
                <span className="cs-top">
                  <span className="cs-label">{r.label}</span>
                  <span className="cs-value">{r.display}</span>
                </span>
                <span className="cs-track" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(r.value)} aria-label={r.label}>
                  <span className="cs-fill" style={{ width: `${Math.max(0, Math.min(100, r.value))}%` }} />
                  {r.neutral && <span className="cs-neutral" style={{ left: `${BALANCE.satisfaction.neutral}%` }} title={`Neutral ${BALANCE.satisfaction.neutral}`} />}
                </span>
                <span className="cs-word">{r.word}</span>
              </span>
              <Icon name="chevron" size={18} className="cs-chev" />
            </button>
            {open === r.key && (
              <div className="cs-details" id={`cs-${r.key}`}>
                <Details row={r.key} players={players} />
              </div>
            )}
          </li>
        ))}
      </ul>
      <p className="cs-foot muted small">Select a status to see why</p>
    </Panel>
  );
}

function Details({ row, players }: { row: RowKey; players: Player[] }) {
  const s = useGame();
  const club = userClub(s);
  if (row === 'owners' || row === 'fans') {
    const reasons = row === 'owners' ? club.reasons.ownerConfidence : club.reasons.fanSupport;
    return reasons.length ? <ReasonList reasons={reasons} /> : <p className="muted small">No recent changes.</p>;
  }
  if (row === 'players') {
    const low = [...players].sort((a, b) => a.satisfaction - b.satisfaction).slice(0, 3);
    return (
      <>
        <p className="small">
          Squad average {Math.round(avg(players.map((p) => p.satisfaction)))} (neutral {BALANCE.satisfaction.neutral}). Least happy:
        </p>
        <ul className="cs-list">
          {low.map((p) => (
            <li key={p.id}>
              <a href={href(`team/${p.id}`)}>{shortName(p)}</a> {Math.round(p.satisfaction)} · {moodLabel('player', p.satisfaction)}
              {p.moodLog[0] ? <span className="muted"> — {p.moodLog[0].text}</span> : null}
            </li>
          ))}
        </ul>
        <a className="link small" href={href('team')}>
          All players →
        </a>
      </>
    );
  }
  const tired = [...players].filter((p) => p.fitness < BALANCE.fitness.warnBelow).sort((a, b) => a.fitness - b.fitness);
  return (
    <>
      <p className="small">
        Squad average {Math.round(avg(players.map((p) => p.fitness)))}%. 100% is fully ready; each point below costs {BALANCE.match.fitnessPenaltyPerPoint} rating.
      </p>
      {tired.length ? (
        <ul className="cs-list">
          {tired.slice(0, 5).map((p) => (
            <li key={p.id}>
              <a href={href(`team/${p.id}`)}>{shortName(p)}</a> {p.fitness}% · {fitnessLabel(p.fitness)}
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted small">Nobody is below {BALANCE.fitness.warnBelow}%.</p>
      )}
    </>
  );
}

// ------------------------------------------------------------ Illustrations

function OwnersArt() {
  return (
    <svg viewBox="0 0 48 48">
      <path d="M8 44c0-10 6-16 16-16s16 6 16 16z" fill="#1f3156" />
      <path d="M18 28l6 10 6-10z" fill="#fff" />
      <path d="M22.6 30h2.8l1 3-2.4 9-2.4-9z" fill="#c8323a" />
      <path d="M18 28l-3 6 5 3 4-9zM30 28l3 6-5 3-4-9z" fill="#2b4170" />
      <circle cx="24" cy="17" r="8" fill="#e9b892" />
      <path d="M16 15c1-6 15-7 16 0-3-2-12-2-16 0z" fill="#5b3a26" />
    </svg>
  );
}

function FansArt() {
  return (
    <svg viewBox="0 0 48 48">
      <path d="M30 6v22" stroke="#334" strokeWidth="2" />
      <path d="M31 6l13 4-13 4z" fill="#1f3156" />
      <circle cx="16" cy="22" r="6" fill="#e9b892" />
      <path d="M10 20c0-5 12-5 12 0z" fill="#1f3156" />
      <path d="M5 44c0-9 5-14 11-14s11 5 11 14z" fill="#2b6cb0" />
      <circle cx="32" cy="27" r="5.5" fill="#c98e67" />
      <path d="M22 44c0-8 4-12 10-12s10 4 10 12z" fill="#e05a2b" />
      <path d="M26 31l4-6" stroke="#c98e67" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

function PlayerArt({ band }: { band: number }) {
  // The small face follows the squad's band: frown, flat or smile.
  const mouth = band <= 1 ? 'M37 41q3-3 6 0' : band === 2 ? 'M37 40h6' : 'M37 39q3 3 6 0';
  return (
    <svg viewBox="0 0 48 48">
      <path d="M8 46c0-9 6-14 14-14s14 5 14 14z" fill="#1f3156" />
      <circle cx="22" cy="21" r="8" fill="#e9b892" />
      <path d="M13 19c0-7 18-7 18 0z" fill="#1f3156" />
      <path d="M29 18h7v3h-7z" fill="#1f3156" />
      <circle cx="40" cy="38" r="7" className="cs-face" />
      <circle cx="38" cy="36.5" r="0.9" fill="#3b2a12" />
      <circle cx="42" cy="36.5" r="0.9" fill="#3b2a12" />
      <path d={mouth} fill="none" stroke="#3b2a12" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  );
}

function FitnessArt() {
  return (
    <svg viewBox="0 0 48 48">
      <path d="M24 42S6 31 6 18a9 9 0 0 1 18-3 9 9 0 0 1 18 3c0 13-18 24-18 24z" className="cs-heart" />
      <path d="M8 24h9l3-6 4 12 3-8 2 2h11" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}
