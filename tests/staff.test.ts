import { describe, expect, it } from 'vitest';
import { execute } from '../src/application/engine';
import { migrate } from '../src/application/migrations';
import { BALANCE } from '../src/balance/config';
import { autoLineup } from '../src/domain/lineup';
import { createRng } from '../src/domain/rng';
import { absDay, daysUntil, defaultStaff, nextStarter, pitcherReadiness, staffRole } from '../src/domain/staff';
import { SCHEMA_VERSION } from '../src/domain/state';
import { buildSimTeam, simulateMatch } from '../src/simulation/match';
import { advanceDay, newGame, run, step, T0, toNextEvent } from './helpers';

const P = BALANCE.pitching;

describe('rotation', () => {
  it('the next ready starter comes up in turn; a tired one is skipped', () => {
    const s = structuredClone(newGame(401));
    const staff = s.clubs.hfx.staff!;
    expect(nextStarter(s, 'hfx')).toBe(staff.rotation[0]);
    staff.next = 1;
    expect(nextStarter(s, 'hfx')).toBe(staff.rotation[1]);
    s.players[staff.rotation[1]].fitness = P.starterReadyFitness - 1;
    expect(nextStarter(s, 'hfx')).toBe(staff.rotation[2]);
    // Resting today also skips him.
    expect(nextStarter(s, 'hfx', [staff.rotation[2]])).toBe(staff.rotation[0]);
  });

  it('over a season every club works through its rotation (every starter gets starts)', () => {
    let s = newGame(402);
    for (let i = 0; i < 400 && s.cycle.matchesPlayed < 9; i++) s = step(s, 50 + i);
    for (const id of s.clubOrder) {
      const starts = new Map<string, number>();
      for (const p of s.clubs[id].roster.map((pid) => s.players[pid]).filter((p) => p.isPitcher)) starts.set(p.id, p.stats.pitchingStarts);
      for (const r of s.clubs[id].staff!.rotation) expect(starts.get(r), `${id} ${r}`).toBeGreaterThanOrEqual(2);
    }
  }, 60_000);
});

describe('bullpen roles in the simulator', () => {
  it('at most three pitchers; the closer comes in to save a 9th-inning lead; long relief takes early exits', () => {
    const s = newGame(403);
    const [h, a] = [s.clubOrder[0], s.clubOrder[1]];
    let closerSaves = 0;
    let longEarly = 0;
    for (let seed = 1; seed <= 200; seed++) {
      const home = buildSimTeam(s, h, autoLineup(s, h));
      const away = buildSimTeam(s, a, autoLineup(s, a));
      const m = simulateMatch({ id: `m${seed}`, season: 1, round: 1, home, away, rng: createRng(seed) });
      for (const side of ['home', 'away'] as const) {
        expect(m.pitchersUsed[side].length).toBeLessThanOrEqual(P.maxPitchersPerGame);
        const team = side === 'home' ? home : away;
        for (const ch of (m.sequence ?? []).filter((e) => e.kind === 'pitchingChange' && (e.battingClubId === m.homeId ? 'away' : 'home') === side)) {
          const own = side === 'home' ? ch.before.score.home - ch.before.score.away : ch.before.score.away - ch.before.score.home;
          if (team.bullpen.closer && ch.pitcherId === team.bullpen.closer.id && ch.inning >= 9 && own >= P.saveLead[0] && own <= P.saveLead[1]) closerSaves++;
          if (team.bullpen.long && ch.pitcherId === team.bullpen.long.id && ch.inning <= P.longReliefUntilInning) longEarly++;
          // A reliever never enters while resting or as today's starter.
          expect(ch.pitcherId).not.toBe(team.starter.id);
        }
      }
    }
    expect(closerSaves).toBeGreaterThan(20);
    expect(longEarly).toBeGreaterThan(0);
  });

  it('a pitcher resting today or below the relief line is never used in relief', () => {
    const s = structuredClone(newGame(404));
    const staff = s.clubs.hfx.staff!;
    s.players[staff.setup!].fitness = P.relieverMinFitness - 5;
    s.clubs.hfx.pitchingPlan = { ...s.clubs.hfx.pitchingPlan, rest: [staff.closer!] };
    const team = buildSimTeam(s, 'hfx', autoLineup(s, 'hfx'));
    expect(team.bullpen.closer).toBeNull();
    expect(team.bullpen.setup).toBeNull();
    expect(team.bullpen.long?.id).toBe(staff.long);
  });
});

