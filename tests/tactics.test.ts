import { describe, expect, it } from 'vitest';
import { execute } from '../src/application/engine';
import { migrate } from '../src/application/migrations';
import { autoLineup } from '../src/domain/lineup';
import { createRng } from '../src/domain/rng';
import type { GameState } from '../src/domain/state';
import { SCHEMA_VERSION } from '../src/domain/state';
import { defaultTactics, resolveTactic } from '../src/domain/tactics';
import type { MatchResult, TeamStyle } from '../src/domain/types';
import { buildCommentary } from '../src/presentation/commentary';
import { buildSimTeam, simulateMatch, tacticShift } from '../src/simulation/match';
import { opponentReport } from '../src/simulation/opponentReport';
import { newGame, run, step, T0 } from './helpers';

const cmd = (s: GameState, c: Parameters<typeof execute>[1]) => run(s, c, T0);

describe('priority', () => {
  it('match instruction > saved instruction > team match plan > team style; "team" skips player levels', () => {
    const t = defaultTactics();
    expect(resolveTactic(t, 'p1', 'baserunning')).toEqual({ value: 'balanced', source: 'team' });
    t.match.baserunning = 'cautious';
    expect(resolveTactic(t, 'p1', 'baserunning')).toEqual({ value: 'cautious', source: 'matchTeam' });
    t.instructions.p1 = { baserunning: 'aggressive' };
    expect(resolveTactic(t, 'p1', 'baserunning')).toEqual({ value: 'aggressive', source: 'instruction' });
    t.matchInstructions.p1 = { baserunning: 'balanced' };
    expect(resolveTactic(t, 'p1', 'baserunning')).toEqual({ value: 'balanced', source: 'matchInstruction' });
    // Follow team for this match: the saved exception is skipped, the team's match plan applies.
    t.matchInstructions.p1 = { baserunning: 'team' };
    expect(resolveTactic(t, 'p1', 'baserunning')).toEqual({ value: 'cautious', source: 'matchTeam' });
    // Other players are not affected.
    expect(resolveTactic(t, 'p2', 'baserunning').value).toBe('cautious');
  });
});

describe('commands and saving', () => {
  it('saved changes persist; match-only changes end after the league game without touching the saved plan', () => {
    let s = newGame(41);
    const hitter = s.clubs.hfx.lineup.battingOrder[0].playerId;
    s = cmd(s, { type: 'setTeamStyle', area: 'batting', value: 'contact', scope: 'default' });
    s = cmd(s, { type: 'setInstruction', playerId: hitter, area: 'baserunning', value: 'aggressive', scope: 'default' });
    s = cmd(s, { type: 'setTeamStyle', area: 'pitching', value: 'careful', scope: 'match' });
    s = cmd(s, { type: 'setInstruction', playerId: hitter, area: 'baserunning', value: 'team', scope: 'match' });
    const t = s.clubs.hfx.tactics;
    expect(t.style).toEqual({ batting: 'contact', baserunning: 'balanced', pitching: 'balanced' });
    expect(t.match).toEqual({ pitching: 'careful' });
    expect(resolveTactic(t, hitter, 'baserunning').value).toBe('balanced');
    // Survives a save round-trip.
    expect(migrate(JSON.parse(JSON.stringify(s))).clubs.hfx.tactics).toEqual(t);
    // Play on until one league game has been played.
    const played = Object.keys(s.matches).length;
    for (let i = 0; i < 20 && Object.keys(s.matches).length === played; i++) s = step(s, 500 + i);
    const after = s.clubs.hfx.tactics;
    expect(after.match).toEqual({});
    expect(after.matchInstructions).toEqual({});
    expect(after.style.batting).toBe('contact');
    expect(resolveTactic(after, hitter, 'baserunning').value).toBe('aggressive');
  });

  it('match change equal to the usual plan is dropped; save-as-default replaces it; reset clears all match changes', () => {
    let s = newGame(42);
    s = cmd(s, { type: 'setTeamStyle', area: 'baserunning', value: 'aggressive', scope: 'match' });
    s = cmd(s, { type: 'setTeamStyle', area: 'baserunning', value: 'balanced', scope: 'match' });
    expect(s.clubs.hfx.tactics.match).toEqual({});
    s = cmd(s, { type: 'setTeamStyle', area: 'baserunning', value: 'aggressive', scope: 'match' });
    s = cmd(s, { type: 'setTeamStyle', area: 'baserunning', value: 'aggressive', scope: 'default' });
    expect(s.clubs.hfx.tactics.match).toEqual({});
    expect(s.clubs.hfx.tactics.style.baserunning).toBe('aggressive');
    const p = s.clubs.hfx.lineup.battingOrder[2].playerId;
    s = cmd(s, { type: 'setInstruction', playerId: p, area: 'batting', value: 'power', scope: 'match' });
    s = cmd(s, { type: 'setTeamStyle', area: 'pitching', value: 'attack', scope: 'match' });
    s = cmd(s, { type: 'resetMatchTactics' });
    expect(s.clubs.hfx.tactics.match).toEqual({});
    expect(s.clubs.hfx.tactics.matchInstructions).toEqual({});
    expect(s.clubs.hfx.tactics.style.baserunning).toBe('aggressive');
  });

  it('only relevant instructions are accepted', () => {
    const s = newGame(43);
    const pitcher = s.clubs.hfx.lineup.pitcherId;
    const r = execute(s, { type: 'setInstruction', playerId: pitcher, area: 'baserunning', value: 'aggressive', scope: 'default' }, T0);
    expect(r.ok).toBe(false);
    expect(execute(s, { type: 'setTeamStyle', area: 'batting', value: 'bunt', scope: 'default' }, T0).ok).toBe(false);
  });

  it('older saves get Balanced and Follow team', () => {
    const v6 = JSON.parse(JSON.stringify(newGame(44)));
    v6.schemaVersion = 6;
    for (const c of Object.values(v6.clubs) as Record<string, unknown>[]) delete c.tactics;
    const m = migrate(v6);
    expect(m.schemaVersion).toBe(SCHEMA_VERSION);
    expect(m.clubs.hfx.tactics).toEqual(defaultTactics());
  });

  it('a season of matches plays without ever opening tactics', () => {
    let s = newGame(45);
    for (let i = 0; i < 80; i++) s = step(s, 900 + i);
    expect(Object.keys(s.matches).length).toBeGreaterThan(5);
    expect(s.clubs.hfx.tactics).toEqual(defaultTactics());
  });
});

