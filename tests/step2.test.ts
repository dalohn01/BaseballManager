import { describe, expect, it } from 'vitest';
import { BALANCE } from '../src/balance/config';
import { execute, optionBlocker } from '../src/application/engine';
import { migrate } from '../src/application/migrations';
import { createRng } from '../src/domain/rng';
import { listForTransfer, playerAt, putInSlot, replacementFor, settleTransferList, slotOf } from '../src/domain/squad';
import type { GameState } from '../src/domain/state';
import { absoluteRound, SCHEMA_VERSION } from '../src/domain/state';
import { getTemplate, TEMPLATES } from '../src/events/registry';
import { roundShare, salaryDue } from '../src/simulation/economy';
import { newGame, playSeason, run, step, T0 , expectValidSquads } from './helpers';

/**
 * Replaces the current event with a fresh instance of the given template,
 * bypassing eligibility (the planner would otherwise substitute a valid event).
 */
function force(s: GameState, templateId: string): GameState {
  const next = structuredClone(s);
  const rng = createRng(next.rngState);
  const draft = getTemplate(templateId).build({ state: next, rng, season: next.calendar.season, round: next.calendar.round, gameId: null });
  const { candidates = [], rerollCost = null, ...rest } = draft;
  next.currentEvent = {
    ...next.currentEvent!,
    ...rest,
    id: `forced-${next.nextId++}`,
    templateId,
    type: getTemplate(templateId).type,
    status: 'pending',
    candidates,
    rerollCost,
    rerolled: false,
    resolution: null,
  };
  next.rngState = rng.getState();
  return next;
}

function resolve(s: GameState, optionId: string, boostId: string | null = null) {
  const ev = s.currentEvent!;
  return run(s, { type: 'resolveEvent', eventId: ev.id, revision: s.revision, optionId, boostId });
}

const checkInvariants = (s: GameState) => expectValidSquads(s);

describe('content coverage', () => {
  it('has all 12 original event types and at least 18 templates', () => {
    const types = new Set(TEMPLATES.map((t) => t.type));
    for (const t of ['leagueGame', 'teamTraining', 'individualTraining', 'draft', 'freeAgent', 'tryouts', 'media', 'boardMeeting', 'fanInteraction', 'facility', 'trade', 'sponsor']) {
      expect(types.has(t as never), t).toBe(true);
    }
    expect(TEMPLATES.filter((t) => t.type !== 'seasonReview').length).toBeGreaterThanOrEqual(18);
  });

  it('every management template shows up across seeded seasons, and rosters stay valid', () => {
    const seen = new Set<string>();
    for (let seed = 300; seed < 330; seed++) {
      const s = playSeason(newGame(seed), seed);
      s.history.forEach((h) => seen.add(h.templateId));
      checkInvariants(s);
    }
    // Conditional templates (low moods, off-track goals) are covered by forced tests in step3.test.ts.
    const conditional = ['board_ultimatum', 'trade_request', 'fans_protest', 'board_course_change'];
    // Legacy templates (weight 0), kept only for events already in older saves: facility_expansion,
    // and individual_training_prospect (a benched prospect; the fixed squad has no bench).
    const expected = TEMPLATES.filter((t) => t.slot === 'management' && !t.urgent && !conditional.includes(t.id) && !['facility_expansion', 'individual_training_prospect'].includes(t.id)).map((t) => t.id);
    for (const id of expected) expect(seen.has(id), id).toBe(true);
    expect(seen.has('draft')).toBe(true);
  }, 120_000);
});

describe('recruitment', () => {
  it('re-scouting costs Influence but no Time, happens once and saves new candidates', () => {
    let s = force(newGame(1, 'economy'), 'free_agent');
    const ev = s.currentEvent!;
    const before = { time: s.time.current, inf: s.influence, ids: ev.candidates.map((c) => c.id) };
    s = run(s, { type: 'rerollCandidates', eventId: ev.id, revision: s.revision });
    expect(s.influence).toBe(before.inf - BALANCE.influence.rerollCost);
    expect(s.time.current).toBe(before.time);
    expect(s.currentEvent!.candidates.map((c) => c.id)).not.toEqual(before.ids);
    expect(s.currentEvent!.options.every((o) => !o.candidateId || s.currentEvent!.candidates.some((c) => c.id === o.candidateId))).toBe(true);
    const again = execute(s, { type: 'rerollCandidates', eventId: ev.id, revision: s.revision }, T0);
    expect(again.ok).toBe(false);
  });

  it('a signed player joins once, takes a place and is paid from the next round; the replaced player is listed', () => {
    let s = force(newGame(2), 'free_agent');
    const opt = s.currentEvent!.options.find((o) => o.candidateId)!;
    const cash = s.clubs.hfx.cash;
    const cand = s.currentEvent!.candidates.find((c) => c.id === opt.candidateId)!;
    const { slot, outId } = replacementFor(s, 'hfx', cand);
    s = resolve(s, opt.id);
    const p = s.players[opt.candidateId!];
    expect(s.clubs.hfx.roster.filter((id) => id === p.id)).toHaveLength(1);
    expect(playerAt(s, 'hfx', slot)).toBe(p.id);
    expect(s.clubs.hfx.transferList?.map((x) => x.playerId)).toContain(outId);
    expect(s.players[outId!].clubId).toBe('hfx');
    expect(s.clubs.hfx.cash).toBe(cash - opt.cost.cash);
    const r = s.calendar.round;
    expect(salaryDue(s, p.id, 1, r)).toBe(0);
    expect(salaryDue(s, p.id, 1, r + 1)).toBe(roundShare(p.contract.salary, r + 1));
    checkInvariants(s);
  });

  it('a listed player is sold to an AI club for a fee or released when the listing runs out', () => {
    let s = structuredClone(newGame(3));
    const out = s.clubs.hfx.lineup.battingOrder[0].playerId;
    listForTransfer(s, 'hfx', out);
    putInSlot(s, 'hfx', slotOf(s, 'hfx', out)!, null);
    const cash = s.clubs.hfx.cash;
    const rng = createRng(1);
    for (let i = 0; i <= BALANCE.transfer.listRounds && (s.clubs.hfx.transferList ?? []).length; i++) {
      s.calendar = { ...s.calendar, round: s.calendar.round + 1 };
      settleTransferList(s, rng);
    }
    const p = s.players[out];
    expect((s.clubs.hfx.transferList ?? []).length).toBe(0);
    if (p.clubId) {
      expect(p.clubId).not.toBe('hfx');
      expect(s.clubs.hfx.cash).toBeGreaterThan(cash);
    } else expect(s.clubs.hfx.cash).toBe(cash);
  });
});

