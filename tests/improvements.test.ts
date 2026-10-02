import { describe, expect, it } from 'vitest';
import { optionBlocker } from '../src/application/engine';
import type { GameState } from '../src/domain/state';
import { ovrDisplay, teamOvr } from '../src/domain/teamOvr';
import { getTemplate } from '../src/events/registry';
import { createRng } from '../src/domain/rng';
import { improvementsOf, nearNextStep, teamOvrChange } from '../src/presentation/improvements';
import { newGame, run, T0, toNextEvent } from './helpers';

/** The current event replaced by a team training session. */
function training(s: GameState): GameState {
  const next = structuredClone(toNextEvent(s));
  const t = getTemplate('team_training');
  const d = t.build({ state: next, rng: createRng(next.rngState), season: next.calendar.season, round: next.calendar.round, gameId: null });
  const { candidates = [], rerollCost = null, ...rest } = d;
  next.currentEvent = { ...next.currentEvent!, ...rest, id: `forced-${next.nextId++}`, templateId: t.id, type: t.type, status: 'pending', candidates, rerollCost, rerolled: false, resolution: null };
  return next;
}

describe('training improvements', () => {
  it('groups whole rating steps by player, reports development points, and matches the team OVR before/after', () => {
    let found = false;
    for (let seed = 501; seed < 540 && !found; seed++) {
      let s = training(newGame(seed));
      // Make several players one point short of a step so the session produces improvements.
      for (const id of s.clubs.hfx.roster) s.players[id].progress.contact = 99;
      const before = ovrDisplay(teamOvr(s, 'hfx')!.overall);
      const ev = s.currentEvent!;
      expect(optionBlocker(s, ev, ev.options.find((o) => o.id === 'batting')!, null, T0)).toBeNull();
      s = run(s, { type: 'resolveEvent', eventId: ev.id, revision: s.revision, optionId: 'batting', boostId: null });
      const r = s.currentEvent!.resolution!;
      expect(r.metrics?.developmentPoints).toBeGreaterThan(0);
      const groups = improvementsOf(s, r.effects);
      if (groups.length === 0) continue;
      found = true;
      expect(r.headline).toBe('Hard work pays off.');
      for (const g of groups) for (const row of g.rows) expect(row.after).toBeGreaterThan(row.before);
      // Each player appears once, with all his steps.
      expect(new Set(groups.map((g) => g.playerId)).size).toBe(groups.length);
      const change = teamOvrChange(s, 'hfx', r.effects)!;
      expect(change.before).toBe(before);
      expect(change.after).toBe(ovrDisplay(teamOvr(s, 'hfx')!.overall));
      expect(change.after).toBeGreaterThanOrEqual(change.before);
    }
    expect(found).toBe(true);
  });

  it('with no whole step, the closest players to their next step are listed', () => {
    let s = training(newGame(541));
    for (const id of s.clubs.hfx.roster) s.players[id].progress.contact = 0;
    const ev = s.currentEvent!;
    s = run(s, { type: 'resolveEvent', eventId: ev.id, revision: s.revision, optionId: 'batting', boostId: null });
    const r = s.currentEvent!.resolution!;
    expect(improvementsOf(s, r.effects)).toEqual([]);
    expect(r.headline).toBe('Progress made.');
    const near = nearNextStep(s, r.effects);
    expect(near.length).toBeGreaterThan(0);
    for (let i = 1; i < near.length; i++) expect(near[i - 1].progress).toBeGreaterThanOrEqual(near[i].progress);
  });
});
