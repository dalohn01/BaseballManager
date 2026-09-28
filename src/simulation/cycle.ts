import { BALANCE } from '../balance/config';
import type { ActionState, CycleRecord, CycleState, GameState, GroupChange } from '../domain/state';
import { clubPlayers, userClub } from '../domain/state';

/*
 * The match cycle: club event → league game → post-match media → close.
 * Closing a cycle happens exactly once per league round (guarded by its id):
 * board, fans and every player drift toward 75, then Influence income is
 * credited from the updated values. One-off effects (events, the match) are
 * applied when they happen and are never re-applied here.
 */

export const cycleId = (season: number, round: number) => `c-${season}-${round}`;

export const defaultCycle = (): CycleState => ({
  lastClosedId: null,
  matchesPlayed: 0,
  log: [],
  unseen: null,
  boardChecks: [],
  lowStreak: { owners: 0, fans: 0, players: {} },
});

export const defaultActions = (): ActionState => ({
  lastUse: {},
  programs: {},
  motivated: [],
  fundraiser: null,
  earmarked: 0,
  boardFunding: { season: 0, granted: 0 },
  log: [],
});

/** One group's Influence contribution: continuous and increasing (20 at 0, 40 at 75, 50 at 100). */
export function contribution(s: number): number {
  const c = BALANCE.influence.contribution;
  return c.base + s * c.linear + s * s * c.quadratic;
}

/** Recovery toward neutral: larger the further a value is from 75. */
export function drift(value: number): number {
  const sat = BALANCE.satisfaction;
  return (sat.neutral - value) * sat.driftRate;
}

const clamp100 = (v: number) => Math.max(0, Math.min(100, v));

/** Mean happiness of the user's current squad (75 as technical fallback for an empty squad). */
export function squadMean(state: GameState): number {
  const players = clubPlayers(state, state.userClubId);
  return players.length ? players.reduce((a, p) => a + p.satisfaction, 0) / players.length : BALANCE.satisfaction.neutral;
}

/** Income from the three groups (equal weight); the squad mean counts as one group. */
export function incomeFor(board: number, fans: number, players: number) {
  const contributions = { board: contribution(board), fans: contribution(fans), players: contribution(players) };
  return { contributions, income: contributions.board + contributions.fans + contributions.players };
}

/** What a credit of `income` actually adds: never above the cap, and never reduces a larger migrated balance. */
export function creditable(balance: number, income: number): number {
  const cap = BALANCE.influence.cap;
  return balance >= cap ? 0 : Math.min(income, cap - balance);
}

/** Preliminary forecast for the next close from current values (the next match and media can still change them). */
export function forecast(state: GameState) {
  const c = userClub(state);
  const board = clamp100(c.ownerConfidence + drift(c.ownerConfidence));
  const fans = clamp100(c.fanSupport + drift(c.fanSupport));
  const players = clubPlayers(state, state.userClubId);
  const mean = players.length ? players.reduce((a, p) => a + clamp100(p.satisfaction + drift(p.satisfaction)), 0) / players.length : BALANCE.satisfaction.neutral;
  const inc = incomeFor(board, fans, mean);
  return { board, fans, players: mean, ...inc, credited: creditable(state.influence, inc.income) };
}

/**
 * Closes the cycle for a league round. Returns null (and changes nothing) if
 * this round's cycle was already closed — reloads, replays and retries can
 * never add a second drift or a second income.
 */
export function closeCycle(state: GameState, season: number, round: number): CycleRecord | null {
  const id = cycleId(season, round);
  if (state.cycle.lastClosedId === id || state.cycle.log.some((r) => r.id === id)) return null;
  const c = userClub(state);
  const step = (v: number): GroupChange => {
    const d = drift(v);
    return { before: v, drift: d, after: clamp100(v + d) };
  };
  const board = step(c.ownerConfidence);
  const fans = step(c.fanSupport);
  c.ownerConfidence = board.after;
  c.fanSupport = fans.after;
  // Every player drifts individually; the squad mean is derived afterwards, not drifted again.
  const meanBefore = squadMean(state);
  for (const p of clubPlayers(state, state.userClubId)) p.satisfaction = clamp100(p.satisfaction + drift(p.satisfaction));
  const meanAfter = squadMean(state);
  const players: GroupChange = { before: meanBefore, drift: meanAfter - meanBefore, after: meanAfter };

  const { contributions, income } = incomeFor(board.after, fans.after, meanAfter);
  const credited = creditable(state.influence, income);
  state.influence += credited;

  // Serious events need a problem that has lasted: count closes in a row below the threshold.
  const low = BALANCE.lowMood;
  const streak = state.cycle.lowStreak;
  streak.owners = c.ownerConfidence < low.ultimatumBelow ? streak.owners + 1 : 0;
  streak.fans = c.fanSupport < low.protestBelow ? streak.fans + 1 : 0;
  const next: Record<string, number> = {};
  for (const p of clubPlayers(state, state.userClubId)) next[p.id] = p.satisfaction < low.tradeRequestBelow ? (streak.players[p.id] ?? 0) + 1 : 0;
  streak.players = next;

  // Individual programs run until the league game after they started.
  for (const [pid, prog] of Object.entries(state.actions.programs)) if (prog.until <= state.cycle.matchesPlayed) delete state.actions.programs[pid];

  const record: CycleRecord = { id, season, round, board, fans, players, contributions, income, credited, balanceAfter: state.influence };
  state.cycle.lastClosedId = id;
  state.cycle.unseen = id;
  state.cycle.log.push(record);
  if (state.cycle.log.length > 40) state.cycle.log.splice(0, state.cycle.log.length - 40);
  return record;
}

/** Season-end Influence rewards use the same cap rule as cycle income. */
export function creditInfluence(state: GameState, amount: number): number {
  const credited = creditable(state.influence, amount);
  state.influence += credited;
  return credited;
}
