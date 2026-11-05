import { describe, expect, it } from 'vitest';
import { migrate } from '../src/application/migrations';
import { BALANCE } from '../src/balance/config';
import { battingGameValue, effectiveValue, formModifier, modifierTotal, moraleModifier, teamStatus, updateForm } from '../src/domain/effective';
import { autoLineup, validatePitchingPlan } from '../src/domain/lineup';
import { assignPitcher, draftFromClub, pitcherSlot, slotBlocker } from '../src/domain/lineupDraft';
import { playerAt } from '../src/domain/squad';
import { pitcherPosition } from '../src/domain/pitching';
import { overallAs, overall } from '../src/domain/ratings';
import { createRng } from '../src/domain/rng';
import { SCHEMA_VERSION } from '../src/domain/state';
import { bestPitching, RELIEF_SLOTS } from '../src/domain/todayPitching';
import { actionPreview } from '../src/simulation/actions';
import { buildSimTeam, simulateMatch } from '../src/simulation/match';
import { expectValidSquads, newGame, run, step } from './helpers';

const P = BALANCE.pitching;
const M = BALANCE.modifiers;

describe('no fitness between games', () => {
  it('everyone stays fully ready after games and days, and the same starter starts every game', () => {
    let s = newGame(402);
    const starter = s.clubs.hfx.lineup.pitcherId;
    for (let i = 0; i < 400 && s.cycle.matchesPlayed < 4; i++) s = step(s, 60 + i);
    for (const p of Object.values(s.players)) expect(p.fitness, p.id).toBe(100);
    const mine = Object.values(s.matches);
    expect(mine.length).toBeGreaterThanOrEqual(4);
    if (s.clubs.hfx.lineup.pitcherId === starter) {
      for (const m of mine) expect(m.lineups[m.homeId === 'hfx' ? 'home' : 'away'].pitcherId).toBe(starter);
    }
  }, 60_000);
});

describe('effective value', () => {
  it('is OVR plus Morale, Team and Form; pitchers by job', () => {
    const s = structuredClone(newGame(404));
    const p = s.players[s.clubs.hfx.roster.find((id) => s.players[id].isPitcher)!];
    p.satisfaction = 90;
    p.form = 1.2;
    const v = effectiveValue(s, p, 'SP');
    expect(v.ovr).toBe(overallAs(p, 'SP'));
    expect(v.mods.morale).toBe(2);
    expect(v.mods.form).toBe(1);
    expect(v.effective).toBe(v.ovr + modifierTotal(v.mods));
    expect(effectiveValue(s, p).ovr).toBe(overall(p));
  });

  it('morale and form come in steps of −2..+2', () => {
    const p = structuredClone(newGame(405).players.p1);
    for (const [sat, mod] of [[90, 2], [75, 1], [60, 0], [35, -1], [10, -2]] as const) {
      p.satisfaction = sat;
      expect(moraleModifier(p)).toBe(mod);
    }
    for (const [form, mod] of [[2.4, 2], [0.6, 1], [0.2, 0], [-0.7, -1], [-2.5, -2]] as const) {
      p.form = form;
      expect(formModifier(p)).toBe(mod);
    }
  });

});

describe('form', () => {
  it('good games heat a player up; games without playing drift him back toward neutral', () => {
    const p = structuredClone(newGame(407).players.p1);
    p.form = 0;
    const big = { pa: 5, ab: 4, h: 3, doubles: 1, triples: 0, hr: 1, rbi: 4, r: 2, bb: 1, so: 0, sb: 0 };
    expect(battingGameValue(big)).toBeGreaterThan(3);
    updateForm(p, battingGameValue(big));
    updateForm(p, battingGameValue(big));
    expect(formModifier(p)).toBeGreaterThanOrEqual(2);
    for (let i = 0; i < 12; i++) updateForm(p, null);
    expect(formModifier(p)).toBe(0);
  });

  it('an average game is close to zero', () => {
    const avg = { pa: 4, ab: 3.6, h: 0.9, doubles: 0.18, triples: 0.02, hr: 0.12, rbi: 0.5, r: 0.5, bb: 0.35, so: 0.85, sb: 0 };
    expect(Math.abs(battingGameValue(avg))).toBeLessThan(0.35);
  });
});

