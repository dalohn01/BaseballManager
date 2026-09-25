import { BALANCE } from '../balance/config';
import { autoLineup, isLineupValid } from './lineup';
import type { GameState } from './state';
import { absoluteRound } from './state';
import type { ClubId, LineupPosition, Player, PlayerId } from './types';
import { DEFENSIVE_POSITIONS } from './types';

/**
 * Why a roster (given as player ids) could not field a valid team, or null.
 * Used before any signing, trade or release is allowed.
 */
export function squadProblem(state: GameState, roster: PlayerId[]): string | null {
  const players = roster.map((id) => state.players[id]);
  const pitchers = players.filter((p) => p.isPitcher).length;
  const hitters = players.filter((p) => !p.isPitcher);
  const r = BALANCE.roster;
  if (roster.length > r.max) return `The roster would exceed ${r.max} players.`;
  if (pitchers < r.minPitchers) return `The club needs at least ${r.minPitchers} pitchers.`;
  if (hitters.length < r.minHitters) return `The club needs at least ${r.minHitters} position players.`;
  if (!hitters.some((p) => p.positions.includes('C'))) return 'The club would have no catcher.';
  return null;
}

/** Positions ordered by how thin the club is there (fewest eligible players first). */
export function positionNeeds(state: GameState, clubId: ClubId): (LineupPosition | 'P')[] {
  const players = state.clubs[clubId].roster.map((id) => state.players[id]);
  const counts = new Map<LineupPosition | 'P', number>();
  for (const pos of DEFENSIVE_POSITIONS) counts.set(pos, players.filter((p) => p.positions.includes(pos)).length);
  counts.set('P', players.filter((p) => p.isPitcher).length / 2);
  return [...counts.entries()].sort((a, b) => a[1] - b[1] || String(a[0]).localeCompare(String(b[0]))).map(([pos]) => pos);
}

/** Adds a (new) player to a club. Salary starts next round. */
export function joinClub(state: GameState, player: Player, clubId: ClubId) {
  const { season, round } = state.calendar;
  player.clubId = clubId;
  player.contract.startRound = absoluteRound(season, round) + 1;
  player.joinedSeason = season;
  state.players[player.id] = player;
  state.clubs[clubId].roster.push(player.id);
}

/** Moves a player and his contract; already paid salary stays paid. */
export function transferPlayer(state: GameState, playerId: PlayerId, to: ClubId) {
  const p = state.players[playerId];
  const from = state.clubs[p.clubId];
  from.roster = from.roster.filter((id) => id !== playerId);
  const { season, round } = state.calendar;
  p.clubId = to;
  // Future salary moves with him: the new club pays from this round's settlement on.
  p.contract.startRound = Math.max(p.contract.startRound, absoluteRound(season, round));
  state.clubs[to].roster.push(playerId);
}

export function releasePlayer(state: GameState, playerId: PlayerId) {
  const p = state.players[playerId];
  const club = state.clubs[p.clubId];
  club.roster = club.roster.filter((id) => id !== playerId);
  p.clubId = '';
}

/** Rebuilds a lineup if a roster move made it invalid. Returns true if it changed. */
export function repairLineup(state: GameState, clubId: ClubId): boolean {
  const club = state.clubs[clubId];
  if (isLineupValid(state, clubId, club.lineup)) return false;
  club.lineup = autoLineup(state, clubId);
  return true;
}

/** Salary still owed this season, including the current round's unpaid share (used for buyouts). */
export function remainingSeasonSalary(state: GameState, p: Player): number {
  const rounds = BALANCE.season.rounds;
  const left = rounds - state.calendar.round + 1;
  return Math.round((p.contract.salary * left) / rounds);
}
