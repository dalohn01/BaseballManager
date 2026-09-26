import { BALANCE } from '../../balance/config';
import { fitnessLabel, moodLabel } from '../../domain/mood';
import { battingStats, fmtEra, fmtIp, fmtRate, pitchingStats, type StatsPeriod, type StatusNote } from '../../domain/playerStats';
import { overall, overallAt } from '../../domain/ratings';
import type { GameState } from '../../domain/state';
import type { LineupPosition, Player } from '../../domain/types';
import { Avatar } from '../components/art';

export type DataMode = 'attributes' | 'stats';

/** Fitness: battery icon + percent (+ label); colour is never the only signal. */
export function FitnessMeter({ value, showLabel = false }: { value: number; showLabel?: boolean }) {
  const f = BALANCE.fitness;
  const tone = value < f.needsRestBelow ? 'bad' : value < f.warnBelow ? 'warn' : 'good';
  return (
    <span className={`fit-meter fit-${tone}`} title={`Fitness ${value}% · ${fitnessLabel(value)}`}>
      <svg viewBox="0 0 26 14" width="24" height="13" aria-hidden="true">
        <rect x="1" y="1" width="21" height="12" rx="2.5" fill="none" stroke="currentColor" strokeWidth="1.6" />
        <rect x="22.5" y="4.5" width="2.5" height="5" rx="1" fill="currentColor" />
        <rect x="3" y="3" width={Math.max(1, (17 * value) / 100)} height="8" rx="1.2" fill="currentColor" />
      </svg>
      <span className="sr-only">Fitness</span>
      <strong>{value}%</strong>
      {showLabel && <small>{fitnessLabel(value)}</small>}
    </span>
  );
}

/** Happiness: face icon + value. */
export function HappinessMeter({ value }: { value: number }) {
  const tone = value < 40 ? 'bad' : value < 60 ? 'warn' : 'good';
  const mouth = value < 40 ? 'M8 16 Q12 12 16 16' : value < 60 ? 'M8 15 H16' : 'M8 14 Q12 18 16 14';
  return (
    <span className={`hap-meter hap-${tone}`} title={`Happiness ${value} · ${moodLabel('player', value)}`}>
      <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
        <circle cx="12" cy="12" r="10" fill="currentColor" />
        <circle cx="8.5" cy="10" r="1.4" fill="#fff" />
        <circle cx="15.5" cy="10" r="1.4" fill="#fff" />
        <path d={mouth} stroke="#fff" strokeWidth="1.8" fill="none" strokeLinecap="round" />
      </svg>
      <span className="sr-only">Happiness</span>
      <strong>{value}</strong>
    </span>
  );
}

export const PosBadge = ({ pos }: { pos: string }) => <span className="pos-badge">{pos}</span>;

export function Notes({ notes, max = 2 }: { notes: StatusNote[]; max?: number }) {
  if (notes.length === 0) return null;
  return (
    <span className="notes-row">
      {notes.slice(0, max).map((n) => (
        <span key={n.text} className={`note-chip note-${n.tone}`}>
          {n.tone === 'warn' ? '! ' : ''}
          {n.text}
        </span>
      ))}
    </span>
  );
}

export function Portrait({ state, player, size = 52 }: { state: GameState; player: Player; size?: number }) {
  return (
    <span className="portrait">
      <Avatar player={player} club={state.clubs[player.clubId] ?? state.clubs[state.userClubId]} size={size} />
      <span className="portrait-ovr" title="Overall rating">
        {overall(player)}
      </span>
    </span>
  );
}

export interface Val {
  label: string;
  value: string;
  title?: string;
}

/** The values a hitter shows in the chosen data mode (fitness and happiness are always shown separately). */
export function hitterValues(state: GameState, p: Player, mode: DataMode, period: StatsPeriod, context: 'field' | 'order', pos?: LineupPosition): Val[] {
  if (mode === 'attributes') {
    if (context === 'order') {
      return [
        { label: 'CON', value: String(p.ratings.contact), title: 'Contact' },
        { label: 'POW', value: String(p.ratings.power), title: 'Power' },
        { label: 'SPD', value: String(p.ratings.speed), title: 'Speed' },
      ];
    }
    const at = pos ?? p.positions[0] ?? 'DH';
    const natural = at === 'DH' || p.positions.includes(at);
    return [
      { label: `OVR ${at}`, value: String(overallAt(p, at)), title: `Overall at ${at}` },
      { label: 'Fit', value: natural ? (at === 'DH' ? 'Hitter' : 'Natural') : `Out of pos. −${BALANCE.match.outOfPositionFieldingPenalty} FLD`, title: 'Position suitability' },
    ];
  }
  const b = battingStats(state, p, period);
  if (context === 'order') {
    return [
      { label: 'AVG', value: fmtRate(b.avg) },
      { label: 'OBP', value: fmtRate(b.obp) },
      { label: 'SLG', value: fmtRate(b.slg) },
      { label: 'PA', value: String(b.pa) },
    ];
  }
  return [
    { label: 'AVG', value: fmtRate(b.avg) },
    { label: 'HR', value: String(b.hr) },
    { label: 'RBI', value: String(b.rbi) },
    { label: 'G', value: String(b.g) },
  ];
}

export function pitcherValues(state: GameState, p: Player, mode: DataMode, period: StatsPeriod, compact = false): Val[] {
  if (mode === 'attributes') {
    return [
      { label: 'PIT', value: String(p.ratings.pitching), title: 'Pitching' },
      { label: 'OVR', value: String(overall(p)) },
    ];
  }
  const s = pitchingStats(state, p, period);
  const vals: Val[] = [
    { label: 'ERA', value: fmtEra(s.era), title: 'Earned run average (all runs are earned: no errors in this model)' },
    { label: 'WHIP', value: s.whip === null ? '—' : s.whip.toFixed(2), title: 'Walks + hits per inning' },
  ];
  if (!compact) vals.push({ label: 'K', value: String(s.so) });
  vals.push({ label: 'IP', value: fmtIp(s.outs), title: 'Innings pitched' });
  return vals;
}

export function Values({ vals }: { vals: Val[] }) {
  return (
    <span className="vals">
      {vals.map((v) => (
        <span key={v.label} className="val" title={v.title}>
          <small>{v.label}</small>
          <strong>{v.value}</strong>
        </span>
      ))}
    </span>
  );
}

export const ABBREVIATIONS: Record<string, string> = {
  AVG: 'Batting average: hits per at-bat',
  OBP: 'On-base percentage: (hits + walks) per plate appearance',
  SLG: 'Slugging: total bases per at-bat',
  PA: 'Plate appearances',
  AB: 'At-bats',
  HR: 'Home runs',
  RBI: 'Runs batted in',
  G: 'Games played',
  ERA: 'Runs allowed per 9 innings (every run is earned: the model has no errors)',
  WHIP: 'Walks + hits per inning pitched',
  K: 'Strikeouts',
  IP: 'Innings pitched (10.2 = 10⅔)',
};

export function Legend({ keys }: { keys: string[] }) {
  return (
    <details className="legend">
      <summary>What the abbreviations mean</summary>
      <dl>
        {keys.map((k) => (
          <div key={k}>
            <dt>{k}</dt>
            <dd>{ABBREVIATIONS[k]}</dd>
          </div>
        ))}
      </dl>
    </details>
  );
}
