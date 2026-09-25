import { describe, expect, it } from 'vitest';
import { autoLineup } from '../src/domain/lineup';
import { createRng } from '../src/domain/rng';
import { buildSimTeam, simulateMatch } from '../src/simulation/match';
import { newGame } from './helpers';

function sim(seed: number, tweak?: (s: ReturnType<typeof newGame>) => void) {
  const s = newGame(5);
  tweak?.(s);
  const [h, a] = [s.clubOrder[0], s.clubOrder[1]];
  const home = buildSimTeam(s, h, autoLineup(s, h));
  const away = buildSimTeam(s, a, autoLineup(s, a));
  return simulateMatch({ id: `m${seed}`, season: 1, round: 1, home, away, rng: createRng(seed) });
}

describe('match simulation', () => {
  it('produces valid, self-consistent results', () => {
    let totalRuns = 0;
    for (let seed = 1; seed <= 400; seed++) {
      const m = sim(seed);
      const sum = (xs: (number | null)[]) => xs.reduce<number>((a, b) => a + (b ?? 0), 0);
      expect(sum(m.linescore.home)).toBe(m.runs.home);
      expect(sum(m.linescore.away)).toBe(m.runs.away);
      expect(m.runs.home).not.toBe(m.runs.away);
      expect(m.innings).toBeGreaterThanOrEqual(9);
      expect(m.linescore.away.length).toBe(m.linescore.home.length);
      // Home never bats in the last inning when already ahead.
      if (m.linescore.home[m.linescore.home.length - 1] === null) expect(m.runs.home).toBeGreaterThan(m.runs.away);
      // Walk-offs end as soon as home leads.
      if (m.walkOff) expect(m.runs.home).toBeGreaterThan(m.runs.away);
      // Box score hits equal team hits.
      const homeHits = m.lineups.home.battingOrder.reduce((a, s) => a + m.batting[s.playerId].h, 0);
      expect(homeHits).toBe(m.hits.home);
      // Highlights only mention runs that exist.
      const hlRuns = m.plays.filter((p) => p.kind !== 'suddenDeath').reduce((a, p) => a + p.runs, 0);
      expect(hlRuns).toBeLessThanOrEqual(m.runs.home + m.runs.away);
      totalRuns += m.runs.home + m.runs.away;
    }
    const avg = totalRuns / 400 / 2;
    expect(avg).toBeGreaterThan(2.5);
    expect(avg).toBeLessThan(7);
  });

  it('fatigue and ability measurably change outcomes over many games', () => {
    const wins = (tweak?: (s: ReturnType<typeof newGame>) => void) => {
      let w = 0;
      for (let seed = 1; seed <= 400; seed++) {
        const m = sim(seed, tweak);
        if (m.runs.home > m.runs.away) w++;
      }
      return w;
    };
    const base = wins();
    const exhausted = wins((s) => {
      for (const id of s.clubs[s.clubOrder[0]].roster) s.players[id].fatigue = 95;
    });
    const boosted = wins((s) => {
      for (const id of s.clubs[s.clubOrder[0]].roster) {
        const p = s.players[id];
        p.ratings.contact += 15;
        p.ratings.pitching += 15;
      }
    });
    expect(exhausted).toBeLessThan(base - 20);
    expect(boosted).toBeGreaterThan(base + 20);
  });
});
