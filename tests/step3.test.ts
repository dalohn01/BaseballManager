import { describe, expect, it } from 'vitest';
import { BALANCE } from '../src/balance/config';
import { execute, optionBlocker } from '../src/application/engine';
import { migrate } from '../src/application/migrations';
import { createRng } from '../src/domain/rng';
import { squadProblem } from '../src/domain/roster';
import type { GameState } from '../src/domain/state';
import { absoluteRound, SCHEMA_VERSION } from '../src/domain/state';
import { getTemplate } from '../src/events/registry';
import { describeLineupChange, leagueGameOptionNotes, lineupForChoice } from '../src/events/templates/leagueGame';
import { lossExpectation } from '../src/simulation/round';
import { expiringPlayers, renewalTerms, startNextSeason } from '../src/simulation/season';
import { newGame, playSeason, run, T0 } from './helpers';

function force(s: GameState, templateId: string): GameState {
  const next = structuredClone(s);
  const rng = createRng(next.rngState);
  const draft = getTemplate(templateId).build({ state: next, rng, season: next.calendar.season, round: next.calendar.round, gameId: null });
  const { candidates = [], rerollCost = null, ...rest } = draft;
  next.currentEvent = { ...next.currentEvent!, ...rest, id: `forced-${next.nextId++}`, templateId, type: getTemplate(templateId).type, status: 'pending', candidates, rerollCost, rerolled: false, resolution: null };
  next.rngState = rng.getState();
  return next;
}

const resolve = (s: GameState, optionId: string) => run(s, { type: 'resolveEvent', eventId: s.currentEvent!.id, revision: s.revision, optionId, boostId: null });
const ack = (s: GameState) => run(s, { type: 'acknowledgeEvent', eventId: s.currentEvent!.id });

/** Conservative play: the league game uses the saved lineup, other events take the last (usually "leave it") option. */
function calmStep(s: GameState, beforeGame?: (s: GameState) => GameState): GameState {
  const ev = s.currentEvent!;
  if (ev.type === 'leagueGame' && beforeGame) s = beforeGame(s);
  const cur = s.currentEvent!;
  const options = cur.type === 'leagueGame' ? cur.options.filter((o) => o.id === 'current') : [...cur.options].reverse();
  const opt = options.find((o) => optionBlocker(s, cur, o, null, T0) === null)!;
  return ack(resolve(s, opt.id));
}

/** Moves past preseason into round 1 with a balanced plan. */
function toRound1(s: GameState): GameState {
  s = ack(resolve(s, 'balanced'));
  while (s.calendar.round === 0) s = calmStep(s);
  return s;
}

function checkInvariants(s: GameState) {
  const seen = new Set<string>();
  for (const id of s.clubOrder) {
    for (const pid of s.clubs[id].roster) {
      expect(seen.has(pid)).toBe(false);
      seen.add(pid);
      expect(s.players[pid].clubId).toBe(id);
      expect(s.players[pid].contract.seasonsLeft).toBeGreaterThan(0);
    }
    expect(squadProblem(s, s.clubs[id].roster)).toBeNull();
    expect(s.clubs[id].roster.length).toBeGreaterThanOrEqual(BALANCE.offseason.minRosterSize);
  }
}

describe('two consecutive seasons', () => {
  it('50 seeded careers finish two seasons with contracts, draft and a valid next squad', () => {
    for (let seed = 500; seed < 550; seed++) {
      let s = newGame(seed);
      s = playSeason(s, seed);
      checkInvariants(s);
      s = playSeason(s, seed + 7);
      expect(s.calendar).toMatchObject({ season: 3, round: 0, phase: 'preseason' });
      expect(s.seasonSummaries).toHaveLength(2);
      expect(s.schedule.filter((g) => g.season === 3)).toHaveLength(60);
      checkInvariants(s);
      expect(s.history.some((h) => h.templateId === 'draft' && h.season === 2)).toBe(true);
    }
  }, 300_000);
});

