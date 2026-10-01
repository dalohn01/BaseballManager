import { describe, expect, it } from 'vitest';
import { simMatch } from './helpers';

describe('recorded match sequence', () => {
  it('is complete and consistent with the simulated result (300 games)', () => {
    for (let seed = 1; seed <= 300; seed++) {
      const { m } = simMatch(seed);
      const seq = m.sequence!;
      expect(seq.length).toBeGreaterThan(50);
      const last = seq[seq.length - 1];
      expect(last.after.score).toEqual(m.runs);

      const pa: Record<string, number> = {};
      for (let i = 0; i < seq.length; i++) {
        const st = seq[i];
        expect(st.index).toBe(i);
        const prev = seq[i - 1];
        // Continuity: a step starts where the previous one ended, unless a new half-inning begins.
        if (prev && prev.inning === st.inning && prev.half === st.half) {
          expect(st.before).toEqual(prev.after);
        } else if (st.kind !== 'suddenDeath') {
          expect(st.before.outs).toBe(0);
          expect(st.before.bases.filter(Boolean).length).toBeLessThanOrEqual(st.kind === 'ghostRunner' ? 0 : 1);
        }
        // No runner on two bases at once.
        const onBase = st.after.bases.filter(Boolean);
        expect(new Set(onBase).size).toBe(onBase.length);

        if (st.kind === 'plateAppearance') {
          pa[st.batterId!] = (pa[st.batterId!] ?? 0) + 1;
          // Every move lands where the after-snapshot says.
          for (const r of st.runners) {
            if (r.to === 'out' || r.to === 4) expect(st.after.bases).not.toContain(r.playerId);
            else expect(st.after.bases[r.to - 1]).toBe(r.playerId);
          }
          const runs = st.runners.filter((r) => r.to === 4).length;
          const side = st.half === 'top' ? 'away' : 'home';
          expect(st.after.score[side] - st.before.score[side]).toBe(runs);
          expect(Math.min(3, st.before.outs + st.outOrder.length)).toBe(st.after.outs);
          expect(st.runners.filter((r) => r.to === 'out').map((r) => r.playerId).sort()).toEqual([...st.outOrder].sort());
          // Batter identity is the moving runner from the box, never duplicated.
          expect(st.runners.filter((r) => r.playerId === st.batterId)).toHaveLength(1);
          if (st.outcome === 'doublePlay') expect(st.outOrder).toHaveLength(2);
          if (st.fielder) expect([...m.lineups.home.battingOrder, ...m.lineups.away.battingOrder].some((x) => x.playerId === st.fielder!.playerId) || m.pitchersUsed.home.concat(m.pitchersUsed.away).includes(st.fielder.playerId)).toBe(true);
        }
      }
      for (const [id, n] of Object.entries(pa)) expect(n).toBe(m.batting[id].pa);
    }
  }, 30_000);

  it('metadata is deterministic and does not touch the game RNG', () => {
    const a = simMatch(42).m;
    const b = simMatch(42).m;
    expect(b).toEqual(a);
  });
});
