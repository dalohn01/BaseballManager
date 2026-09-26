import { autoLineup } from '../src/domain/lineup';
import type { MatchResult } from '../src/domain/types';
import { buildSimTeam, simulateMatch } from '../src/simulation/match';
import { execute, optionBlocker, type Command } from '../src/application/engine';
import { createNewGame } from '../src/application/newGame';
import { createRng } from '../src/domain/rng';
import type { GameState } from '../src/domain/state';

export const T0 = 1_760_000_000_000;

export function newGame(seed = 42, mode: 'economy' | 'unlimited' = 'unlimited') {
  return createNewGame({ seed, now: T0, timeMode: mode });
}

export function run(state: GameState, cmd: Command, now = T0): GameState {
  const r = execute(state, cmd, now);
  if (!r.ok) throw new Error(`${cmd.type} failed: ${r.error}`);
  return r.state;
}

/** Resolves and acknowledges the current event with a (seeded) choice among available options. */
export function step(state: GameState, pickSeed: number, now = T0): GameState {
  const ev = state.currentEvent!;
  const rng = createRng(pickSeed);
  const available = ev.options.filter((o) => optionBlocker(state, ev, o, null, now) === null);
  const option = rng.pick(available);
  const boost = ev.boosts.find((b) => b.appliesTo.includes(option.id) && optionBlocker(state, ev, option, b, now) === null && rng.chance(0.3));
  let s = run(state, { type: 'resolveEvent', eventId: ev.id, revision: state.revision, optionId: option.id, boostId: boost?.id ?? null }, now);
  s = run(s, { type: 'acknowledgeEvent', eventId: ev.id }, now);
  return s;
}

/** Plays until the next season's preseason has begun (i.e. through draft, contracts and review). */
export function playSeason(state: GameState, pickSeed = 1): GameState {
  let s = state;
  const season = s.calendar.season;
  let i = 0;
  while (s.calendar.season === season && i < 500) {
    s = step(s, pickSeed * 1000 + i);
    i++;
  }
  if (i >= 500) throw new Error('Season did not finish');
  return s;
}

/** The last completed season's state just before the review closed it is not kept; use summaries instead. */
export const lastSummary = (s: GameState) => s.seasonSummaries[s.seasonSummaries.length - 1];

/** A fully simulated match between the first two clubs of a fresh game (deterministic by seed). */
export function simMatch(seed: number): { m: MatchResult; s: ReturnType<typeof newGame> } {
  const s = newGame(5);
  const [h, a] = [s.clubOrder[0], s.clubOrder[1]];
  const home = buildSimTeam(s, h, autoLineup(s, h));
  const away = buildSimTeam(s, a, autoLineup(s, a));
  return { m: simulateMatch({ id: `m${seed}`, season: 1, round: 1, home, away, rng: createRng(seed) }), s };
}