/** Totals over many simulated games with the home club's style overridden. */
function totals(style: Partial<TeamStyle>, games = 160, tweak?: (s: GameState) => void) {
  const base = structuredClone(newGame(5));
  tweak?.(base);
  const [h, a] = [base.clubOrder[0], base.clubOrder[1]];
  Object.assign(base.clubs[h].tactics.style, style);
  const out = { hr: 0, k: 0, bb: 0, h: 0, pa: 0, sbTry: 0, cs: 0, runs: 0, allowedBB: 0, allowedH: 0, allowedHR: 0, notes: 0 };
  const home = buildSimTeam(base, h, autoLineup(base, h));
  const away = buildSimTeam(base, a, autoLineup(base, a));
  for (let g = 0; g < games; g++) {
    const m: MatchResult = simulateMatch({ id: `t${g}`, season: 1, round: 1, home, away, rng: createRng(1000 + g) });
    for (const b of home.batters) {
      const l = m.batting[b.id];
      out.hr += l.hr;
      out.k += l.so;
      out.bb += l.bb;
      out.h += l.h;
      out.pa += l.pa;
    }
    for (const b of away.batters) {
      const l = m.batting[b.id];
      out.allowedBB += l.bb;
      out.allowedH += l.h;
      out.allowedHR += l.hr;
    }
    out.runs += m.runs.home;
    for (const st of m.sequence!) {
      if (st.battingClubId !== h) continue;
      if (st.kind === 'steal' || st.kind === 'caughtStealing') out.sbTry++;
      if (st.kind === 'caughtStealing') out.cs++;
      if (st.tactic) out.notes++;
    }
  }
  return out;
}