describe('team status', () => {
  it('rises with squad morale, hot players and happy fans', () => {
    const s = structuredClone(newGame(408));
    const club = s.clubs.hfx;
    const players = club.roster.map((id) => s.players[id]);
    for (const p of players) {
      p.satisfaction = 65;
      p.form = 0;
    }
    club.fanSupport = M.team.fansNeutral;
    expect(teamStatus(s, 'hfx').level).toBe(0);
    for (const p of players) p.satisfaction = 89;
    for (const p of players.slice(0, 8)) p.form = 1;
    club.fanSupport = 100;
    const up = teamStatus(s, 'hfx');
    expect(up.parts.morale).toBe(2);
    expect(up.hot).toBe(8);
    expect(up.level).toBe(2);
    for (const p of players) p.satisfaction = 30;
    for (const p of players) p.form = -1;
    club.fanSupport = 40;
    expect(teamStatus(s, 'hfx').level).toBe(-2);
  });

  it('a tactics session lifts Team by one for the next game only', () => {
    let s = structuredClone(newGame(409));
    s.influence = 500;
    for (const p of s.clubs.hfx.roster.map((id) => s.players[id])) {
      p.satisfaction = 65;
      p.form = 0;
    }
    s.clubs.hfx.fanSupport = M.team.fansNeutral;
    expect(actionPreview(s, 'tacticsSession').blocker).toBeNull();
    s = run(s, { type: 'managerAction', kind: 'tacticsSession', target: null, option: null, revision: s.revision });
    expect(teamStatus(s, 'hfx').level).toBe(1);
    expect(actionPreview(s, 'tacticsSession').blocker).toMatch(/already/);
    const p = s.players[s.clubs.hfx.roster[0]];
    expect(effectiveValue(s, p).mods.team).toBe(1);
    // AI clubs never get the user's boost.
    expect(teamStatus(s, s.clubOrder.find((id) => id !== 'hfx')!).boost).toBe(0);
  });
});

describe("today's pitching staff", () => {
  it('the lineup screen starts from the fixed squad: its starter and relief roles', () => {
    const s = newGame(410);
    const d = draftFromClub(s);
    expect(d.lineup.pitcherId).toBe(playerAt(s, 'hfx', 'starter'));
    for (const slot of RELIEF_SLOTS) expect(d.plan.bullpen[slot]).toBe(playerAt(s, 'hfx', slot));
  });

  it('relievers swap roles; a reliever cannot start and the starting role is never left empty', () => {
    const s = newGame(411);
    const d = draftFromClub(s);
    const { closer, setup } = d.plan.bullpen;
    const sw = assignPitcher(s, d, 'setup', closer!);
    expect(sw.plan.bullpen.setup).toBe(closer);
    expect(sw.plan.bullpen.closer).toBe(setup);
    expect(assignPitcher(s, d, 'long', d.lineup.pitcherId)).toBe(d);
    expect(assignPitcher(s, d, 'starter', closer!)).toBe(d);
    expect(slotBlocker(s, 'starter', closer!)).toMatch(/reliever and cannot start/);
    expect(pitcherSlot(sw, d.lineup.pitcherId)).toBe('starter');
    expect(d.plan.bullpen.closer).toBe(closer); // pure
  });

  it('the simulator uses only today\'s slots: a pitcher on the bench never pitches; at most five per side', () => {
    const s = structuredClone(newGame(412));
    const [h, a] = [s.clubOrder[0], s.clubOrder[1]];
    const best = bestPitching(s, h);
    s.clubs[h].pitchingPlan = { ...s.clubs[h].pitchingPlan, bullpen: best.bullpen };
    let closerSaves = 0;
    let longEarly = 0;
    for (let seed = 1; seed <= 150; seed++) {
      const home = buildSimTeam(s, h, { ...autoLineup(s, h), pitcherId: best.starterId });
      const away = buildSimTeam(s, a, autoLineup(s, a));
      const m = simulateMatch({ id: `m${seed}`, season: 1, round: 1, home, away, rng: createRng(seed) });
      for (const id of m.pitchersUsed.home) expect(s.clubs[h].roster).toContain(id);
      expect(m.pitchersUsed.home.length).toBeLessThanOrEqual(P.maxPitchersPerGame);
      for (const ch of (m.sequence ?? []).filter((e) => e.kind === 'pitchingChange' && e.battingClubId === a)) {
        const lead = ch.before.score.home - ch.before.score.away;
        if (ch.pitcherId === best.bullpen.closer && ch.inning >= 9 && lead >= P.saveLead[0] && lead <= P.saveLead[1]) closerSaves++;
        if (ch.pitcherId === best.bullpen.long && ch.inning <= P.longReliefUntilInning) longEarly++;
      }
    }
    expect(closerSaves).toBeGreaterThan(10);
    expect(longEarly).toBeGreaterThan(0);
  });
});

