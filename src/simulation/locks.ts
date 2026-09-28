import { BALANCE } from '../balance/config';
import type { GameState } from '../domain/state';

/*
 * Locks shared by events and direct actions that describe the same effort,
 * so neither path can bypass the other: one individual program per player,
 * one fan gathering per cooldown, one board budget per season.
 */

const A = BALANCE.actions;
const played = (s: GameState) => s.cycle.matchesPlayed;
const games = (n: number) => `${n} game${n === 1 ? '' : 's'}`;

/** A program started by an event or a direct action occupies the player's single program slot. */
export function programBlocker(s: GameState, playerId: string): string | null {
  const p = s.actions.programs[playerId];
  return p ? `${s.players[playerId]?.lastName ?? 'He'} already has an individual program (${p.source}) until after the next game.` : null;
}

export function startProgram(s: GameState, playerId: string, kind: 'training' | 'recovery', source: string) {
  s.actions.programs[playerId] = { kind, until: played(s) + 1, source };
}

/** The fan forum (event) and the community initiative (direct action) share one cooldown. */
export function communityBlocker(s: GameState): string | null {
  const last = s.actions.lastUse.communityInitiative;
  const n = last === undefined ? Infinity : played(s) - last;
  return n < A.communityInitiative.cooldown ? `A fan gathering was held recently; the next one is possible in ${games(A.communityInitiative.cooldown - n)}.` : null;
}

export function markCommunity(s: GameState) {
  s.actions.lastUse.communityInitiative = played(s);
}

/** Board money shared by the check-in event and meetings: one budget per season. */
export function boardFundingLeft(s: GameState): number {
  const f = s.actions.boardFunding;
  return BALANCE.board.fundingPerSeason - (f.season === s.calendar.season ? f.granted : 0);
}

export function grantBoardFunding(s: GameState, amount: number) {
  if (s.actions.boardFunding.season !== s.calendar.season) s.actions.boardFunding = { season: s.calendar.season, granted: 0 };
  s.actions.boardFunding.granted += amount;
}