describe('chain 1: promise of starts', () => {
  function withPromise(seed: number) {
    let s = toRound1(newGame(seed));
    s = force(s, 'individual_training_prospect');
    const ev = s.currentEvent!;
    s = ack(resolve(s, 'promise'));
    const pr = s.promises[s.promises.length - 1];
    expect(pr.originEventId).toBe(ev.id);
    return { s, pr };
  }

  it('is kept when he actually starts, and a follow-up event arrives next round', () => {
    let { s, pr } = withPromise(11);
    for (let i = 0; i < 20 && s.promises.find((p) => p.id === pr.id)!.status === 'active'; i++) s = calmStep(s);
    const closed = s.promises.find((p) => p.id === pr.id)!;
    expect(closed.status).toBe('kept');
    expect(closed.progress).toBeGreaterThanOrEqual(closed.threshold);
    const roundKept = closed.closedAt!.round;
    for (let i = 0; i < 6 && s.currentEvent!.templateId !== 'promise_followup'; i++) s = calmStep(s);
    expect(s.currentEvent!.templateId).toBe('promise_followup');
    expect(s.currentEvent!.round).toBeLessThanOrEqual(roundKept + 1);
    expect(s.currentEvent!.context).toContain(`round ${pr.madeAt.round}`);
  });

  it('is broken when he is benched, with a real consequence', () => {
    let { s, pr } = withPromise(12);
    const bench = (st: GameState) => {
      const club = st.clubs[st.userClubId];
      if (!club.lineup.battingOrder.some((x) => x.playerId === pr.playerId)) return st;
      const lineup = structuredClone(club.lineup);
      lineup.battingOrder.find((x) => x.playerId === pr.playerId)!.playerId = pr.rivalId!;
      return run(st, { type: 'setLineup', lineup });
    };
    const satBefore = s.players[pr.playerId].satisfaction;
    for (let i = 0; i < 20 && s.promises.find((p) => p.id === pr.id)!.status === 'active'; i++) s = calmStep(s, bench);
    const closed = s.promises.find((p) => p.id === pr.id)!;
    expect(closed.status).toBe('broken');
    const lastGame = s.history.filter((h) => h.type === 'leagueGame').pop()!;
    expect(lastGame.effects.some((e) => e.targetId === pr.playerId && e.stat === 'satisfaction' && e.after - e.before <= BALANCE.promises.broken)).toBe(true);
    expect(s.players[pr.playerId].satisfaction).toBeLessThan(satBefore);
    expect(s.followUps.some((f) => f.data.promiseId === pr.id) || s.currentEvent!.templateId === 'promise_followup' || s.nextEvent?.templateId === 'promise_followup').toBe(true);
  });
});

describe('pre-match choices explain themselves', () => {
  it('shows concrete lineup changes, real resting and promise warnings', () => {
    let s = structuredClone(toRound1(newGame(21)));
    s = run(s, { type: 'autoLineup', mode: 'strongest' });
    expect(leagueGameOptionNotes(s, 'strongest').map((n) => n.text)).toContain('Same as your lineup');

    for (const id of s.clubs.hfx.roster) s.players[id].fitness = 100;
    expect(leagueGameOptionNotes(s, 'rest').map((n) => n.text)).toContain(`Everyone at ${BALANCE.fitness.restBelow}%+ fitness`);

    // Bench a promised player in the saved lineup: "Your lineup" must warn.
    s = force(s, 'individual_training_prospect');
    s = ack(resolve(s, 'promise'));
    const pr = s.promises[s.promises.length - 1];
    const lineup = structuredClone(s.clubs.hfx.lineup);
    lineup.battingOrder.find((x) => x.playerId === pr.playerId)!.playerId = pr.rivalId!;
    s = run(s, { type: 'setLineup', lineup });
    const warn = leagueGameOptionNotes(s, 'current').find((n) => n.text.includes(s.players[pr.playerId].lastName));
    expect(warn?.tone).toBe('negative');
    expect(warn?.text).toMatch(/misses a promised start|Breaks the promise/);
    // The strongest lineup lists who changes compared with the saved one.
    const diff = describeLineupChange(s, s.clubs.hfx.lineup, lineupForChoice(s, 'strongest'));
    expect(leagueGameOptionNotes(s, 'strongest').some((n) => diff.slice(0, 4).includes(n.text) || n.text === 'Same as your lineup')).toBe(true);
  });
});

