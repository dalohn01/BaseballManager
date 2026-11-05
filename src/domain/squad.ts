import { BALANCE } from '../balance/config';
import { createPlayer, marketSalary } from '../content/playerFactory';
import { autoLineup, validateBatters } from './lineup';
import type { EffectSink } from './effects';
import { pitcherPosition } from './pitching';
import { overall } from './ratings';
import type { Rng } from './rng';
import type { GameState } from './state';
import { absoluteRound, nextId, playerName } from './state';
import { bestPitching, emptyBullpen, PITCHING_SLOTS, RELIEF_SLOTS, relieverValue, type PitchingSlot } from './todayPitching';
import type { ClubId, LineupPosition, Player, PlayerId } from './types';
import { LINEUP_POSITIONS } from './types';

/*
 * The fixed squad: fourteen players, each with a fixed place. Nine hitters,
 * one per lineup position (C, 1B, 2B, 3B, SS, LF, CF, RF, DH), and five
 * pitchers, one per role (Starter, Long, Middle, Setup, Closer). There is no
 * bench: a new player always takes someone's place. In a trade the two swap
 * places; a signed free agent, prospect or draftee sends the player he
 * replaces to the transfer list, where AI clubs may buy him for a fee, or he
 * is released when the listing runs out. The lineup and the pitching plan are
 * the squad: club.roster is kept in step with them.
 */

export type SquadSlot = LineupPosition | PitchingSlot;
export const SQUAD_SLOTS: SquadSlot[] = [...LINEUP_POSITIONS, ...PITCHING_SLOTS];
export const SQUAD_SLOT_LABEL: Record<SquadSlot, string> = { C: 'C', '1B': '1B', '2B': '2B', '3B': '3B', SS: 'SS', LF: 'LF', CF: 'CF', RF: 'RF', DH: 'DH', starter: 'the starting pitcher role', long: 'long relief', middle: 'middle relief', setup: 'setup', closer: 'closer' };
export const isPitchingSlot = (slot: SquadSlot): slot is PitchingSlot => (PITCHING_SLOTS as string[]).includes(slot);

/** Who may take a place: hitters any lineup spot (out of position is allowed), starters the start, relievers relief. */
export function fitsSlot(p: Player, slot: SquadSlot): boolean {
  if (!isPitchingSlot(slot)) return !p.isPitcher;
  if (!p.isPitcher) return false;
  return (slot === 'starter') === (pitcherPosition(p) === 'SP');
}

/** The player in a place, or null. */
export function playerAt(state: GameState, clubId: ClubId, slot: SquadSlot): PlayerId | null {
  const club = state.clubs[clubId];
  if (slot === 'starter') return club.lineup.pitcherId || null;
  if (isPitchingSlot(slot)) return club.pitchingPlan.bullpen?.[slot] ?? null;
  return club.lineup.battingOrder.find((s) => s.position === slot)?.playerId || null;
}

/** A player's place in his club's squad, or null (not in it, e.g. on the transfer list). */
export function slotOf(state: GameState, clubId: ClubId, id: PlayerId): SquadSlot | null {
  return SQUAD_SLOTS.find((slot) => playerAt(state, clubId, slot) === id) ?? null;
}

/** club.roster follows the squad: the nine batters, then the five pitchers. */
export function syncRoster(state: GameState, clubId: ClubId) {
  const club = state.clubs[clubId];
  const ids = SQUAD_SLOTS.map((slot) => playerAt(state, clubId, slot)).filter((id): id is PlayerId => !!id);
  club.roster = [...new Set(ids)];
}

/** Puts a player in a place; returns whoever was there (or null). */
export function putInSlot(state: GameState, clubId: ClubId, slot: SquadSlot, id: PlayerId | null): PlayerId | null {
  const club = state.clubs[clubId];
  const out = playerAt(state, clubId, slot);
  if (slot === 'starter') club.lineup = { ...club.lineup, pitcherId: id ?? '' };
  else if (isPitchingSlot(slot)) club.pitchingPlan = { ...club.pitchingPlan, bullpen: { ...emptyBullpen(), ...club.pitchingPlan.bullpen, [slot]: id } };
  else {
    const i = club.lineup.battingOrder.findIndex((s) => s.position === slot);
    if (i >= 0) club.lineup.battingOrder[i] = { ...club.lineup.battingOrder[i], playerId: id ?? '' };
    else if (id) club.lineup.battingOrder.push({ playerId: id, position: slot });
  }
  syncRoster(state, clubId);
  return out === id ? null : out;
}

/**
 * The place a newcomer takes: a hitter his primary position (or, if that is
 * the DH, the DH), a starter the start, a reliever the weakest relief role.
 */
export function replacementSlot(state: GameState, clubId: ClubId, p: Player): SquadSlot {
  if (p.isPitcher) {
    if (pitcherPosition(p) === 'SP') return 'starter';
    const pen = RELIEF_SLOTS.map((slot) => ({ slot, q: playerAt(state, clubId, slot) }));
    const empty = pen.find((x) => !x.q);
    if (empty) return empty.slot;
    return pen.sort((a, b) => relieverValue(state, state.players[a.q!]) - relieverValue(state, state.players[b.q!]))[0].slot;
  }
  return (p.positions[0] ?? 'DH') as LineupPosition;
}

