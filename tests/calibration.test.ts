import { describe, expect, it } from 'vitest';
import { autoLineup } from '../src/domain/lineup';
import { createRng } from '../src/domain/rng';
import { buildSimTeam, simulateMatch } from '../src/simulation/match';
import { newGame } from './helpers';

/**
 * League-wide batting profile from many simulated games between the real
 * league clubs (auto lineups, Balanced tactics), per team and game.
 */
export function leagueProfile(seeds: number, gamesPerPair: number) {
  const t = { games: 0, pa: 0, ab: 0, h: 0, d: 0, tr: 0, hr: 0, r: 0, bb: 0, so: 0, sb: 0, cs: 0, sf: 0, extra: 0 };
  let id = 0;
  for (let seed = 1; seed <= seeds; seed++) {
    const s = newGame(seed);
    const teams = Object.fromEntries(s.clubOrder.map((c) => [c, buildSimTeam(s, c, autoLineup(s, c))]));
    for (const h of s.clubOrder)
      for (const a of s.clubOrder) {
        if (h === a) continue;
        for (let k = 0; k < gamesPerPair; k++) {
          const m = simulateMatch({ id: `cal${id}`, season: 1, round: 1, home: teams[h], away: teams[a], rng: createRng(id * 7919 + 13) });
          id++;
          t.games++;
          if (m.innings > 9) t.extra++;
          for (const l of Object.values(m.batting)) {
            t.pa += l.pa;
            t.ab += l.ab;
            t.h += l.h;
            t.d += l.doubles;
            t.tr += l.triples;
            t.hr += l.hr;
            t.r += l.r;
            t.bb += l.bb;
            t.so += l.so;
            t.sb += l.sb;
          }
          for (const st of m.sequence!) {
            if (st.kind === 'caughtStealing') t.cs++;
            if (st.outcome === 'sacFly') t.sf++;
          }
        }
      }
  }
  const g = t.games * 2;
  const tb = t.h - t.d - t.tr - t.hr + 2 * t.d + 3 * t.tr + 4 * t.hr;
  const obp = (t.h + t.bb) / (t.ab + t.bb + t.sf);
  const slg = tb / t.ab;
  return {
    games: t.games,
    runs: t.r / g,
    hits: t.h / g,
    avg: t.h / t.ab,
    obp,
    slg,
    ops: obp + slg,
    babip: (t.h - t.hr) / (t.ab - t.so - t.hr + t.sf),
    hr: t.hr / g,
    doubles: t.d / g,
    triples: t.tr / g,
    bb: t.bb / g,
    k: t.so / g,
    kPct: t.so / t.pa,
    bbPct: t.bb / t.pa,
    sb: t.sb / g,
    cs: t.cs / g,
    extraShare: t.extra / t.games,
  };
}

/*
 * Targets: MLB league averages (recent seasons, per team and game), with room
 * for a small league and simulation noise. The engine is tuned so the game
 * reads like real baseball; this test warns if a change drifts away from it.
 */
describe('calibration against MLB league averages', () => {
  it('runs, hits, rates and the running game are in a realistic range', () => {
    const p = leagueProfile(6, 3);
    expect(p.runs).toBeGreaterThan(4.0);
    expect(p.runs).toBeLessThan(4.9);
    expect(p.avg).toBeGreaterThan(0.232);
    expect(p.avg).toBeLessThan(0.256);
    expect(p.obp).toBeGreaterThan(0.3);
    expect(p.obp).toBeLessThan(0.33);
    expect(p.slg).toBeGreaterThan(0.38);
    expect(p.slg).toBeLessThan(0.425);
    expect(p.babip).toBeGreaterThan(0.278);
    expect(p.babip).toBeLessThan(0.305);
    expect(p.hr).toBeGreaterThan(0.95);
    expect(p.hr).toBeLessThan(1.3);
    expect(p.kPct).toBeGreaterThan(0.2);
    expect(p.kPct).toBeLessThan(0.25);
    expect(p.bbPct).toBeGreaterThan(0.075);
    expect(p.bbPct).toBeLessThan(0.092);
    expect(p.sb).toBeGreaterThan(0.45);
    expect(p.sb).toBeLessThan(0.9);
  }, 120_000);
});