describe('trades', () => {
  it('moves players and contracts without copies and keeps both squads valid', () => {
    let s = force(newGame(4), 'trade_veteran');
    const ev = s.currentEvent!;
    const { outId, inId, partnerId } = ev.data as Record<string, string>;
    const total = Object.keys(s.players).length;
    s = resolve(s, 'accept');
    expect(s.players[outId].clubId).toBe(partnerId);
    expect(s.players[inId].clubId).toBe('hfx');
    expect(s.clubs[partnerId].roster).toContain(outId);
    expect(Object.keys(s.players)).toHaveLength(total);
    expect(s.players[inId].contract.startRound).toBe(absoluteRound(1, s.calendar.round));
    checkInvariants(s);
  });
});

describe('economy safety net', () => {
  it('negative cash blocks voluntary spending and triggers an urgent, payable recovery event', () => {
    let s = structuredClone(newGame(5));
    s.clubs.hfx.cash = -10_000;
    s = force(s, 'fans_ticket_prices');
    const forum = s.currentEvent!.options.find((o) => o.id === 'forum')!;
    expect(optionBlocker(s, s.currentEvent!, forum, null, T0)).toMatch(/negative/);
    // Play until the next round plans its events.
    for (let i = 0; i < 6 && s.currentEvent!.templateId !== 'board_emergency'; i++) s = step(s, i);
    expect(s.currentEvent!.templateId).toBe('board_emergency');
    expect(s.currentEvent!.options.every((o) => optionBlocker(s, s.currentEvent!, o, null, T0) === null)).toBe(true);
  });

  it('legacy facility projects from older saves still complete after their build rounds', () => {
    let s = structuredClone(newGame(6));
    s.clubs.hfx.project = { facility: 'training', toLevel: 2, startedRound: 0, completesRound: 3, cost: 80_000 };
    const done = s.clubs.hfx.project.completesRound;
    let guard = 0;
    while (s.clubs.hfx.project && guard++ < 30) s = step(s, guard);
    expect(s.clubs.hfx.facilities.training).toBe(2);
    expect(absoluteRound(s.calendar.season, s.calendar.round)).toBeGreaterThanOrEqual(done);
  });

  it('only a transfer-listed player can be released early, with a buyout; squad players cannot', () => {
    const s = structuredClone(newGame(7));
    const squad = s.clubs.hfx.roster[0];
    expect(execute(s, { type: 'releasePlayer', playerId: squad }, T0).ok).toBe(false);
    listForTransfer(s, 'hfx', squad);
    const r = execute(s, { type: 'releasePlayer', playerId: squad }, T0);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.state.players[squad].clubId).toBe('');
      expect(r.state.clubs.hfx.cash).toBeLessThan(s.clubs.hfx.cash);
    }
  });
});

describe('migration', () => {
  it('upgrades a v1 save without losing progress', () => {
    // v1 had no frozen candidates: start from an event that does not need any.
    let seed = 8;
    let s = step(newGame(seed), 1);
    while (s.currentEvent!.candidates.length > 0) s = step(newGame(++seed), 1);
    const v1 = JSON.parse(JSON.stringify(s));
    v1.schemaVersion = 1;
    for (const p of Object.values(v1.players) as { contract: Record<string, unknown> }[]) delete p.contract.startRound;
    for (const c of Object.values(v1.clubs) as Record<string, unknown>[]) {
      delete c.project;
      delete c.publicStance;
    }
    delete v1.currentEvent.candidates;
    const m = migrate(v1);
    expect(m.schemaVersion).toBe(SCHEMA_VERSION);
    expect(m.currentEvent!.candidates).toEqual([]);
    expect(m.history).toEqual(s.history);
    expect(step(m, 2).revision).toBe(s.revision + 2);
  });
});