describe('migration to per-game pitching (v14) and on to the fixed squad', () => {
  it('drops the standing staff; every club ends with its places filled and fully ready players; stable', () => {
    const v13 = JSON.parse(JSON.stringify(newGame(413)));
    v13.schemaVersion = 13;
    for (const id of v13.clubOrder) {
      v13.clubs[id].staff = { rotation: [], closer: null, setup: null, long: null, next: 0 };
      v13.clubs[id].pitchingPlan = { relieverId: null, rest: [], hook: 'early' };
    }
    const pid = v13.clubs.hfx.roster.find((id: string) => v13.players[id].isPitcher);
    v13.players[pid].fitness = 76;
    const m = migrate(v13);
    expect(m.schemaVersion).toBe(SCHEMA_VERSION);
    expect(m.players[pid].fitness).toBe(100);
    for (const id of m.clubOrder) {
      expect(m.clubs[id].staff).toBeUndefined();
      expect(m.clubs[id].pitchingPlan.hook).toBe('early');
    }
    expectValidSquads(m);
    expect(JSON.stringify(migrate(JSON.parse(JSON.stringify(v13))))).toBe(JSON.stringify(m));
  });
});

describe('pitchers of record', () => {
  it('every decided game gives one win and one loss; saves go to relievers', () => {
    let s = newGame(414);
    for (let i = 0; i < 200 && s.cycle.matchesPlayed < 4; i++) s = step(s, 70 + i);
    const pitchers = Object.values(s.players).filter((p) => p.isPitcher);
    const games = s.schedule.filter((g) => g.result && g.result.decidedBy !== 'suddenDeath').length;
    expect(pitchers.reduce((a, p) => a + p.stats.wins, 0)).toBe(games);
    expect(pitchers.reduce((a, p) => a + p.stats.losses, 0)).toBe(games);
    for (const p of pitchers) expect(p.stats.saves).toBeLessThanOrEqual(p.stats.pitchingApps - p.stats.pitchingStarts);
  }, 60_000);
});

describe('roles by position', () => {
  it('a selection with a reliever starting or a starter relieving is refused', () => {
    const s = newGame(415);
    const d = draftFromClub(s);
    const sp = d.lineup.pitcherId;
    const rp = d.plan.bullpen.closer!;
    const errors = (starter: string, closer: string) => validatePitchingPlan(s, 'hfx', starter, { ...d.plan, bullpen: { ...d.plan.bullpen, closer } }).filter((i) => i.severity === 'error').map((i) => i.text);
    expect(errors(sp, rp)).toEqual([]);
    expect(errors(rp, sp).join()).toMatch(/reliever and cannot start/);
    expect(errors(rp, sp).join()).toMatch(/starter and cannot pitch in relief/);
  });

  it('new clubs start with the fixed squad: one starter and four relievers', () => {
    const s = newGame(416);
    for (const id of s.clubOrder) {
      const pitchers = s.clubs[id].roster.map((pid) => s.players[pid]).filter((p) => p.isPitcher);
      expect(pitchers.filter((p) => pitcherPosition(p) === 'SP').length, id).toBe(1);
      expect(pitchers.filter((p) => pitcherPosition(p) === 'RP').length, id).toBe(4);
    }
  });
});

describe('middle relief', () => {
  it('bridges the 6th–7th; the setup man takes the 8th from a middle or long reliever', () => {
    const s = structuredClone(newGame(417));
    const [h, a] = [s.clubOrder[0], s.clubOrder[1]];
    const best = bestPitching(s, h);
    s.clubs[h].pitchingPlan = { ...s.clubs[h].pitchingPlan, bullpen: best.bullpen };
    let middleIn6to7 = 0;
    let setupAt8 = 0;
    for (let seed = 1; seed <= 150; seed++) {
      const home = buildSimTeam(s, h, { ...autoLineup(s, h), pitcherId: best.starterId });
      const m = simulateMatch({ id: `m${seed}`, season: 1, round: 1, home, away: buildSimTeam(s, a, autoLineup(s, a)), rng: createRng(seed) });
      expect(m.pitchersUsed.home.length).toBeLessThanOrEqual(P.maxPitchersPerGame);
      for (const ch of (m.sequence ?? []).filter((e) => e.kind === 'pitchingChange' && e.battingClubId === a)) {
        if (ch.pitcherId === best.bullpen.middle && ch.inning >= P.middleFromInning && ch.inning < P.setupFromInning) middleIn6to7++;
        if (ch.pitcherId === best.bullpen.setup && ch.inning === P.setupFromInning) setupAt8++;
      }
    }
    expect(middleIn6to7).toBeGreaterThan(10);
    expect(setupAt8).toBeGreaterThan(10);
  });

  it('old plans get the new slot (v16); the fixed squad then fills it (v18)', () => {
    const v15 = JSON.parse(JSON.stringify(newGame(418)));
    v15.schemaVersion = 15;
    for (const id of v15.clubOrder) v15.clubs[id].pitchingPlan.bullpen = { long: null, setup: null, closer: null };
    const m = migrate(v15);
    expect(m.schemaVersion).toBe(SCHEMA_VERSION);
    for (const id of m.clubOrder) expect(m.clubs[id].pitchingPlan.bullpen.middle).toBeTruthy();
  });
});