describe('match engine effects', () => {
  const balanced = totals({});

  it('Balanced never produces tactic notes', () => {
    expect(balanced.notes).toBe(0);
  });

  it('power hits more home runs but strikes out more; contact the opposite', () => {
    const power = totals({ batting: 'power' });
    const contact = totals({ batting: 'contact' });
    expect(power.hr).toBeGreaterThan(balanced.hr);
    expect(power.k).toBeGreaterThan(balanced.k);
    expect(contact.k).toBeLessThan(balanced.k);
    expect(contact.hr).toBeLessThan(balanced.hr);
  });

  it('attributes decide: weak hitters gain far less from power than strong ones', () => {
    const weak = (s: GameState) => {
      for (const id of s.clubs[s.clubOrder[0]].roster) if (!s.players[id].isPitcher) s.players[id].ratings.power = 35;
    };
    const strong = (s: GameState) => {
      for (const id of s.clubs[s.clubOrder[0]].roster) if (!s.players[id].isPitcher) s.players[id].ratings.power = 75;
    };
    const gain = (tweak: (s: GameState) => void) => totals({ batting: 'power' }, 120, tweak).hr / Math.max(1, totals({}, 120, tweak).hr);
    expect(gain(strong)).toBeGreaterThan(gain(weak));
  });

  it('aggressive running steals more and gets caught more; cautious rarely runs', () => {
    const aggressive = totals({ baserunning: 'aggressive' });
    const cautious = totals({ baserunning: 'cautious' });
    expect(aggressive.sbTry).toBeGreaterThan(balanced.sbTry);
    expect(aggressive.cs).toBeGreaterThan(balanced.cs);
    expect(cautious.sbTry).toBeLessThanOrEqual(balanced.sbTry);
    expect(aggressive.notes).toBeGreaterThan(0);
  });

  it('attack walks fewer but gives up more hits; careful the opposite', () => {
    const attack = totals({ pitching: 'attack' });
    const careful = totals({ pitching: 'careful' });
    expect(attack.allowedBB).toBeLessThan(balanced.allowedBB);
    // Per pitch in the zone, attacking is more hittable, and more so for a weak pitcher
    // (in totals this is offset by longer, less tired outings).
    const bat = { batting: 'balanced' as const, contact: 50, power: 50 };
    const weakAttack = tacticShift(bat, { style: 'attack', pitching: 40 });
    const aceAttack = tacticShift(bat, { style: 'attack', pitching: 75 });
    expect(weakAttack.hit).toBeGreaterThan(aceAttack.hit);
    expect(aceAttack.hit).toBeGreaterThan(0);
    expect(tacticShift(bat, { style: 'balanced', pitching: 60 })).toEqual({ k: 0, walk: 0, hit: 0, hr: 1, dbl: 1 });
    expect(careful.allowedBB).toBeGreaterThan(balanced.allowedBB);
    expect(careful.allowedHR).toBeLessThan(balanced.allowedHR);
  });
});

describe('commentary and opponent report', () => {
  it('names the instruction only when the simulator records it', () => {
    const base = structuredClone(newGame(5));
    const [h, a] = [base.clubOrder[0], base.clubOrder[1]];
    const lineup = autoLineup(base, h);
    // One runner with his own aggressive instruction; the team stays Balanced.
    const fast = [...lineup.battingOrder].sort((x, y) => base.players[y.playerId].ratings.speed - base.players[x.playerId].ratings.speed)[0].playerId;
    base.clubs[h].tactics.instructions[fast] = { baserunning: 'aggressive' };
    let found = false;
    for (let g = 0; g < 200 && !found; g++) {
      const m = simulateMatch({ id: `c${g}`, season: 1, round: 1, home: buildSimTeam(base, h, lineup), away: buildSimTeam(base, a, autoLineup(base, a)), rng: createRng(g) });
      const steps = buildCommentary({ match: m, name: (id) => base.players[id]?.lastName ?? id, clubName: (id) => base.clubs[id].name });
      for (const st of m.sequence!) {
        if (st.tactic) {
          expect(st.tactic.playerId).toBe(fast);
          expect(st.tactic.source).toBe('instruction');
        }
      }
      const noted = steps.filter((x) => /aggressive instruction/.test(x.text));
      if (noted.length) found = true;
      // Every mention corresponds to a recorded tactic decision.
      expect(noted.length).toBeLessThanOrEqual(m.sequence!.filter((x) => x.tactic).length * 2);
    }
    expect(found).toBe(true);
  });

  it('opponent report: at most three labelled observations from real data', () => {
    let s = newGame(46);
    for (let i = 0; i < 40; i++) s = step(s, 700 + i);
    const g = s.schedule.find((x) => !x.result && (x.homeId === s.userClubId || x.awayId === s.userClubId))!;
    const r = opponentReport(s, g.id);
    expect(r.observations.length).toBeLessThanOrEqual(3);
    for (const o of r.observations) {
      expect(['Trait', 'Status', 'Recent form']).toContain(o.kind);
      if (o.kind === 'Recent form' && !/last 5/.test(o.text)) expect(o.text).toMatch(/small sample/);
    }
  });
});
