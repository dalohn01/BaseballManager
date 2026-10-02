import { describe, expect, it } from 'vitest';
import { migrate } from '../src/application/migrations';
import { BALANCE } from '../src/balance/config';
import {
  battingGameValue,
  effectiveValue,
  fitnessModifier,
  formModifier,
  modifierTotal,
  moraleModifier,
  restAfterGame,
  restStage,
  teamStatus,
  updateForm,
} from '../src/domain/effective';
import { autoLineup } from '../src/domain/lineup';
import { assignPitcher, benchPitcher, draftFromClub, pitcherSlot } from '../src/domain/lineupDraft';
import { overallAs, overall } from '../src/domain/ratings';
import { createRng } from '../src/domain/rng';
import { SCHEMA_VERSION } from '../src/domain/state';
import { bestPitching, relieverValue, starterValue } from '../src/domain/todayPitching';
import { actionPreview } from '../src/simulation/actions';
import { buildSimTeam, simulateMatch } from '../src/simulation/match';
import { advanceDay, newGame, run, step, toNextEvent } from './helpers';

const P = BALANCE.pitching;
const M = BALANCE.modifiers;

describe('rest counted in games', () => {
  it('a start leaves a pitcher Exhausted; each game off moves him one stage up; relief one stage down', () => {
    const p = structuredClone(newGame(401).players.p1);
    p.isPitcher = true;
    restAfterGame(p, 'start');
    expect([restStage(p), fitnessModifier(p)]).toEqual([0, -25]);
    restAfterGame(p, 'none');
    expect([restStage(p), fitnessModifier(p)]).toEqual([1, -10]);
    restAfterGame(p, 'none');
    expect([restStage(p), fitnessModifier(p)]).toEqual([2, 0]);
    restAfterGame(p, 'none');
    expect([restStage(p), fitnessModifier(p)]).toEqual([3, 1]);
    restAfterGame(p, 'none');
    expect(restStage(p)).toBe(3);
    // A reliever who was Fresh is Ready after one outing, Tired after two.
    restAfterGame(p, 'relief');
    expect(restStage(p)).toBe(2);
    restAfterGame(p, 'relief');
    expect(restStage(p)).toBe(1);
  });

  it('pitchers do not recover by days, only by games', () => {
    let s = toNextEvent(newGame(402));
    while (s.currentEvent) s = step(s, 3);
    s = structuredClone(s);
    const pid = s.clubs.hfx.roster.find((id) => s.players[id].isPitcher)!;
    s.players[pid].fitness = M.restStages[1].fitness;
    const hitter = s.clubs.hfx.roster.find((id) => !s.players[id].isPitcher)!;
    s.players[hitter].fitness = 80;
    const t = advanceDay(s);
    expect(t.players[pid].fitness).toBe(M.restStages[1].fitness);
    expect(t.players[hitter].fitness).toBe(80 + BALANCE.fitness.naturalRecoveryPerDay);
  });

  it('over nine games no starter pitches two games in a row, and at least three pitchers share the starts', () => {
    let s = newGame(403);
    // The game number of each pitcher's latest start, per club.
    const lastStart = new Map<string, number>();
    const played = (id: string) => s.schedule.filter((g) => g.result && (g.homeId === id || g.awayId === id)).length;
    const starts = (pid: string) => s.players[pid].stats.pitchingStarts;
    let before = new Map(Object.keys(s.players).map((pid) => [pid, starts(pid)]));
    for (let i = 0; i < 400 && s.cycle.matchesPlayed < 9; i++) {
      s = step(s, 50 + i);
      for (const id of s.clubOrder) {
        const n = played(id);
        for (const pid of s.clubs[id].roster) {
          if (!s.players[pid].isPitcher || starts(pid) === (before.get(pid) ?? 0)) continue;
          if (lastStart.has(pid)) expect(n - lastStart.get(pid)!, `${id} ${pid}`).toBeGreaterThanOrEqual(2);
          lastStart.set(pid, n);
        }
      }
      before = new Map(Object.keys(s.players).map((pid) => [pid, starts(pid)]));
    }
    for (const id of s.clubOrder) {
      const used = s.clubs[id].roster.filter((pid) => s.players[pid].isPitcher && starts(pid) > 0);
      expect(used.length, id).toBeGreaterThanOrEqual(3);
    }
  }, 60_000);
});

