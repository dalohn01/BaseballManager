import { describe, expect, it } from 'vitest';
import { matchRecap, pitcherDecisions } from '../src/presentation/decisions';
import { simMatch } from './helpers';

describe('pitchers of record', () => {
  it('win and loss go to pitchers of opposite teams who actually pitched; a save only to a finishing reliever', () => {
    let saves = 0;
    let decided = 0;
    for (let seed = 1; seed <= 150; seed++) {
      const { m } = simMatch(seed);
      const d = pitcherDecisions(m);
      if (m.decidedBy === 'suddenDeath' && m.runs.home === m.runs.away) continue;
      const w = m.runs.home > m.runs.away ? 'home' : 'away';
      const l = w === 'home' ? 'away' : 'home';
      expect(d.winnerId).toBe(w === 'home' ? m.homeId : m.awayId);
      if (!d.win) continue;
      decided++;
      expect(m.pitchersUsed[w]).toContain(d.win);
      expect(m.pitchersUsed[l]).toContain(d.loss);
      if (d.save) {
        saves++;
        expect(d.save).not.toBe(d.win);
        expect(d.save).toBe(m.pitchersUsed[w].at(-1));
        expect(d.save).not.toBe(m.lineups[w].pitcherId);
      }
      // A starter only gets the win after five innings.
      if (d.win === m.lineups[w].pitcherId) expect(m.pitching[d.win].outs).toBeGreaterThanOrEqual(15);
      expect(matchRecap(m, { [m.homeId]: 'Home', [m.awayId]: 'Away' })).toMatch(/\.$/);
    }
    expect(decided).toBeGreaterThan(120);
    expect(saves).toBeGreaterThan(0);
  });

  it('older matches without a sequence have no pitchers of record', () => {
    const { m } = simMatch(3);
    const d = pitcherDecisions({ ...m, sequence: undefined });
    expect([d.win, d.loss, d.save]).toEqual([null, null, null]);
  });
});
