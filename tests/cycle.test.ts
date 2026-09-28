import { describe, expect, it } from 'vitest';
import { BALANCE } from '../src/balance/config';
import { execute, optionBlocker } from '../src/application/engine';
import { migrate } from '../src/application/migrations';
import { createRng } from '../src/domain/rng';
import type { GameState } from '../src/domain/state';
import { SCHEMA_VERSION } from '../src/domain/state';
import { getTemplate } from '../src/events/registry';
import { closeCycle, contribution, creditable, drift, incomeFor } from '../src/simulation/cycle';
import { buildSimTeam } from '../src/simulation/match';
import type { ActionKind } from '../src/domain/state';
import { newGame, run, T0 } from './helpers';

const resolve = (s: GameState, optionId: string) => run(s, { type: 'resolveEvent', eventId: s.currentEvent!.id, revision: s.revision, optionId, boostId: null });
const ack = (s: GameState) => run(s, { type: 'acknowledgeEvent', eventId: s.currentEvent!.id });
/** Takes the first option that needs no Influence and no cash and is allowed now (never an Influence option). */
function plain(s: GameState): GameState {
  const ev = s.currentEvent!;
  const o = ev.options.find((x) => x.cost.influence === 0 && x.cost.cash === 0 && optionBlocker(s, ev, x, null, T0) === null) ?? ev.options.find((x) => x.cost.influence === 0 && optionBlocker(s, ev, x, null, T0) === null)!;
  return ack(resolve(s, o.id));
}
function toRound1(s: GameState): GameState {
  for (let i = 0; i < 10 && s.calendar.round === 0; i++) s = plain(s);
  return s;
}
const act = (s: GameState, kind: ActionKind, target: string | null = null, option: string | null = null) =>
  execute(s, { type: 'managerAction', kind, target, option, revision: s.revision }, T0);

describe('satisfaction drift and Influence income (pure)', () => {
  it('contribution: 60 at 0, 120 at 75, 150 at 100; mixed 100/75/50 ≈ 121.67; smooth around 75', () => {
    expect(incomeFor(0, 0, 0).income).toBeCloseTo(60, 6);
    expect(incomeFor(75, 75, 75).income).toBeCloseTo(120, 6);
    expect(incomeFor(100, 100, 100).income).toBeCloseTo(150, 6);
    expect(incomeFor(100, 75, 50).income).toBeCloseTo(121.6667, 3);
    expect(contribution(74.9)).toBeLessThan(contribution(75));
    expect(contribution(75.1) - contribution(75)).toBeLessThan(0.1);
    for (let v = 0; v < 100; v += 0.5) expect(contribution(v + 0.5)).toBeGreaterThan(contribution(v));
  });

  it('drift: 50 → 51.25, 100 → 98.75, 75 stays, 25 → 27.5', () => {
    expect(50 + drift(50)).toBeCloseTo(51.25, 6);
    expect(100 + drift(100)).toBeCloseTo(98.75, 6);
    expect(75 + drift(75)).toBe(75);
    expect(25 + drift(25)).toBeCloseTo(27.5, 6);
  });

  it('cap: 350 + 120 credits 10; a migrated balance above the cap earns nothing and is never reduced', () => {
    expect(creditable(350, 120)).toBe(10);
    expect(creditable(400, 120)).toBe(0);
    expect(creditable(180, 120)).toBe(120);
  });
});

