import { describe, expect, it } from 'vitest';
import { BALANCE } from '../src/balance/config';
import { execute } from '../src/application/engine';
import { migrate } from '../src/application/migrations';
import { createRng } from '../src/domain/rng';
import type { GameState } from '../src/domain/state';
import { SCHEMA_VERSION } from '../src/domain/state';
import { getTemplate } from '../src/events/registry';
import { projectedAttendance } from '../src/simulation/economy';
import { addModifier, MAX_FACILITY_LEVEL, trainingModifier, upgradeBlocker, upgradePrice } from '../src/simulation/facilities';
import { newGame, run, step, T0, toNextEvent } from './helpers';

const upgrade = (s: GameState, facility: 'training' | 'scouting' | 'stadium') => execute(s, { type: 'upgradeFacility', facility, revision: s.revision }, T0);

function force(s: GameState, templateId: string): GameState {
  const next = structuredClone(toNextEvent(s));
  const rng = createRng(next.rngState);
  const draft = getTemplate(templateId).build({ state: next, rng, season: next.calendar.season, round: next.calendar.round, gameId: null });
  const { candidates = [], rerollCost = null, ...rest } = draft;
  next.currentEvent = { ...next.currentEvent!, ...rest, id: `forced-${next.nextId++}`, templateId, type: getTemplate(templateId).type, status: 'pending', candidates, rerollCost, rerolled: false, resolution: null };
  next.rngState = rng.getState();
  return next;
}
const resolve = (s: GameState, optionId: string) => run(s, { type: 'resolveEvent', eventId: s.currentEvent!.id, revision: s.revision, optionId, boostId: null });
const ack = (s: GameState) => run(s, { type: 'acknowledgeEvent', eventId: s.currentEvent!.id });

/** Plays events until one more league game has been played. */
function playOneGame(s: GameState): GameState {
  const played = Object.keys(s.matches).length;
  for (let i = 0; i < 40 && Object.keys(s.matches).length === played; i++) s = step(s, 900 + i);
  return s;
}

describe('direct facility upgrades', () => {
  it('charges cash and Influence once, raises the level, logs it and costs no Time or event', () => {
    const s = newGame(21, 'economy');
    const price = BALANCE.facilities.cost.training[0];
    const r = upgrade(s, 'training');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const n = r.state;
    expect(n.clubs.hfx.facilities.training).toBe(2);
    expect(n.clubs.hfx.cash).toBe(s.clubs.hfx.cash - price);
    expect(n.time.current).toBe(s.time.current);
    // Starting a build is a manager initiative: Influence, never Time.
    expect(n.influence).toBe(s.influence - BALANCE.actions.facilityUpgrade.influence);
    expect(n.currentEvent).toEqual(s.currentEvent);
    expect(n.ledger.at(-1)).toMatchObject({ category: 'facility', amount: -price });
    // A repeated click carries the old revision and is rejected: no second purchase.
    const again = execute(n, { type: 'upgradeFacility', facility: 'training', revision: s.revision }, T0);
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.code).toBe('stale');
  });

  it('explains why an upgrade is unavailable', () => {
    const s = structuredClone(newGame(22));
    s.clubs.hfx.facilities.stadium = MAX_FACILITY_LEVEL;
    expect(upgradeBlocker(s, 'stadium')).toMatch(/Max level/);
    s.clubs.hfx.cash = 10_000;
    expect(upgradeBlocker(s, 'training')).toMatch(/Not enough Club Cash: needs \$80,000/);
    const r = upgrade(s, 'training');
    expect(r.ok || r.code).toBe('unaffordable');
    s.clubs.hfx.cash = 500_000;
    s.clubs.hfx.ownerConfidence = 30;
    expect(upgradeBlocker(s, 'training')).toMatch(/owners must back/);
    s.clubs.hfx.ownerConfidence = 70;
    s.clubs.hfx.spendingFreezeUntil = 99;
    expect(upgradeBlocker(s, 'training')).toMatch(/spending freeze/);
    s.clubs.hfx.spendingFreezeUntil = 0;
    expect(upgradeBlocker(s, 'training')).toBeNull();
  });

  it('the new level changes real mechanics (capacity, training)', () => {
    const s = structuredClone(newGame(23));
    s.clubs.hfx.fanBase = 50_000; // demand above capacity
    const before = projectedAttendance(s.clubs.hfx);
    const n = run(s, { type: 'upgradeFacility', facility: 'stadium', revision: s.revision });
    expect(before).toBe(BALANCE.economy.stadiumCapacity[0]);
    expect(projectedAttendance(n.clubs.hfx)).toBe(BALANCE.economy.stadiumCapacity[1]);
  });
});

