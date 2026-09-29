import { describe, expect, it } from 'vitest';
import { BALANCE } from '../src/balance/config';
import type { MatchResult } from '../src/domain/types';
import { inningsPitched, pitcherScore, presentedBox, standouts } from '../src/presentation/boxscore';
import { buildCommentary } from '../src/presentation/commentary';
import { simMatch } from './helpers';

const stepsFor = (m: MatchResult, s: ReturnType<typeof simMatch>['s']) =>
  buildCommentary({ match: m, name: (id) => s.players[id]?.lastName ?? id, clubName: (id) => s.clubs[id]?.name ?? id });

describe('match summary: presented box score', () => {
  it('team runs follow the scoreboard at every step; totals end on the engine box score and never run ahead', () => {
    for (let seed = 1; seed <= 25; seed++) {
      const { m, s } = simMatch(seed);
      const steps = stepsFor(m, s);
      let prev: ReturnType<typeof presentedBox> | null = null;
      for (let k = 0; k < steps.length; k++) {
        const box = presentedBox(m, steps, k);
        for (const [side, id] of [['home', m.homeId], ['away', m.awayId]] as const) {
          expect(box.teams[id].r).toBe(steps[k].state.score[side]);
          if (prev) for (const key of ['h', 'hr', 'bb', 'k'] as const) expect(box.teams[id][key]).toBeGreaterThanOrEqual(prev.teams[id][key]);
          // A play that is still being told has not been counted yet.
          if (!steps[k].playDone && prev) expect(box.teams[id].h).toBe(prev.teams[id].h);
        }
        prev = box;
      }
      const end = presentedBox(m, steps, steps.length - 1);
      for (const [side, id] of [['home', m.homeId], ['away', m.awayId]] as const) {
        const lines = m.lineups[side].battingOrder.map((x) => m.batting[x.playerId]);
        expect(end.teams[id].h).toBe(m.hits[side]);
        expect(end.teams[id].hr).toBe(lines.reduce((a, l) => a + l.hr, 0));
        expect(end.teams[id].bb).toBe(lines.reduce((a, l) => a + l.bb, 0));
        expect(end.teams[id].k).toBe(lines.reduce((a, l) => a + l.so, 0));
        expect(end.teams[id].r).toBe(m.runs[side]);
        // Every pitcher who appeared is listed (relievers too), with the engine's line.
        expect(end.pitching[id].map((p) => p.id).sort()).toEqual([...m.pitchersUsed[side]].sort());
        for (const p of end.pitching[id]) {
          const e = m.pitching[p.id];
          expect([p.outs, p.h, p.r, p.bb, p.k]).toEqual([e.outs, e.h, e.r, e.bb, e.so]);
        }
      }
    }
  });

  it('innings pitched use baseball notation from outs', () => {
    expect(inningsPitched(0)).toBe('0.0');
    expect(inningsPitched(11)).toBe('3.2');
    expect(inningsPitched(18)).toBe('6.0');
  });
});

describe('standouts', () => {
  it('at most two, only from this game, nobody at the start, changes only after a finished play', () => {
    for (let seed = 1; seed <= 15; seed++) {
      const { m, s } = simMatch(seed);
      const steps = stepsFor(m, s);
      expect(standouts(m, steps, 0)).toEqual([]);
      let prev: string[] = [];
      for (let k = 0; k < steps.length; k++) {
        const now = standouts(m, steps, k).map((x) => x.id);
        expect(now.length).toBeLessThanOrEqual(BALANCE.match.standouts.slots);
        if (!steps[k].playDone && k > 0) expect(now).toEqual(prev);
        prev = now;
      }
      for (const x of standouts(m, steps, steps.length - 1)) {
        expect(x.score).toBeGreaterThanOrEqual(BALANCE.match.standouts.minScore);
        expect(x.line.length).toBeGreaterThan(0);
      }
    }
  });

  it('a single scoreless out never qualifies a pitcher', () => {
    expect(pitcherScore({ id: 'x', clubId: 'c', bf: 1, outs: 1, h: 0, r: 0, bb: 0, k: 1, hr: 0 })).toBe(-Infinity);
    expect(pitcherScore({ id: 'x', clubId: 'c', bf: 20, outs: 18, h: 3, r: 0, bb: 1, k: 6, hr: 0 })).toBeGreaterThan(BALANCE.match.standouts.minScore);
  });

  it('the list is stable: a pick is only replaced by a clearly better performance', () => {
    let swaps = 0;
    let changes = 0;
    for (let seed = 1; seed <= 15; seed++) {
      const { m, s } = simMatch(seed);
      const steps = stepsFor(m, s);
      let prev: string[] = [];
      for (let k = 0; k < steps.length; k++) {
        const now = standouts(m, steps, k).map((x) => x.id).sort();
        if (prev.length === BALANCE.match.standouts.slots && now.length === prev.length && now.join() !== prev.join()) swaps++;
        if (now.join() !== prev.join()) changes++;
        prev = now;
      }
    }
    // Picks fill up early; swaps between two full lists are rare over a game.
    expect(swaps / 15).toBeLessThan(4);
    expect(changes).toBeGreaterThan(0);
  });
});