describe('closing a cycle', () => {
  it('all groups at 75: values stay 75 and income is exactly 120; the same cycle never closes twice', () => {
    const s = structuredClone(newGame(51));
    s.clubs.hfx.ownerConfidence = 75;
    s.clubs.hfx.fanSupport = 75;
    for (const id of s.clubs.hfx.roster) s.players[id].satisfaction = 75;
    s.influence = 100;
    const rec = closeCycle(s, 1, 1)!;
    expect(rec.income).toBeCloseTo(120, 6);
    expect(s.influence).toBeCloseTo(220, 6);
    expect(s.clubs.hfx.fanSupport).toBe(75);
    expect(closeCycle(s, 1, 1)).toBeNull();
    expect(s.influence).toBeCloseTo(220, 6);
  });

  it('20 cycles: neutral is stable, high support fades without upkeep, a pressed club still earns enough to act', () => {
    const run20 = (v: number) => {
      const s = structuredClone(newGame(52));
      s.clubs.hfx.ownerConfidence = v;
      s.clubs.hfx.fanSupport = v;
      for (const id of s.clubs.hfx.roster) s.players[id].satisfaction = v;
      s.influence = 0;
      let income = 0;
      for (let r = 1; r <= 20; r++) income += closeCycle(s, 1, r)!.income;
      return { s, income };
    };
    const neutral = run20(75);
    expect(neutral.s.clubs.hfx.fanSupport).toBe(75);
    expect(neutral.income).toBeCloseTo(2400, 6);
    const high = run20(95);
    expect(high.s.clubs.hfx.fanSupport).toBeLessThan(90);
    const pressed = run20(30);
    // Even a pressed club earns at least a pep talk's worth every cycle.
    expect(pressed.income / 20).toBeGreaterThan(BALANCE.actions.pepTalk.influence);
    expect(pressed.s.clubs.hfx.fanSupport).toBeGreaterThan(30);
  });

  it('an ongoing role problem keeps pulling one player down although the squad mean recovers', () => {
    const s = structuredClone(newGame(53));
    const p = s.clubs.hfx.roster[0];
    s.players[p].satisfaction = 40;
    // The bench penalty is applied by the match code (once per game); the close only adds drift.
    for (let r = 1; r <= 4; r++) {
      s.players[p].satisfaction -= 3;
      closeCycle(s, 1, r);
    }
    expect(s.players[p].satisfaction).toBeLessThan(40);
  });
});

describe('the match cycle in play', () => {
  it('a normal round is one club event, the league game and one media event: 3 Time, one close', () => {
    let s = toRound1(newGame(54, 'economy'));
    s.time.current = BALANCE.time.cap;
    const round = s.calendar.round;
    const phases: string[] = [];
    const logBefore = s.cycle.log.length;
    const t0 = s.time.current;
    const infBefore = s.influence;
    for (let i = 0; i < 10 && s.calendar.round === round; i++) {
      phases.push(s.currentEvent!.phase ?? '-');
      s = plain(s);
    }
    expect(phases).toEqual(['club', 'match', 'media']);
    expect(t0 - s.time.current).toBe(3);
    expect(s.cycle.log.length).toBe(logBefore + 1);
    const rec = s.cycle.log.at(-1)!;
    expect(rec.round).toBe(round);
    expect(s.influence - infBefore).toBeCloseTo(rec.credited, 6);
    expect(s.cycle.matchesPlayed).toBe(1);
  });

  it('several seasons play without ever opening a direct action; every round closes exactly once', () => {
    let s = newGame(55);
    const seasons = new Set<number>();
    for (let i = 0; i < 160; i++) {
      seasons.add(s.calendar.season);
      s = plain(s);
    }
    const ids = s.cycle.log.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(s.cycle.log.length).toBeGreaterThan(20);
    // No close is made for the season change itself: one per league round only.
    for (const r of s.cycle.log) expect(r.round).toBeGreaterThan(0);
    expect(seasons.size).toBeGreaterThan(1);
  });

  it('no Time before media: the match result stays and media simply waits', () => {
    let s = toRound1(newGame(56, 'economy'));
    s.time.current = BALANCE.time.cap;
    s = plain(s); // club
    s = plain(s); // match
    expect(s.currentEvent!.phase).toBe('media');
    const matches = Object.keys(s.matches).length;
    s.time.current = 0;
    const r = execute(s, { type: 'resolveEvent', eventId: s.currentEvent!.id, revision: s.revision, optionId: s.currentEvent!.options[0].id, boostId: null }, T0);
    expect(r.ok).toBe(false);
    expect(Object.keys(s.matches).length).toBe(matches);
    expect(s.cycle.lastClosedId).not.toBe(`c-${s.calendar.season}-${s.calendar.round}`);
  });

  it('a cash crisis after the paid club slot comes once as an extra event without Time or income', () => {
    let s = toRound1(newGame(57, 'economy'));
    s.time.current = BALANCE.time.cap;
    // The club slot is being decided while cash has just gone negative (e.g. by its own cost).
    s = structuredClone(s);
    s.clubs.hfx.cash = -5_000;
    const ev = s.currentEvent!;
    const o = ev.options.find((x) => x.cost.influence === 0 && x.cost.cash === 0 && optionBlocker(s, ev, x, null, T0) === null)!;
    s = resolve(s, o.id);
    s = ack(s);
    expect(s.currentEvent!.templateId).toBe('board_emergency');
    expect(s.currentEvent!.phase).toBe('extra');
    expect(s.currentEvent!.options.every((x) => x.cost.time === 0)).toBe(true);
    const t = s.time.current;
    const inf = s.influence;
    s = plain(s);
    expect(s.time.current).toBe(t);
    expect(s.influence).toBe(inf);
    expect(s.currentEvent!.phase).toBe('match');
  });
});