describe('chain 2: public message → fan reaction → evaluation', () => {
  it('a rebuild message softens losses and is revisited by the press', () => {
    let s = toRound1(newGame(13));
    expect(lossExpectation(s).multiplier).toBe(1);
    s = force(s, 'media_expectations');
    s = ack(resolve(s, 'patience'));
    expect(lossExpectation(s).multiplier).toBe(BALANCE.stance.patienceLossMultiplier);
    const fu = s.followUps.find((f) => f.templateId === 'media_stance_review')!;
    expect(fu.dueRound).toBe(absoluteRound(1, 1 + BALANCE.stance.reviewAfterRounds));
    for (let i = 0; i < 25 && s.currentEvent!.templateId !== 'media_stance_review'; i++) s = calmStep(s);
    expect(s.currentEvent!.templateId).toBe('media_stance_review');
    expect(s.currentEvent!.round).toBeLessThanOrEqual(1 + BALANCE.stance.reviewAfterRounds + 1);
    expect(s.currentEvent!.context).toContain('Round 1');
  });
});

describe('chain 3: training investment → facility → training result', () => {
  it('the first session after completion shows the facility contribution', () => {
    let s = toRound1(newGame(14));
    s = force(s, 'facility_expansion');
    s = ack(resolve(s, 'build:training'));
    for (let i = 0; i < 30 && s.currentEvent!.title !== 'Training in the New Center'; i++) s = calmStep(s);
    expect(s.currentEvent!.title).toBe('Training in the New Center');
    s = resolve(s, 'batting');
    expect(s.currentEvent!.resolution!.narrative.join(' ')).toMatch(/Training Center level 2 contributed \d+/);
  });
});

describe('season plan and owners', () => {
  it('different directions have different consequences', () => {
    const base = newGame(15);
    const win = resolve(base, 'winNow');
    const rebuild = resolve(base, 'rebuild');
    expect(win.clubs.hfx.cash - base.clubs.hfx.cash).toBe(BALANCE.seasonPlan.winNow.budget);
    expect(rebuild.clubs.hfx.cash).toBe(base.clubs.hfx.cash);
    expect(lossExpectation(win).multiplier).toBeGreaterThan(1);
    expect(lossExpectation(rebuild).multiplier).toBeLessThan(1);
  });

  it('the season review evaluates the goal against actual results', () => {
    let s = resolve(newGame(16), 'winNow');
    s = ack(s);
    s = playSeason(s, 16);
    const sum = s.seasonSummaries[0];
    // The plan may have changed mid-season; the verdict must match the final goal's actual numbers ("Wins 11/12, ...").
    const items = sum.goalText.split(', ').map((x) => x.match(/([\d,$]+)\/([\d,$]+)$/)!.slice(1).map((n) => Number(n.replace(/[$,]/g, ''))));
    expect(sum.goalMet).toBe(items.every(([cur, target]) => cur >= target));
    expect(sum.wins + sum.losses).toBe(20);
  }, 60_000);
});

describe('low values have different, payable consequences', () => {
  it('an unhappy player asks for a trade; unhappy owners impose a freeze; unhappy fans protest', () => {
    let s = structuredClone(toRound1(newGame(17)));
    s.players.p2.satisfaction = 20;
    expect(getTemplate('trade_request').weight(s)).toBeGreaterThan(0);
    s.clubs.hfx.ownerConfidence = 30;
    expect(getTemplate('board_ultimatum').weight(s)).toBeGreaterThan(0);
    s.clubs.hfx.fanSupport = 30;
    expect(getTemplate('fans_protest').weight(s)).toBeGreaterThan(0);

    for (const id of ['trade_request', 'board_ultimatum', 'fans_protest']) {
      const f = force(s, id);
      expect(f.currentEvent!.options.some((o) => o.cost.cash === 0 && o.cost.influence === 0 && optionBlocker(f, f.currentEvent!, o, null, T0) === null)).toBe(true);
    }

    let frozen = ack(resolve(force(s, 'board_ultimatum'), 'freeze'));
    frozen = force(frozen, 'free_agent');
    const sign = frozen.currentEvent!.options.find((o) => o.candidateId)!;
    expect(optionBlocker(frozen, frozen.currentEvent!, sign, null, T0)).toMatch(/freeze/);
  });
});

