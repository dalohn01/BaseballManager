import { BALANCE } from '../balance/config';
import type { Rng } from '../domain/rng';
import type { ClubId, ScheduledGame } from '../domain/types';

/**
 * Circle-method round robin repeated four times. Cycles alternate home/away so
 * every pair meets 4 times: 2 home, 2 away. Needs an even number of clubs.
 */
export function generateSchedule(clubIds: ClubId[], season: number, rng: Rng): ScheduledGame[] {
  const n = clubIds.length;
  if (n % 2 !== 0) throw new Error('Schedule needs an even number of clubs');
  const order = rng.shuffle(clubIds);
  const perCycle = n - 1;
  const cycles = Math.ceil(BALANCE.season.rounds / perCycle);
  const games: ScheduledGame[] = [];

  for (let cycle = 0; cycle < cycles; cycle++) {
    for (let r = 0; r < perCycle; r++) {
      const round = cycle * perCycle + r + 1;
      if (round > BALANCE.season.rounds) break;
      const rotated = [order[0], ...rotate(order.slice(1), r)];
      for (let i = 0; i < n / 2; i++) {
        const a = rotated[i];
        const b = rotated[n - 1 - i];
        // Alternate inside a cycle for variety, flip between cycles for balance.
        const flip = (cycle % 2 === 1) !== ((r + i) % 2 === 1);
        const [homeId, awayId] = flip ? [b, a] : [a, b];
        games.push({ id: `s${season}-r${round}-${homeId}-${awayId}`, season, round, homeId, awayId, result: null });
      }
    }
  }
  return games;
}

function rotate<T>(items: T[], k: number): T[] {
  const n = items.length;
  const s = ((k % n) + n) % n;
  return [...items.slice(n - s), ...items.slice(0, n - s)];
}