describe('direct actions', () => {
  it('pep talk: Influence only, no Time, no event slot; once per player per game; lifts him in the next game only', () => {
    const s = toRound1(newGame(58, 'economy'));
    const pid = s.clubs.hfx.lineup.battingOrder[0].playerId;
    const r = act(s, 'pepTalk', pid);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const n = r.state;
    expect(n.influence).toBe(s.influence - BALANCE.actions.pepTalk.influence);
    expect(n.time.current).toBe(s.time.current);
    expect(n.currentEvent).toEqual(s.currentEvent);
    expect(n.actions.log.at(-1)!.kind).toBe('pepTalk');
    expect(act(n, 'pepTalk', pid).ok).toBe(false);
    const team = buildSimTeam(n, 'hfx', n.clubs.hfx.lineup);
    const plainTeam = buildSimTeam(s, 'hfx', s.clubs.hfx.lineup);
    expect(team.batters[0].contact - plainTeam.batters[0].contact).toBe(BALANCE.actions.pepTalk.ratingBoost);
    // A repeated click with the old revision is rejected.
    expect(execute(n, { type: 'managerAction', kind: 'pepTalk', target: pid, option: null, revision: s.revision }, T0).ok).toBe(false);
    let m = n;
    for (let i = 0; i < 6 && m.cycle.matchesPlayed === 0; i++) m = plain(m);
    expect(m.actions.motivated).toEqual([]);
  });

  it('not enough Influence or an invalid target changes nothing', () => {
    const s = structuredClone(newGame(59));
    s.influence = 10;
    const pid = s.clubs.hfx.roster[0];
    const r = act(s, 'extraTraining', pid);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/Needs 60 Influence/);
    s.influence = 300;
    const other = s.clubs[s.clubOrder[1]].roster[0];
    expect(act(s, 'pepTalk', other).ok).toBe(false);
  });

  it('the event program and the direct program share one slot per player', () => {
    let s = toRound1(newGame(60));
    s.influence = 300;
    const f = (() => {
      // Force the prospect event for a benched prospect.
      const next = structuredClone(s);
      const rng = createRng(next.rngState);
      const t = getTemplate('individual_training_prospect');
      if (t.weight(next) === 0) return null;
      const d = t.build({ state: next, rng, season: next.calendar.season, round: next.calendar.round, gameId: null });
      const { candidates = [], rerollCost = null, ...rest } = d;
      next.currentEvent = { ...next.currentEvent!, ...rest, id: 'forced-x', templateId: t.id, type: t.type, status: 'pending', candidates, rerollCost, rerolled: false, resolution: null };
      return next;
    })();
    const pid = f ? String(f.currentEvent!.data.playerId) : s.clubs.hfx.roster[0];
    const r = act(f ?? s, 'extraTraining', pid);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    s = r.state;
    expect(act(s, 'recovery', pid).ok).toBe(false);
    if (f) {
      const program = s.currentEvent!.options.find((o) => o.id === 'program')!;
      expect(optionBlocker(s, s.currentEvent!, program, null, T0)).toMatch(/already has an individual program/);
    }
  });

  it('board meeting: cooldown of three games, shared season budget with the check-in, known outcome', () => {
    const s = structuredClone(newGame(61));
    s.influence = 360;
    s.clubs.hfx.ownerConfidence = 80;
    const r = act(s, 'boardMeeting', null, 'funding');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.clubs.hfx.cash).toBe(s.clubs.hfx.cash + BALANCE.actions.boardMeeting.funding);
    const again = act(r.state, 'boardMeeting', null, 'present');
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.error).toMatch(/meet again in 3 games/);
    const later = structuredClone(r.state);
    later.cycle.matchesPlayed += 3;
    later.actions.boardFunding.granted = BALANCE.board.fundingPerSeason;
    const noMoney = act(later, 'boardMeeting', null, 'funding');
    expect(noMoney.ok).toBe(false);
    expect(act(later, 'boardMeeting', null, 'present').ok).toBe(true);
  });

  it('fundraiser: one campaign, paid once as earmarked credit that only a facility upgrade uses', () => {
    let s = toRound1(newGame(62));
    s = structuredClone(s);
    s.influence = 360;
    const r = act(s, 'fundraiser');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    s = r.state;
    expect(act(s, 'fundraiser').ok).toBe(false);
    const cash = s.clubs.hfx.cash;
    for (let i = 0; i < 20 && s.cycle.matchesPlayed < BALANCE.actions.fundraiser.duration; i++) s = plain(s);
    expect(s.actions.fundraiser).toBeNull();
    expect(s.actions.earmarked).toBeGreaterThan(0);
    const earmarked = s.actions.earmarked;
    // Not free cash: the balance only moved with normal finances.
    expect(s.ledger.some((l) => /fundraiser/i.test(l.note) && l.amount > 0)).toBe(false);
    s.influence = 360;
    s.clubs.hfx.ownerConfidence = 80;
    s.clubs.hfx.cash = Math.max(s.clubs.hfx.cash, 200_000);
    const before = s.clubs.hfx.cash;
    const up = run(s, { type: 'upgradeFacility', facility: 'training', revision: s.revision });
    expect(before - up.clubs.hfx.cash).toBe(BALANCE.facilities.cost.training[0] - Math.min(earmarked, BALANCE.facilities.cost.training[0]));
    expect(up.actions.earmarked).toBe(Math.max(0, earmarked - BALANCE.facilities.cost.training[0]));
    void cash;
  });

  it('community initiative and the fan forum share one cooldown', () => {
    let s = toRound1(newGame(63));
    s = structuredClone(s);
    s.influence = 300;
    const r = act(s, 'communityInitiative');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const next = structuredClone(r.state);
    const t = getTemplate('fans_ticket_prices');
    const rng = createRng(next.rngState);
    const d = t.build({ state: next, rng, season: next.calendar.season, round: next.calendar.round, gameId: null });
    const { candidates = [], rerollCost = null, ...rest } = d;
    next.currentEvent = { ...next.currentEvent!, ...rest, id: 'forced-y', templateId: t.id, type: t.type, status: 'pending', candidates, rerollCost, rerolled: false, resolution: null };
    const forum = next.currentEvent.options.find((o) => o.id === 'forum')!;
    expect(optionBlocker(next, next.currentEvent, forum, null, T0)).toMatch(/fan gathering/);
  });
});

describe('migration to the Influence scale', () => {
  it('converts once (×10), keeps a balance above the cap, and running it again changes nothing', () => {
    const v7 = JSON.parse(JSON.stringify(newGame(64)));
    v7.schemaVersion = 7;
    v7.influence = 45;
    delete v7.cycle;
    delete v7.actions;
    for (const o of v7.currentEvent.options) o.cost.influence = 2;
    const m = migrate(v7);
    expect(m.schemaVersion).toBe(SCHEMA_VERSION);
    expect(m.influence).toBe(450);
    expect(m.currentEvent!.options[0].cost.influence).toBe(20);
    expect(m.cycle.log).toEqual([]);
    // Above the cap: kept, and a close credits nothing.
    const again = migrate(JSON.parse(JSON.stringify(m)));
    expect(again.influence).toBe(450);
    closeCycle(again, again.calendar.season, 5);
    expect(again.influence).toBe(450);
  });
});
