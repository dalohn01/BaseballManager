import { BALANCE } from '../../balance/config';
import type { EffectSink } from '../../domain/effects';
import { offenseScore } from '../../domain/lineup';
import type { Cost, EffectPreview, EventOption, GameState } from '../../domain/state';
import { clubPlayers, userClub } from '../../domain/state';
import type { ClubId, Player, PlayerId } from '../../domain/types';

export const T = BALANCE.time.costPerEvent;
export const cost = (cash = 0, influence = 0): Cost => ({ time: T, cash, influence });
export const fmt = (n: number) => `$${Math.abs(Math.round(n)).toLocaleString('en-US')}`;
export const pos = (text: string): EffectPreview => ({ text, tone: 'positive' });
export const neg = (text: string): EffectPreview => ({ text, tone: 'negative' });
export const neutral = (text: string): EffectPreview => ({ text, tone: 'neutral' });

export const passOption = (label = 'Pass', summary = 'Keep things as they are.'): EventOption => ({
  id: 'pass',
  label,
  summary,
  certain: [],
  uncertain: [],
  cost: cost(),
});

export const isInLineup = (state: GameState, clubId: ClubId, id: PlayerId) => {
  const l = state.clubs[clubId].lineup;
  return l.pitcherId === id || l.battingOrder.some((s) => s.playerId === id);
};

/** Puts `inId` into `outId`'s lineup spot (same position). If `inId` already starts, the two swap. */
export function substitute(state: GameState, clubId: ClubId, outId: PlayerId, inId: PlayerId) {
  const l = state.clubs[clubId].lineup;
  if (l.pitcherId === outId) {
    l.pitcherId = inId;
    return;
  }
  const outSlot = l.battingOrder.find((s) => s.playerId === outId);
  const inSlot = l.battingOrder.find((s) => s.playerId === inId);
  if (!outSlot) return;
  if (inSlot) inSlot.playerId = outId;
  outSlot.playerId = inId;
}

/** Weakest current starter the given hitter could replace (by position, DH as fallback). */
export function weakestStarterFor(state: GameState, p: Player): PlayerId | null {
  const club = userClub(state);
  const slots = club.lineup.battingOrder.filter((s) => s.playerId !== p.id && (p.positions.includes(s.position) || s.position === 'DH'));
  slots.sort((a, b) => offenseScore(state.players[a.playerId]) - offenseScore(state.players[b.playerId]));
  return slots[0]?.playerId ?? null;
}

/** Starters who lose out when a newcomer arrives at their position. */
export function competitionReaction(state: GameState, sink: EffectSink, newcomer: Player) {
  if (newcomer.isPitcher) return;
  const club = userClub(state);
  const primary = newcomer.positions[0];
  const slot = club.lineup.battingOrder.find((s) => s.position === primary);
  if (!slot) return;
  const incumbent = state.players[slot.playerId];
  if (incumbent.priority === 'playingTime' || incumbent.role === 'starter') {
    sink.playerMood(incumbent.id, 'satisfaction', -3, `New competition at ${primary}: ${newcomer.lastName}`);
  }
}

export const youngest = (state: GameState, filter: (p: Player) => boolean) =>
  clubPlayers(state, state.userClubId)
    .filter(filter)
    .sort((a, b) => a.age - b.age || a.id.localeCompare(b.id))[0];

export function describeCandidate(p: Player): string {
  const main = p.isPitcher
    ? `PIT ${p.ratings.pitching}`
    : `CON ${p.ratings.contact} · POW ${p.ratings.power} · SPD ${p.ratings.speed} · FLD ${p.ratings.fielding}`;
  return `${p.isPitcher ? 'P' : p.positions.join('/')} · age ${p.age} · ${main}`;
}