describe('contracts', () => {
  it('willing players re-sign with a raise, unhappy ones refuse, and holes are filled', () => {
    let s = newGame(18);
    let guard = 0;
    while (s.currentEvent!.templateId !== 'contracts' && s.calendar.season === 1 && guard++ < 200) s = calmStep(s);
    expect(s.currentEvent!.templateId).toBe('contracts');
    s = structuredClone(s);
    const exp = expiringPlayers(s, 'hfx');
    exp[0].satisfaction = 20; // will refuse
    const willing = exp.slice(1).filter((p) => p.satisfaction >= BALANCE.offseason.renewalMinSatisfaction);
    const asks = new Map(willing.map((p) => [p.id, renewalTerms(p).salary]));
    for (const p of willing) {
      const ratio = asks.get(p.id)! / p.contract.salary;
      expect(ratio).toBeGreaterThanOrEqual(BALANCE.offseason.renewalBand[0] - 0.02);
      expect(ratio).toBeLessThanOrEqual(BALANCE.offseason.renewalBand[1] * (1 + BALANCE.offseason.renewalMoneyPremium) + 0.02);
    }
    s = ack(resolve(s, 'all'));
    for (const p of willing) expect(s.players[p.id].contract.salary).toBe(asks.get(p.id));
    while (s.calendar.season === 1) s = calmStep(s);
    expect(s.players[exp[0].id].clubId).toBe('');
    for (const p of willing) expect(s.players[p.id].clubId).toBe('hfx');
    checkInvariants(s);
  }, 60_000);
});

describe('off-season squad completion', () => {
  it('rebuilds a full valid squad even when every contract ends at once', () => {
    const s = structuredClone(newGame(23));
    for (const id of s.clubs.hfx.roster) s.players[id].contract.seasonsLeft = 1;
    startNextSeason(s, createRng(5));
    expect(s.clubs.hfx.roster.length).toBeGreaterThanOrEqual(BALANCE.offseason.minRosterSize);
    expect(squadProblem(s, s.clubs.hfx.roster)).toBeNull();
  });
});

describe('migration v3 → v4 (fatigue → fitness)', () => {
  it('converts fatigue to fitness percent and keeps playing', () => {
    const s = newGame(22);
    const v3 = JSON.parse(JSON.stringify(s));
    v3.schemaVersion = 3;
    for (const p of Object.values(v3.players) as Record<string, unknown>[]) {
      delete p.fitness;
      p.fatigue = 30;
    }
    const m = migrate(v3);
    expect(m.schemaVersion).toBe(SCHEMA_VERSION);
    for (const p of Object.values(m.players)) {
      expect(p.fitness).toBe(88);
      expect('fatigue' in p).toBe(false);
    }
    expect(execute(m, { type: 'resolveEvent', eventId: m.currentEvent!.id, revision: m.revision, optionId: 'balanced', boostId: null }, T0).ok).toBe(true);
  });
});

describe('migration v2 → v3', () => {
  it('a finished v2 season continues into the next preseason', () => {
    const s = playSeason(newGame(19), 19);
    const v2 = JSON.parse(JSON.stringify(s));
    v2.schemaVersion = 2;
    v2.calendar = { season: 1, round: 20, slot: 4, phase: 'seasonComplete' };
    v2.currentEvent = null;
    v2.nextEvent = null;
    delete v2.promises;
    delete v2.followUps;
    delete v2.seasonSummaries;
    const m = migrate(v2);
    expect(m.schemaVersion).toBe(SCHEMA_VERSION);
    expect(m.calendar.phase).toBe('preseason');
    expect(m.currentEvent!.templateId).toBe('season_plan');
    expect(execute(m, { type: 'resolveEvent', eventId: m.currentEvent!.id, revision: m.revision, optionId: 'balanced', boostId: null }, T0).ok).toBe(true);
  }, 60_000);
});
