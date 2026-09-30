import { describe, expect, it } from 'vitest';
import { execute } from '../src/application/engine';
import { autoLineup, defaultPitchingPlan, validateLineup } from '../src/domain/lineup';
import { draftFromClub, moveBatter, pitcherRole, setPitcherRole, swapFromBench, swapPositions, type LineupDraft } from '../src/domain/lineupDraft';
import { battingStats, fmtIp, pitchingStats, recentClubMatches } from '../src/domain/playerStats';
import { createRng } from '../src/domain/rng';
import type { GameState } from '../src/domain/state';
import type { PitchingPlan } from '../src/domain/types';
import { buildSimTeam, simulateMatch } from '../src/simulation/match';
import { newGame, run, T0, toNextEvent } from './helpers';

function toLeagueGame(s: GameState): GameState {
  for (let i = 0; i < 40 && (s = toNextEvent(s)).currentEvent!.type !== 'leagueGame'; i++) {
    const ev = s.currentEvent!;
    s = run(s, { type: 'resolveEvent', eventId: ev.id, revision: s.revision, optionId: ev.options[ev.options.length - 1].id, boostId: null });
    s = run(s, { type: 'acknowledgeEvent', eventId: ev.id });
  }
  return s;
}

const confirm = (s: GameState, d: LineupDraft) =>
  execute(s, { type: 'resolveEvent', eventId: s.currentEvent!.id, revision: s.revision, optionId: 'current', boostId: null, selection: { lineup: d.lineup, pitchingPlan: d.plan } }, T0);

describe('lineup draft', () => {
  const s = newGame(31);
  const d = draftFromClub(s);
  const bench = s.clubs.hfx.roster.filter((id) => !s.players[id].isPitcher && !d.lineup.battingOrder.some((x) => x.playerId === id));

  it('a bench swap takes over position and batting spot; the starter goes to the bench', () => {
    const slot = 3;
    const out = d.lineup.battingOrder[slot];
    const next = swapFromBench(d, slot, bench[0]);
    expect(next.lineup.battingOrder[slot]).toEqual({ playerId: bench[0], position: out.position });
    expect(next.lineup.battingOrder.some((x) => x.playerId === out.playerId)).toBe(false);
    const ids = next.lineup.battingOrder.map((x) => x.playerId);
    expect(new Set(ids).size).toBe(9);
    expect(validateLineup(s, 'hfx', next.lineup).filter((i) => i.severity === 'error')).toEqual([]);
    expect(d.lineup.battingOrder[slot].playerId).toBe(out.playerId); // pure
  });

  it('position swaps are atomic and keep the batting order', () => {
    const next = swapPositions(d, 0, 1);
    expect(next.lineup.battingOrder[0].position).toBe(d.lineup.battingOrder[1].position);
    expect(next.lineup.battingOrder[1].position).toBe(d.lineup.battingOrder[0].position);
    expect(next.lineup.battingOrder.map((x) => x.playerId)).toEqual(d.lineup.battingOrder.map((x) => x.playerId));
  });

  it('reordering changes only the batting order', () => {
    const next = moveBatter(d, 0, 4);
    expect(next.lineup.battingOrder[4]).toEqual(d.lineup.battingOrder[0]);
    const pos = (x: LineupDraft) => Object.fromEntries(x.lineup.battingOrder.map((sl) => [sl.playerId, sl.position]));
    expect(pos(next)).toEqual(pos(d));
  });

  it('pitcher roles stay exclusive', () => {
    const pitchers = s.clubs.hfx.roster.filter((id) => s.players[id].isPitcher && id !== d.lineup.pitcherId);
    let x = setPitcherRole(d, pitchers[0], 'reliever');
    x = setPitcherRole(x, pitchers[1], 'rest');
    expect(pitcherRole(x, pitchers[0])).toBe('reliever');
    x = setPitcherRole(x, pitchers[1], 'reliever');
    expect(pitcherRole(x, pitchers[0])).toBe('available');
    expect(x.plan.rest).not.toContain(pitchers[1]);
    x = setPitcherRole(x, pitchers[1], 'starter');
    expect(x.lineup.pitcherId).toBe(pitchers[1]);
    expect(x.plan.relieverId).toBeNull();
    expect(pitcherRole(x, d.lineup.pitcherId)).toBe('available');
  });
});

