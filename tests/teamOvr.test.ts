import { describe, expect, it } from 'vitest';
import { migrate } from '../src/application/migrations';
import { BALANCE } from '../src/balance/config';
import type { GameState } from '../src/domain/state';
import { combineOvr, computeTeamOvr, ovrDisplay, ovrProfile, teamOvr } from '../src/domain/teamOvr';
import type { Player } from '../src/domain/types';
import { computeStandings } from '../src/simulation/standings';
import { newGame, playSeason } from './helpers';

const roster = (s: GameState, id = s.userClubId) => s.clubs[id].roster.map((pid) => s.players[pid]);
const fresh = (s: GameState) => structuredClone(s);

describe('Team OVR', () => {
  it('1. every club gets the same calculation: three areas and an overall on 0–100', () => {
    const s = newGame(201);
    for (const id of s.clubOrder) {
      const o = teamOvr(s, id)!;
      expect(o).not.toBeNull();
      for (const v of [o.batting, o.pitching, o.defense, o.overall]) {
        expect(Number.isFinite(v)).toBe(true);
        expect(v).toBeGreaterThan(0);
        expect(v).toBeLessThan(100);
      }
      expect(o.lineup).toHaveLength(9);
      expect(new Set(o.lineup.map((x) => x.playerId)).size).toBe(9);
      expect(o.staff.reduce((a, x) => a + x.weight, 0)).toBeCloseTo(1, 10);
      expect(o.overall).toBeCloseTo(combineOvr(o.batting, o.pitching, o.defense), 10);
    }
  });

  it('2. 76 / 68 / 73 gives 72.2, shown as 72; precision is kept until display', () => {
    expect(combineOvr(76, 68, 73)).toBeCloseTo(72.2, 10);
    expect(ovrDisplay(combineOvr(76, 68, 73))).toBe(72);
    expect(ovrDisplay(-3)).toBe(0);
    expect(ovrDisplay(104)).toBe(100);
  });

  it('3. a new bench player without a regular role does not change it', () => {
    const s = newGame(202);
    const before = teamOvr(s, s.userClubId)!;
    const t = fresh(s);
    const base = roster(t)[0];
    const rookie: Player = { ...structuredClone(base), id: 'pX', role: 'prospect', ratings: { contact: 30, power: 30, speed: 30, fielding: 30, pitching: 10 } };
    t.players[rookie.id] = rookie;
    t.clubs[t.userClubId].roster.push(rookie.id);
    const after = teamOvr(t, t.userClubId)!;
    expect(after.overall).toBe(before.overall);
  });

  it('4. improving a regular never lowers his area', () => {
    const s = newGame(203);
    const before = teamOvr(s, s.userClubId)!;
    const t = fresh(s);
    const hitter = t.players[before.lineup[0].playerId];
    hitter.ratings.contact += 5;
    hitter.ratings.fielding += 5;
    const ace = t.players[before.staff[0].playerId];
    ace.ratings.pitching += 5;
    const after = teamOvr(t, t.userClubId)!;
    expect(after.batting).toBeGreaterThan(before.batting);
    expect(after.defense).toBeGreaterThanOrEqual(before.defense);
    expect(after.pitching).toBeGreaterThan(before.pitching);
  });

  it('5. happiness, fitness, motivation and today’s starter do not change it', () => {
    const s = newGame(204);
    const before = teamOvr(s, s.userClubId)!.overall;
    const t = fresh(s);
    for (const p of roster(t)) {
      p.fitness = 40;
      p.satisfaction = 10;
    }
    const pitchers = roster(t).filter((p) => p.isPitcher);
    t.clubs[t.userClubId].lineup.pitcherId = pitchers[pitchers.length - 1].id;
    t.actions.motivated = roster(t).map((p) => p.id);
    expect(teamOvr(t, t.userClubId)!.overall).toBe(before);
  });

  it('6. a regular leaving is replaced by the same rules and the value updates', () => {
    const s = newGame(205);
    const before = teamOvr(s, s.userClubId)!;
    const t = fresh(s);
    const leaving = before.lineup.find((x) => x.position === 'SS')!.playerId;
    t.clubs[t.userClubId].roster = t.clubs[t.userClubId].roster.filter((id) => id !== leaving);
    const after = teamOvr(t, t.userClubId)!;
    expect(after.lineup.some((x) => x.playerId === leaving)).toBe(false);
    expect(after.lineup.find((x) => x.position === 'SS')).toBeTruthy();
    expect(after.overall).not.toBe(before.overall);
  });

  it('7. an incomplete roster is "no value", never NaN or an inflated average', () => {
    const s = newGame(206);
    const hitters = roster(s).filter((p) => !p.isPitcher);
    const pitchers = roster(s).filter((p) => p.isPitcher);
    expect(computeTeamOvr([...hitters.slice(0, 8), ...pitchers])).toBeNull();
    expect(computeTeamOvr(hitters)).toBeNull();
    expect(computeTeamOvr([])).toBeNull();
    // One pitcher only: he takes every inning (weights still sum to 1).
    const one = computeTeamOvr([...hitters, pitchers[0]])!;
    expect(one.staff).toEqual([{ playerId: pitchers[0].id, weight: 1, role: 'rotation' }]);
  });

  it('8. the same save gives the same values; other clubs improving does not move our number', () => {
    const s = newGame(207);
    const loaded = migrate(JSON.parse(JSON.stringify(s)));
    for (const id of s.clubOrder) expect(teamOvr(loaded, id)!.overall).toBe(teamOvr(s, id)!.overall);
    const t = fresh(s);
    for (const id of t.clubOrder.filter((c) => c !== t.userClubId)) for (const p of roster(t, id)) p.ratings.contact = 95;
    expect(teamOvr(t, t.userClubId)!.overall).toBe(teamOvr(s, s.userClubId)!.overall);
  });

  it('9. the profile compares the team with itself', () => {
    const o = (b: number, p: number, d: number) => ({ batting: b, pitching: p, defense: d, overall: combineOvr(b, p, d), lineup: [], staff: [] });
    expect(ovrProfile(o(70, 68, 72))).toBe('Balanced team');
    expect(ovrProfile(o(80, 70, 74))).toBe('Batting-led team · Pitching is the relative weak spot');
    expect(BALANCE.teamOvr.weights.batting + BALANCE.teamOvr.weights.pitching + BALANCE.teamOvr.weights.defense).toBeCloseTo(1, 10);
  });

  it('sanity against the simulator: over whole seasons, higher OVR goes with more wins (not every game)', () => {
    const pairs: { ovr: number; winPct: number }[] = [];
    for (const seed of [211, 212, 213]) {
      const s0 = newGame(seed);
      const ovr = new Map(s0.clubOrder.map((id) => [id, teamOvr(s0, id)!.overall]));
      const s = playSeason(s0, seed);
      for (const r of computeStandings(s, 1)) pairs.push({ ovr: ovr.get(r.clubId)!, winPct: r.wins / Math.max(1, r.played) });
    }
    const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    const mx = mean(pairs.map((p) => p.ovr));
    const my = mean(pairs.map((p) => p.winPct));
    const cov = mean(pairs.map((p) => (p.ovr - mx) * (p.winPct - my)));
    expect(cov).toBeGreaterThan(0);
  }, 120_000);
});
