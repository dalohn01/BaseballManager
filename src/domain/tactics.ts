import type { Club, ClubTactics, Instruction, Player, PlayerId, TacticArea, TeamStyle } from './types';

/*
 * Tactics: an optional layer. Every club has a saved playing style
 * (Balanced by default); a match plan can override it for one game; players
 * can have their own instructions (saved or for one game). Nothing here is
 * required to play: Balanced + Follow team is the neutral baseline, and the
 * match engine treats it exactly like the game did before tactics existed.
 */

export const TACTIC_AREAS: TacticArea[] = ['batting', 'baserunning', 'pitching'];

export const AREA_LABEL: Record<TacticArea, string> = {
  batting: 'Batting',
  baserunning: 'Baserunning',
  pitching: 'Pitching',
};

export interface StyleOption {
  value: string;
  label: string;
  /** One sentence: the upside and the cost. */
  explain: string;
}

export const STYLE_OPTIONS: Record<TacticArea, StyleOption[]> = {
  batting: [
    { value: 'contact', label: 'Contact', explain: 'Put the ball in play: fewer strikeouts, but fewer home runs. Suits good contact hitters.' },
    { value: 'balanced', label: 'Balanced', explain: 'Each hitter plays his natural game.' },
    { value: 'power', label: 'Power', explain: 'Swing for extra bases: more home runs, but more strikeouts. Only strong hitters gain.' },
  ],
  baserunning: [
    { value: 'cautious', label: 'Cautious', explain: 'Rarely steal or take the extra base: no runners thrown out, but fewer runs manufactured.' },
    { value: 'balanced', label: 'Balanced', explain: 'Fast runners steal now and then; the rest play it safe.' },
    { value: 'aggressive', label: 'Aggressive', explain: 'Steal more and push for extra bases: more pressure, but slower runners get thrown out.' },
  ],
  pitching: [
    { value: 'attack', label: 'Attack', explain: 'Throw strikes: fewer walks and longer outings, but more hittable pitches.' },
    { value: 'balanced', label: 'Balanced', explain: 'Mix strikes and chases as usual.' },
    { value: 'careful', label: 'Careful', explain: 'Work the corners: fewer hits and home runs, but more walks and starters tire sooner.' },
  ],
};

export const defaultStyle = (): TeamStyle => ({ batting: 'balanced', baserunning: 'balanced', pitching: 'balanced' });
export const defaultTactics = (): ClubTactics => ({ style: defaultStyle(), match: {}, instructions: {}, matchInstructions: {} });

export const optionLabel = (area: TacticArea, value: string) => STYLE_OPTIONS[area].find((o) => o.value === value)?.label ?? value;

/** Areas where an instruction to this player has an effect. */
export const relevantAreas = (p: Player): TacticArea[] => (p.isPitcher ? ['pitching'] : ['batting', 'baserunning']);

/** The team's plan for the next match: match-specific setting, else the saved style. */
export const teamPlan = (t: ClubTactics, area: TacticArea): string => t.match[area] ?? t.style[area];

export type TacticSource = 'matchInstruction' | 'instruction' | 'matchTeam' | 'team';

/**
 * Priority, highest first: this match's player instruction, the player's saved
 * instruction, the team's match plan, the team's saved style. "Follow team"
 * (value 'team') skips the player's own levels.
 */
export function resolveTactic(t: ClubTactics, playerId: PlayerId, area: TacticArea): { value: string; source: TacticSource } {
  const m = t.matchInstructions[playerId]?.[area];
  if (m && m !== 'team') return { value: m, source: 'matchInstruction' };
  if (!m) {
    const saved = t.instructions[playerId]?.[area];
    if (saved && saved !== 'team') return { value: saved, source: 'instruction' };
  }
  if (t.match[area]) return { value: t.match[area]!, source: 'matchTeam' };
  return { value: t.style[area], source: 'team' };
}

/** Is there anything that applies to the next match only? */
export function hasMatchChanges(club: Club): boolean {
  const t = club.tactics;
  return Object.keys(t.match).length > 0 || Object.values(t.matchInstructions).some((i) => Object.keys(i).length > 0);
}

/** Readable list of this match's changes, e.g. ["Baserunning: Aggressive", "Miller baserunning: Aggressive"]. */
export function matchChangeSummary(club: Club, name: (id: PlayerId) => string): string[] {
  const t = club.tactics;
  const out: string[] = [];
  for (const area of TACTIC_AREAS) if (t.match[area]) out.push(`${AREA_LABEL[area]}: ${optionLabel(area, t.match[area]!)}`);
  for (const [id, instr] of Object.entries(t.matchInstructions)) {
    for (const area of TACTIC_AREAS) {
      const v = instr[area];
      if (v) out.push(`${name(id)} ${AREA_LABEL[area].toLowerCase()}: ${v === 'team' ? 'Follow team' : optionLabel(area, v)}`);
    }
  }
  return out;
}

/** Match-only settings end with the match; the saved plan is untouched. */
export function clearMatchTactics(club: Club) {
  club.tactics.match = {};
  club.tactics.matchInstructions = {};
}

/** Instructions for players no longer at the club are dropped. */
export function pruneInstructions(club: Club) {
  const onRoster = new Set(club.roster);
  for (const key of ['instructions', 'matchInstructions'] as const) {
    for (const id of Object.keys(club.tactics[key])) if (!onRoster.has(id)) delete club.tactics[key][id];
  }
}

export type { Instruction };
