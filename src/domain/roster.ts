import { BALANCE } from '../balance/config';
import { pitcherPosition } from './pitching';
import { overall, overallAt } from './ratings';
import type { GameState } from './state';
import type { ClubId, LineupPosition, Player, PlayerId } from './types';

/**
 * Why a squad (given as player ids) is not a valid fixed squad, or null:
 * nine hitters and five pitchers, one of them a starter (SP) and four
 * relievers (RP), nobody twice.
 */
export function squadProblem(state: GameState, roster: PlayerId[]): string | null {
  const players = roster.map((id) => state.players[id]);
  if (players.some((p) => !p)) return 'A player in the squad no longer exists.';
  if (new Set(roster).size !== roster.length) return 'A player is in the squad twice.';
  const hitters = players.filter((p) => !p.isPitcher).length;
  const sp = players.filter((p) => p.isPitcher && pitcherPosition(p) === 'SP').length;
  const rp = players.filter((p) => p.isPitcher && pitcherPosition(p) === 'RP').length;
  const q = BALANCE.squad;
  if (hitters !== q.hitters) return `The squad needs exactly ${q.hitters} hitters (has ${hitters}).`;
  if (sp !== 1) return `The squad needs exactly one starting pitcher (has ${sp}).`;
  if (rp !== q.pitchers - 1) return `The squad needs exactly ${q.pitchers - 1} relievers (has ${rp}).`;
  return null;
}

/**
 * Where a newcomer would help most: the squad's places from the weakest
 * occupant up (hitters by OVR at their position, pitchers as "P" at the
 * weakest pitcher's place in that order).
 */
export function positionNeeds(state: GameState, clubId: ClubId): (LineupPosition | 'P')[] {
  const club = state.clubs[clubId];
  const spots: { pos: LineupPosition | 'P'; v: number }[] = club.lineup.battingOrder.map((s) => ({ pos: s.position, v: state.players[s.playerId] ? overallAt(state.players[s.playerId], s.position) : 0 }));
  const pitchers = club.roster.map((id) => state.players[id]).filter((p) => p?.isPitcher);
  spots.push({ pos: 'P', v: pitchers.length ? Math.min(...pitchers.map(overall)) : 0 });
  return spots.sort((a, b) => a.v - b.v || String(a.pos).localeCompare(String(b.pos))).map((x) => x.pos);
}

/** Salary still owed this season, including the current round's unpaid share (used for buyouts). */
export function remainingSeasonSalary(state: GameState, p: Player): number {
  const rounds = BALANCE.season.rounds;
  const left = rounds - state.calendar.round + 1;
  return Math.round((p.contract.salary * left) / rounds);
}