/** The place a newcomer would take and who he would replace there. */
export function replacementFor(state: GameState, clubId: ClubId, p: Player): { slot: SquadSlot; outId: PlayerId | null } {
  const slot = replacementSlot(state, clubId, p);
  return { slot, outId: playerAt(state, clubId, slot) };
}

// ---------------------------------------------------------------- Joining and leaving

/** Signs a new player into a place (his salary starts next round); the player he replaces goes to the transfer list. */
export function signInto(state: GameState, clubId: ClubId, p: Player, slot: SquadSlot = replacementSlot(state, clubId, p)): PlayerId | null {
  const { season, round } = state.calendar;
  p.clubId = clubId;
  p.contract.startRound = Math.max(p.contract.startRound, absoluteRound(season, round) + 1);
  p.joinedSeason = season;
  state.players[p.id] = p;
  const out = putInSlot(state, clubId, slot, p.id);
  if (out) {
    if (state.clubs[clubId].isUser) listForTransfer(state, clubId, out);
    else release(state, out);
  }
  return out;
}

/** A trade: the two players swap places and clubs; future salary moves with each. */
export function swapPlayers(state: GameState, aId: PlayerId, bId: PlayerId) {
  const a = state.players[aId];
  const b = state.players[bId];
  const aClub = a.clubId;
  const bClub = b.clubId;
  const aSlot = slotOf(state, aClub, aId)!;
  const bSlot = slotOf(state, bClub, bId)!;
  const { season, round } = state.calendar;
  const now = absoluteRound(season, round);
  a.clubId = bClub;
  b.clubId = aClub;
  a.contract.startRound = Math.max(a.contract.startRound, now);
  b.contract.startRound = Math.max(b.contract.startRound, now);
  putInSlot(state, aClub, aSlot, bId);
  putInSlot(state, bClub, bSlot, aId);
}

/** Can these two be traded for each other (same kind of place: hitter for hitter, starter for starter, reliever for reliever)? */
export function tradeable(state: GameState, outId: PlayerId, inId: PlayerId): boolean {
  const out = state.players[outId];
  const inc = state.players[inId];
  const outSlot = slotOf(state, out.clubId, outId);
  const inSlot = slotOf(state, inc.clubId, inId);
  return !!outSlot && !!inSlot && fitsSlot(inc, outSlot) && fitsSlot(out, inSlot);
}

/** The player leaves the league: no club, no further salary. */
export function release(state: GameState, id: PlayerId) {
  const p = state.players[id];
  if (!p) return;
  const club = state.clubs[p.clubId];
  if (club) {
    const slot = slotOf(state, club.id, id);
    if (slot) putInSlot(state, club.id, slot, null);
    club.transferList = (club.transferList ?? []).filter((t) => t.playerId !== id);
    syncRoster(state, club.id);
  }
  p.clubId = '';
}

// ---------------------------------------------------------------- Transfer list

/** Puts a replaced player on the club's transfer list: still under contract and paid until sold or released. */
export function listForTransfer(state: GameState, clubId: ClubId, id: PlayerId) {
  const club = state.clubs[clubId];
  const now = absoluteRound(state.calendar.season, state.calendar.round);
  club.transferList = [...(club.transferList ?? []).filter((t) => t.playerId !== id), { playerId: id, listed: now, until: now + BALANCE.transfer.listRounds }];
}

/** Everyone a club pays: the squad and the transfer list. */
export const contracted = (state: GameState, clubId: ClubId): PlayerId[] => {
  const club = state.clubs[clubId];
  return [...club.roster, ...(club.transferList ?? []).map((t) => t.playerId)].filter((id) => state.players[id]?.clubId === clubId);
};

/** What an AI club pays for a listed player. */
export const transferFee = (p: Player) => Math.round((marketSalary(overall(p), p.age) * BALANCE.transfer.feeShare) / 1000) * 1000;

/**
 * Once per round: listed players may be bought by an AI club that has a
 * weaker player in that kind of place (he is released), the fee goes to the
 * selling club; a listing that has run out ends with a release. Returns
 * short notes for the user's round report.
 */