describe('effective value', () => {
  it('is OVR plus Fitness, Morale, Team and Form; pitchers by job', () => {
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

  it('an exhausted starter pitches clearly worse in the simulator', () => {
    const runs = (stage: 0 | 3) => {
      let allowed = 0;
      for (let seed = 1; seed <= 120; seed++) {
        const s = structuredClone(newGame(406));
        const [h, a] = [s.clubOrder[0], s.clubOrder[1]];
        const lineup = autoLineup(s, h);
        s.players[lineup.pitcherId].fitness = M.restStages[stage].fitness;
        const m = simulateMatch({ id: `m${seed}`, season: 1, round: 1, home: buildSimTeam(s, h, lineup), away: buildSimTeam(s, a, autoLineup(s, a)), rng: createRng(seed) });
        allowed += m.runs.away;
      }
      return allowed / 120;
    };
    expect(runs(0)).toBeGreaterThan(runs(3) + 1);
  }, 60_000);
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
  it('the preset is the strongest setup by effective value', () => {
    const s = structuredClone(newGame(410));
    const pitchers = s.clubs.hfx.roster.map((id) => s.players[id]).filter((p) => p.isPitcher);
    // Make the best starter exhausted: he must not be preselected.
    const ace = [...pitchers].sort((a, b) => starterValue(s, b) - starterValue(s, a))[0];
    ace.fitness = M.restStages[0].fitness;
    const d = draftFromClub(s);
    expect(d.lineup.pitcherId).not.toBe(ace.id);
    const best = Math.max(...pitchers.map((p) => starterValue(s, p)));
    expect(starterValue(s, s.players[d.lineup.pitcherId])).toBe(best);
    const pen = [d.plan.bullpen.closer, d.plan.bullpen.setup, d.plan.bullpen.long];
    expect(pen.every(Boolean)).toBe(true);
    expect(new Set([d.lineup.pitcherId, ...pen]).size).toBe(4);
    // The closer is the strongest reliever.
    expect(relieverValue(s, s.players[d.plan.bullpen.closer!])).toBeGreaterThanOrEqual(relieverValue(s, s.players[d.plan.bullpen.setup!]) - M.starterInReliefPenalty);
  });

  it('assigning swaps slots; a bench pitcher sends the slot holder to the bench', () => {
    const s = newGame(411);
    const d = draftFromClub(s);
    const { closer, setup } = d.plan.bullpen;
    const sw = assignPitcher(d, 'setup', closer!);
    expect(sw.plan.bullpen.setup).toBe(closer);
    expect(sw.plan.bullpen.closer).toBe(setup);
    const benchId = s.clubs.hfx.roster.find((id) => s.players[id].isPitcher && !pitcherSlot(d, id))!;
    const inn = assignPitcher(d, 'starter', benchId);
    expect(inn.lineup.pitcherId).toBe(benchId);
    expect(pitcherSlot(inn, d.lineup.pitcherId)).toBeNull();
    // A starter moved to relief swaps with the reliever.
    const st = assignPitcher(d, 'long', d.lineup.pitcherId);
    expect(st.lineup.pitcherId).toBe(d.plan.bullpen.long);
    expect(benchPitcher(d, 'closer').plan.bullpen.closer).toBeNull();
    expect(d.plan.bullpen.closer).toBe(closer); // pure
  });

  it('the simulator uses only today\'s slots: a pitcher on the bench never pitches; at most four per side', () => {
    const s = structuredClone(newGame(412));
    const [h, a] = [s.clubOrder[0], s.clubOrder[1]];
    const best = bestPitching(s, h);
    s.clubs[h].pitchingPlan = { ...s.clubs[h].pitchingPlan, bullpen: best.bullpen };
    const benched = s.clubs[h].roster.filter((id) => s.players[id].isPitcher && id !== best.starterId && !Object.values(best.bullpen).includes(id));
    let closerSaves = 0;
    let longEarly = 0;
    for (let seed = 1; seed <= 150; seed++) {
      const home = buildSimTeam(s, h, { ...autoLineup(s, h), pitcherId: best.starterId });
      const away = buildSimTeam(s, a, autoLineup(s, a));
      const m = simulateMatch({ id: `m${seed}`, season: 1, round: 1, home, away, rng: createRng(seed) });
      for (const id of benched) expect(m.pitchersUsed.home).not.toContain(id);
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

describe('migration to per-game pitching (v14)', () => {
  it('drops the standing staff, empties the relief slots and puts pitchers on rest stages; stable', () => {
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
    expect(m.players[pid].fitness).toBe(M.restStages[1].fitness);
    for (const id of m.clubOrder) {
      expect(m.clubs[id].staff).toBeUndefined();
      expect(m.clubs[id].pitchingPlan).toEqual({ relieverId: null, rest: [], bullpen: { long: null, setup: null, closer: null }, hook: 'early' });
      expect(m.players[m.clubs[id].lineup.pitcherId].isPitcher).toBe(true);
    }
    for (const p of Object.values(m.players)) if (p.isPitcher) expect(M.restStages.map((x) => x.fitness)).toContain(p.fitness);
    expect(JSON.stringify(migrate(JSON.parse(JSON.stringify(v13))))).toBe(JSON.stringify(m));
  });
});