describe('confirmed selection reaches the simulator', () => {
  it('uses the confirmed lineup and never uses a resting pitcher', () => {
    let s = toLeagueGame(newGame(32));
    let d = draftFromClub(s);
    const bench = s.clubs.hfx.roster.filter((id) => !s.players[id].isPitcher && !d.lineup.battingOrder.some((x) => x.playerId === id));
    d = moveBatter(swapFromBench(d, 2, bench[0]), 0, 8);
    const others = s.clubs.hfx.roster.filter((id) => s.players[id].isPitcher && id !== d.lineup.pitcherId);
    d = setPitcherRole(setPitcherRole(d, others[0], 'rest'), others[1], 'reliever');
    const r = confirm(s, d);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    s = r.state;
    const m = s.matches[s.currentEvent!.resolution!.matchId!];
    const side = m.homeId === 'hfx' ? 'home' : 'away';
    expect(m.lineups[side].battingOrder).toEqual(d.lineup.battingOrder);
    expect(m.lineups[side].pitcherId).toBe(d.lineup.pitcherId);
    expect(m.pitchersUsed[side]).not.toContain(others[0]);
    if (m.pitchersUsed[side].length > 1) expect(m.pitchersUsed[side][1]).toBe(others[1]);
    // Today's reliever/rest are cleared after the game; the hook preference stays.
    expect(s.clubs.hfx.pitchingPlan).toEqual({ ...defaultPitchingPlan(), hook: d.plan.hook });
    // Confirming twice is a no-op.
    expect(confirm(s, d).ok).toBe(false);
  });

  it('rejects an invalid plan with a concrete message and charges nothing', () => {
    const s = toLeagueGame(newGame(33));
    const d = draftFromClub(s);
    const bad: LineupDraft = { ...d, plan: { ...d.plan, rest: [d.lineup.pitcherId] } };
    const r = confirm(s, bad);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/starter and cannot also rest/);
  });

  it('the hook setting measurably changes how long starters pitch', () => {
    const avgBf = (hook: PitchingPlan['hook']) => {
      let total = 0;
      for (let seed = 1; seed <= 150; seed++) {
        const s = newGame(5);
        s.clubs[s.clubOrder[0]].pitchingPlan = { ...defaultPitchingPlan(), hook };
        const [h, a] = [s.clubOrder[0], s.clubOrder[1]];
        const home = buildSimTeam(s, h, autoLineup(s, h));
        const m = simulateMatch({ id: `m${seed}`, season: 1, round: 1, home, away: buildSimTeam(s, a, autoLineup(s, a)), rng: createRng(seed) });
        total += m.pitching[home.starter.id].battersFaced;
      }
      return total / 150;
    };
    const early = avgBf('early');
    const long = avgBf('long');
    expect(early).toBeLessThan(long - 3);
  });
});

describe('period stats', () => {
  it('season comes from the box-score totals; last 5 from the five latest games; empty samples are null', () => {
    let s = toLeagueGame(newGame(34));
    for (let g = 0; g < 7; g++) {
      s = toLeagueGame(s);
      const ev = s.currentEvent!;
      s = run(s, { type: 'resolveEvent', eventId: ev.id, revision: s.revision, optionId: 'current', boostId: null });
      s = run(s, { type: 'acknowledgeEvent', eventId: ev.id });
    }
    const games = recentClubMatches(s);
    expect(games.length).toBeGreaterThanOrEqual(7);
    const hitter = s.players[s.clubs.hfx.lineup.battingOrder[0].playerId];
    const season = battingStats(s, hitter, 'season');
    expect(season.ab).toBe(hitter.stats.ab);
    expect(season.obp).toBeCloseTo((hitter.stats.h + hitter.stats.bb) / hitter.stats.pa, 6);
    const last5 = battingStats(s, hitter, 'last5');
    const expectedAb = games.slice(0, 5).reduce((a, m) => a + (m.batting[hitter.id]?.ab ?? 0), 0);
    expect(last5.ab).toBe(expectedAb);
    expect(last5.g).toBeLessThanOrEqual(5);

    const unused = s.clubs.hfx.roster.map((id) => s.players[id]).find((p) => p.isPitcher && p.stats.outsPitched === 0);
    if (unused) expect(pitchingStats(s, unused, 'season').era).toBeNull();
    expect(fmtIp(32)).toBe('10.2');
  }, 60_000);
});