export function settleTransferList(state: GameState, rng: Rng, sink?: EffectSink): string[] {
  const notes: string[] = [];
  const now = absoluteRound(state.calendar.season, state.calendar.round);
  for (const clubId of state.clubOrder) {
    const club = state.clubs[clubId];
    for (const t of [...(club.transferList ?? [])]) {
      const p = state.players[t.playerId];
      if (!p || p.clubId !== clubId) {
        club.transferList = (club.transferList ?? []).filter((x) => x.playerId !== t.playerId);
        continue;
      }
      const buyers = state.clubOrder
        .filter((id) => id !== clubId && !state.clubs[id].isUser)
        .map((id) => ({ id, ...replacementFor(state, id, p) }))
        .filter((b) => !b.outId || overall(state.players[b.outId]) < overall(p))
        .sort((a, b) => (a.outId ? overall(state.players[a.outId]) : 0) - (b.outId ? overall(state.players[b.outId]) : 0) || a.id.localeCompare(b.id));
      if (buyers.length && rng.chance(BALANCE.transfer.saleChancePerRound)) {
        const buyer = buyers[0];
        const fee = transferFee(p);
        club.transferList = (club.transferList ?? []).filter((x) => x.playerId !== p.id);
        p.clubId = '';
        signInto(state, buyer.id, p, buyer.slot);
        if (sink) sink.cash(clubId, fee, 'event', `Transfer: ${playerName(p)} to ${state.clubs[buyer.id].name}`);
        else club.cash += fee;
        if (club.isUser) notes.push(`${playerName(p)} was sold to the ${state.clubs[buyer.id].name} for $${fee.toLocaleString('en-US')}.`);
      } else if (now >= t.until) {
        release(state, p.id);
        if (club.isUser) notes.push(`${playerName(p)} left the club: nobody bought him from the transfer list.`);
      }
    }
  }
  return notes;
}

// ---------------------------------------------------------------- Building a squad

/** A cheap replacement for an empty place (off-season, older saves): fits the place by construction. */
export function replacementPlayer(state: GameState, clubId: ClubId, slot: SquadSlot, rng: Rng, opts: { startRound?: number; joinedSeason?: number } = {}): Player {
  const { season, round } = state.calendar;
  const level = rng.int(48, 56);
  const age = rng.int(22, 30);
  const p = createPlayer(
    {
      id: nextId(state, 'p'),
      clubId,
      primary: isPitchingSlot(slot) ? 'P' : slot,
      age,
      level,
      upside: rng.int(0, 6),
      role: slot === 'starter' ? 'starter' : 'reserve',
      salary: Math.max(10_000, Math.round((marketSalary(level, age) * 0.7) / 1000) * 1000),
      seasonsLeft: 1,
      startRound: opts.startRound ?? absoluteRound(season, round) + 1,
      joinedSeason: opts.joinedSeason ?? season,
      scoutingLevel: state.clubs[clubId].facilities?.scouting ?? 1,
      bio: 'Signed as a low-cost replacement.',
    },
    rng,
  );
  // A pitcher made for a place has the stamina for it: a starter lasts, a reliever is short.
  if (p.isPitcher) {
    if (!fitsSlot(p, slot)) p.ratings.stamina = slot === 'starter' ? 66 : 40;
    p.pitcherRole = slot === 'starter' ? 'SP' : 'RP';
  }
  state.players[p.id] = p;
  return p;
}

/** Fills every empty place with a replacement; returns the newcomers. */
export function fillEmptySlots(state: GameState, clubId: ClubId, rng: Rng, opts: { startRound?: number; joinedSeason?: number } = {}): Player[] {
  const added: Player[] = [];
  for (const slot of SQUAD_SLOTS) {
    if (playerAt(state, clubId, slot)) continue;
    const p = replacementPlayer(state, clubId, slot, rng, opts);
    putInSlot(state, clubId, slot, p.id);
    added.push(p);
  }
  return added;
}

/**
 * Turns a club's players into the fixed squad: the strongest nine hitters in
 * their best places and the strongest starter and four relievers (current
 * places are kept where they are valid). Everyone else is dropped (new game),
 * listed for transfer (the user's club) or released (AI clubs); empty places
 * get replacements.
 */
export function buildSquad(state: GameState, clubId: ClubId, rng: Rng, overflow: 'drop' | 'list' | 'release') {
  const club = state.clubs[clubId];
  const before = [...club.roster];
  // A valid saved lineup keeps its order and places; otherwise the strongest nine are placed.
  const saved = validateBatters(state, clubId, club.lineup).every((i) => i.severity !== 'error');
  const lineup = saved ? club.lineup : autoLineup(state, clubId);
  const pitching = bestPitching(state, clubId);
  club.lineup = { battingOrder: lineup.battingOrder, pitcherId: pitching.starterId };
  club.pitchingPlan = { ...club.pitchingPlan, relieverId: null, rest: [], bullpen: { ...emptyBullpen(), ...pitching.bullpen } };
  // Pitchers out of their kind of place (a short club) are not kept there.
  for (const slot of PITCHING_SLOTS) {
    const id = playerAt(state, clubId, slot);
    if (id && !fitsSlot(state.players[id], slot)) putInSlot(state, clubId, slot, null);
  }
  syncRoster(state, clubId);
  fillEmptySlots(state, clubId, rng);
  const kept = new Set(club.roster);
  for (const id of before) {
    if (kept.has(id)) continue;
    if (overflow === 'drop') delete state.players[id];
    else if (overflow === 'list') listForTransfer(state, clubId, id);
    else release(state, id);
  }
}
