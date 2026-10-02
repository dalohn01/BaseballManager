import { describe, expect, it } from 'vitest';
import { migrate } from '../src/application/migrations';
import { BALANCE } from '../src/balance/config';
import { autoLineup } from '../src/domain/lineup';
import { pitcherPosition, splitPitching } from '../src/domain/pitching';
import { overall } from '../src/domain/ratings';
import { createRng } from '../src/domain/rng';
import { SCHEMA_VERSION } from '../src/domain/state';
import { buildSimTeam, simulateMatch, tiresAfterBatters } from '../src/simulation/match';
import { applyProgress } from '../src/simulation/training';
import { newGame } from './helpers';

describe('pitcher values: velocity, control, stamina, fielding', () => {
  it('every pitcher has four values; pitching is their derived quality; the rotation is SP and the bullpen mostly RP', () => {
    const s = newGame(601);
    for (const id of s.clubOrder) {
      const staff = s.clubs[id].staff!;
      for (const pid of s.clubs[id].roster) {
        const p = s.players[pid];
        if (!p.isPitcher) continue;
        expect(p.ratings.pitching).toBe(Math.round((p.ratings.velocity + p.ratings.control) / 2));
        expect(p.ratings.stamina).toBeGreaterThan(0);
      }
      for (const pid of staff.rotation) expect(pitcherPosition(s.players[pid]), `${id} ${pid}`).toBe('SP');
      const pen = [staff.closer, staff.setup, staff.long].filter(Boolean).map((x) => s.players[x!]);
      expect(pen.filter((p) => pitcherPosition(p) === 'RP').length).toBeGreaterThanOrEqual(2);
    }
  });

  it('splitting keeps the old pitching level as the average, and stamina fits the role', () => {
    for (let i = 0; i < 50; i++) {
      const sp = splitPitching(`x${i}`, 60, true);
      const rp = splitPitching(`x${i}`, 60, false);
      expect(Math.abs((sp.velocity + sp.control) / 2 - 60)).toBeLessThanOrEqual(0.5);
      expect(sp.stamina).toBeGreaterThanOrEqual(BALANCE.pitching.starterStaminaFrom);
      expect(rp.stamina).toBeLessThan(BALANCE.pitching.starterStaminaFrom);
    }
  });

  it('stamina decides when a pitcher tires; a starter is rated on stamina too', () => {
    expect(tiresAfterBatters('balanced', 70)).toBe(20);
    expect(tiresAfterBatters('balanced', 40)).toBe(14);
    expect(tiresAfterBatters('attack', 70)).toBe(23);
    const s = structuredClone(newGame(602));
    const p = s.players[s.clubs.hfx.staff!.rotation[0]];
    const before = overall(p);
    p.ratings.stamina += 10;
    expect(overall(p)).toBeGreaterThan(before);
  });

  it('velocity brings strikeouts, control prevents walks (same average quality)', () => {
    const rate = (velocity: number, control: number) => {
      let k = 0;
      let bb = 0;
      let bf = 0;
      for (let seed = 1; seed <= 120; seed++) {
        const s = structuredClone(newGame(603));
        const [h, a] = [s.clubOrder[0], s.clubOrder[1]];
        const lineup = autoLineup(s, h);
        const sp = s.players[lineup.pitcherId];
        sp.ratings.velocity = velocity;
        sp.ratings.control = control;
        sp.ratings.pitching = Math.round((velocity + control) / 2);
        const home = buildSimTeam(s, h, lineup);
        const m = simulateMatch({ id: `m${seed}`, season: 1, round: 1, home, away: buildSimTeam(s, a, autoLineup(s, a)), rng: createRng(seed) });
        const line = m.pitching[sp.id];
        k += line.so;
        bb += line.bb;
        bf += line.battersFaced;
      }
      return { k: k / bf, bb: bb / bf };
    };
    const power = rate(80, 50);
    const finesse = rate(50, 80);
    expect(power.k).toBeGreaterThan(finesse.k + 0.03);
    expect(finesse.bb).toBeLessThan(power.bb - 0.02);
  }, 60_000);

  it('training velocity or control keeps the derived pitching in line', () => {
    const s = structuredClone(newGame(604));
    const p = s.players[s.clubs.hfx.staff!.rotation[0]];
    p.progress.velocity = 99;
    applyProgress(p, 'velocity', 40, 1, createRng(1));
    expect(p.ratings.pitching).toBe(Math.round((p.ratings.velocity + p.ratings.control) / 2));
  });
});

describe('migration to four pitcher values (v13)', () => {
  it('splits pitching around the old value and gives the rotation starter stamina', () => {
    const v12 = JSON.parse(JSON.stringify(newGame(605)));
    v12.schemaVersion = 12;
    const old: Record<string, number> = {};
    for (const p of Object.values(v12.players) as { id: string; isPitcher: boolean; ratings: Record<string, number>; progress: Record<string, number> }[]) {
      for (const k of ['velocity', 'control', 'stamina']) {
        delete p.ratings[k];
        delete p.progress[k];
      }
      old[p.id] = p.ratings.pitching;
    }
    const m = migrate(v12);
    expect(m.schemaVersion).toBe(SCHEMA_VERSION);
    for (const p of Object.values(m.players)) {
      expect(p.ratings.velocity).toBeDefined();
      if (!p.isPitcher) continue;
      expect(Math.abs((p.ratings.velocity + p.ratings.control) / 2 - old[p.id])).toBeLessThanOrEqual(0.5);
    }
    for (const id of m.clubOrder) for (const pid of m.clubs[id].staff!.rotation) expect(pitcherPosition(m.players[pid])).toBe('SP');
    expect(JSON.stringify(migrate(JSON.parse(JSON.stringify(v12))).players)).toBe(JSON.stringify(m.players));
  });
});
