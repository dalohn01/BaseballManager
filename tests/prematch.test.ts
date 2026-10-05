import { describe, expect, it } from 'vitest';
import { execute } from '../src/application/engine';
import { pitcherPosition } from '../src/domain/pitching';
import { autoLineup, defaultPitchingPlan, validateBatters, validateLineup } from '../src/domain/lineup';
import { assignPitcher, benchBatter, draftFromClub, moveBatter, openSpot, pitcherSlot, setPosition, swapFromBench, swapPositions, type LineupDraft } from '../src/domain/lineupDraft';
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

  it("today's pitching slots stay exclusive: every pitcher has at most one slot", () => {
    const pitchers = s.clubs.hfx.roster.filter((id) => s.players[id].isPitcher);
    const sp = pitchers.filter((id) => pitcherPosition(s.players[id]) === 'SP');
    const rp = pitchers.filter((id) => pitcherPosition(s.players[id]) === 'RP');
    let x = d;
    for (const [slot, id] of [['closer', rp[4]], ['starter', sp[3]], ['setup', rp[0]], ['long', rp[5]], ['closer', rp[0]]] as const) x = assignPitcher(s, x, slot, id);
    const slots = pitchers.map((id) => pitcherSlot(x, id)).filter(Boolean);
    expect(new Set(slots).size).toBe(slots.length);
    expect(slots.length).toBe(4);
  });
});

describe('confirmed selection reaches the simulator', () => {
  it('uses the confirmed lineup and never uses a pitcher without a slot today', () => {
    let s = toLeagueGame(newGame(32));
    let d = draftFromClub(s);
    const bench = s.clubs.hfx.roster.filter((id) => !s.players[id].isPitcher && !d.lineup.battingOrder.some((x) => x.playerId === id));
    d = moveBatter(swapFromBench(d, 2, bench[0]), 0, 8);
    // Take today's closer out: a bench pitcher closes instead.
    const rested = d.plan.bullpen.closer!;
    const benchArm = s.clubs.hfx.roster.find((id) => s.players[id].isPitcher && pitcherPosition(s.players[id]) === 'RP' && !pitcherSlot(d, id))!;
    d = assignPitcher(s, d, 'closer', benchArm);
    const r = confirm(s, d);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    s = r.state;
    const m = s.matches[s.currentEvent!.resolution!.matchId!];
    const side = m.homeId === 'hfx' ? 'home' : 'away';
    expect(m.lineups[side].battingOrder).toEqual(d.lineup.battingOrder);
    expect(m.lineups[side].pitcherId).toBe(d.lineup.pitcherId);
    expect(m.pitchersUsed[side]).not.toContain(rested);
    expect(m.pitchersUsed[side].length).toBeLessThanOrEqual(4);
    // Today's slots are cleared after the game; the hook preference stays.
    expect(s.clubs.hfx.pitchingPlan).toEqual({ ...defaultPitchingPlan(), hook: d.plan.hook });
    // Confirming twice is a no-op.
    expect(confirm(s, d).ok).toBe(false);
  });

  it('rejects an invalid plan with a concrete message and charges nothing', () => {
    const s = toLeagueGame(newGame(33));
    const d = draftFromClub(s);
    const bad: LineupDraft = { ...d, plan: { ...d.plan, bullpen: { ...d.plan.bullpen, closer: d.lineup.pitcherId } } };
    const r = confirm(s, bad);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/two roles today/);
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

describe('batters: batting order, positions and the bench', () => {
  const s = newGame(34);
  const d = draftFromClub(s);
  const bench = s.clubs.hfx.roster.filter((id) => !s.players[id].isPitcher && !d.lineup.battingOrder.some((x) => x.playerId === id));
  const errors = (x: LineupDraft) => validateLineup(s, 'hfx', x.lineup).filter((i) => i.severity === 'error').map((i) => i.text);

  it('changing a position swaps with whoever had it, so every position stays filled once', () => {
    const target = d.lineup.battingOrder[4].position;
    const next = setPosition(d, 0, target);
    expect(next.lineup.battingOrder[0].position).toBe(target);
    expect(next.lineup.battingOrder[4].position).toBe(d.lineup.battingOrder[0].position);
    expect(new Set(next.lineup.battingOrder.map((x) => x.position)).size).toBe(9);
    expect(next.lineup.battingOrder.map((x) => x.playerId)).toEqual(d.lineup.battingOrder.map((x) => x.playerId));
  });

  it('a starter to the bench opens his spot (confirm is blocked) until someone comes in', () => {
    const out = benchBatter(d, 2);
    expect(openSpot(out)).toBe(2);
    expect(errors(out).join()).toMatch(/Batting spot 3 .* is open/);
    const back = swapFromBench(out, 2, bench[0]);
    expect(openSpot(back)).toBe(-1);
    expect(back.lineup.battingOrder[2]).toEqual({ playerId: bench[0], position: d.lineup.battingOrder[2].position });
    expect(errors(back)).toEqual([]);
  });
});

describe('two-step lineup', () => {
  it('step one checks the batters only; the starting pitcher belongs to step two', () => {
    const s = newGame(35);
    const d = draftFromClub(s);
    const noPitcher = { ...d.lineup, pitcherId: '' };
    expect(validateBatters(s, 'hfx', noPitcher).filter((i) => i.severity === 'error')).toEqual([]);
    expect(validateLineup(s, 'hfx', noPitcher).some((i) => /starting pitcher/.test(i.text))).toBe(true);
    const open = benchBatter(d, 0).lineup;
    expect(validateBatters(s, 'hfx', open).some((i) => i.severity === 'error' && /is open/.test(i.text))).toBe(true);
  });
});