describe('rest counted in days', () => {
  it('each new day: everyone recovers a little, pitchers who did not pitch the day before more', () => {
    let s = toNextEvent(newGame(405));
    while (s.currentEvent) s = step(s, 3);
    s = structuredClone(s);
    const [a, b] = s.clubs.hfx.staff!.rotation;
    s.players[a].fitness = 60;
    s.players[b].fitness = 60;
    s.players[a].pitchedOn = absDay(s.calendar);
    const t = advanceDay(s);
    const f = BALANCE.fitness;
    expect(t.players[a].fitness).toBe(60 + f.naturalRecoveryPerDay);
    expect(t.players[b].fitness).toBe(60 + f.naturalRecoveryPerDay + f.pitcherRecoveryPerDay);
    expect(pitcherReadiness(t, t.players[a], 'rotation')).toBe('Pitched yesterday');
    expect(daysUntil(t.players[b], P.starterReadyFitness)).toBeGreaterThan(0);
    expect(pitcherReadiness(t, t.players[b], 'rotation')).toMatch(/^Ready in \d+ days?$/);
  });
});

describe('editing the staff', () => {
  it('saves a valid staff, refuses doubles and foreign players, and keeps whose turn it is', () => {
    const s = newGame(406);
    const st = s.clubs.hfx.staff!;
    const swapped = { ...st, rotation: [st.rotation[1], st.rotation[0], st.rotation[2]], closer: st.setup, setup: st.closer };
    const r = run(s, { type: 'setStaff', staff: swapped });
    expect(r.clubs.hfx.staff!.rotation).toEqual(swapped.rotation);
    expect(r.clubs.hfx.staff!.rotation[r.clubs.hfx.staff!.next]).toBe(st.rotation[st.next]);
    expect(staffRole(r.clubs.hfx.staff!, st.setup!)).toBe('closer');
    expect(execute(s, { type: 'setStaff', staff: { ...st, closer: st.rotation[0] } }, T0).ok).toBe(false);
    const foreign = s.clubs[s.clubOrder[1]].staff!.rotation[0];
    expect(execute(s, { type: 'setStaff', staff: { ...st, long: foreign } }, T0).ok).toBe(false);
    expect(execute(s, { type: 'setStaff', staff: { ...st, rotation: [] } }, T0).ok).toBe(false);
  });
});

describe('migration to pitching staffs (v11)', () => {
  it('adds two pitchers per club, builds a staff, and is stable', () => {
    const v10 = JSON.parse(JSON.stringify(newGame(407)));
    v10.schemaVersion = 10;
    for (const id of v10.clubOrder) {
      const club = v10.clubs[id];
      // An old four-pitcher staff and no standing plan.
      const pitchers = club.roster.filter((pid: string) => v10.players[pid].isPitcher);
      for (const pid of pitchers.slice(4)) {
        delete v10.players[pid];
        club.roster = club.roster.filter((x: string) => x !== pid);
      }
      delete club.staff;
    }
    const m = migrate(v10);
    expect(m.schemaVersion).toBe(SCHEMA_VERSION);
    for (const id of m.clubOrder) {
      const pitchers = m.clubs[id].roster.filter((pid) => m.players[pid].isPitcher);
      expect(pitchers).toHaveLength(6);
      expect(m.clubs[id].staff).toEqual(defaultStaff(m, id));
      for (const pid of pitchers) expect(m.players[pid].personality).toBeTruthy();
    }
    const again = migrate(JSON.parse(JSON.stringify(v10)));
    expect(JSON.stringify(again.players)).toBe(JSON.stringify(m.players));
  });
});