describe('facility happenings', () => {
  it('sponsor discount: shown as a modifier, lowers the price once, then is used up', () => {
    let s = force(newGame(24), 'facility_sponsor_discount');
    const id = s.currentEvent!.data.facility as 'stadium';
    s = ack(resolve(s, 'accept'));
    const mod = s.clubs.hfx.modifiers[0];
    expect(mod).toMatchObject({ facility: id, kind: 'upgradeDiscount', matchesLeft: BALANCE.facilities.happenings.sponsorMatches });
    // The level itself did not change.
    expect(s.clubs.hfx.facilities[id]).toBe(1);
    const list = BALANCE.facilities.cost[id][0];
    expect(upgradePrice(s.clubs.hfx, id)).toBe(Math.round(list * 0.8));
    const n = run(s, { type: 'upgradeFacility', facility: id, revision: s.revision });
    expect(n.clubs.hfx.cash).toBe(s.clubs.hfx.cash - Math.round(list * 0.8));
    expect(n.clubs.hfx.modifiers).toHaveLength(0);
    expect(upgradePrice(n.clubs.hfx, id)).toBe(BALANCE.facilities.cost[id][1]);
  });

  it('modifiers count down one per league game and are removed when they expire', () => {
    let s = structuredClone(newGame(25));
    addModifier(s, 'hfx', { facility: 'stadium', kind: 'capacityCut', value: 0.25, label: 'Floodlight failure', source: 'test', matchesLeft: 2 });
    addModifier(s, 'hfx', { facility: 'training', kind: 'trainingBoost', value: 0.15, label: 'Guest coaching clinic', source: 'test', matchesLeft: 1 });
    expect(trainingModifier(s.clubs.hfx)).toBeCloseTo(1.15);
    s.clubs.hfx.fanBase = 50_000;
    expect(projectedAttendance(s.clubs.hfx)).toBe(Math.round(BALANCE.economy.stadiumCapacity[0] * 0.75));
    s = playOneGame(s);
    // Only this test's happenings are checked (random events in between may add their own).
    const ours = () => s.clubs.hfx.modifiers.filter((m) => m.source === 'test');
    expect(ours().map((m) => [m.label, m.matchesLeft])).toEqual([['Floodlight failure', 1]]);
    s = playOneGame(s);
    expect(ours()).toHaveLength(0);
  });

  it('clinic and disruption create temporary modifiers, never levels', () => {
    let s = force(newGame(26), 'facility_training_clinic');
    s = ack(resolve(s, 'book'));
    expect(s.clubs.hfx.modifiers[0]).toMatchObject({ kind: 'trainingBoost', value: BALANCE.facilities.happenings.clinicBoost });
    expect(s.clubs.hfx.facilities.training).toBe(1);
    s = force(s, 'facility_disruption');
    s = ack(resolve(s, 'wait'));
    expect(s.clubs.hfx.modifiers).toHaveLength(2);
    expect(s.clubs.hfx.facilities).toEqual({ training: 1, scouting: 1, stadium: 1 });
  });

  it('the old facility proposal is never planned again (kept only for older saves)', () => {
    const s = structuredClone(newGame(28));
    expect(getTemplate('facility_expansion').weight(s)).toBe(0);
  });

  it('v5 saves gain an empty modifier list', () => {
    const v5 = JSON.parse(JSON.stringify(newGame(27)));
    v5.schemaVersion = 5;
    for (const c of Object.values(v5.clubs) as Record<string, unknown>[]) delete c.modifiers;
    v5.queue = [{ templateId: 'facility_expansion', kind: 'management', gameId: null }, ...v5.queue];
    const m = migrate(v5);
    expect(m.schemaVersion).toBe(SCHEMA_VERSION);
    expect(m.clubs.hfx.modifiers).toEqual([]);
    expect(m.queue.some((q) => q.templateId === 'facility_expansion')).toBe(false);
  });
});
