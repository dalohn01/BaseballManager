import { describe, expect, it } from 'vitest';
import { BALANCE } from '../src/balance/config';
import { execute, optionBlocker } from '../src/application/engine';
import { validateLineup } from '../src/domain/lineup';
import { clubPlayers } from '../src/domain/state';
import { computeStandings } from '../src/simulation/standings';
import { roundShare } from '../src/simulation/economy';
import { newGame, playSeason, run, step, T0 } from './helpers';

describe('new game', () => {
  it('starts with valid rosters, lineups and a feasible first event', () => {
    const s = newGame(7);
    expect(s.clubOrder).toHaveLength(6);
    for (const id of s.clubOrder) {
      const players = clubPlayers(s, id);
      expect(players).toHaveLength(15);
      expect(players.filter((p) => p.isPitcher)).toHaveLength(4);
      const errors = validateLineup(s, id, s.clubs[id].lineup).filter((i) => i.severity === 'error');
      expect(errors).toEqual([]);
    }
    const ev = s.currentEvent!;
    expect(ev.status).toBe('pending');
    expect(ev.options.some((o) => optionBlocker(s, ev, o, null, T0) === null)).toBe(true);
  });

  it('schedules 20 rounds where every pair meets 4 times, 2 home and 2 away', () => {
    const s = newGame(3);
    const games = s.schedule.filter((g) => g.season === 1);
    expect(games).toHaveLength(BALANCE.season.rounds * 3);
    for (let r = 1; r <= 20; r++) {
      const ids = games.filter((g) => g.round === r).flatMap((g) => [g.homeId, g.awayId]);
      expect(new Set(ids).size).toBe(6);
    }
    for (const a of s.clubOrder) {
      for (const b of s.clubOrder) {
        if (a >= b) continue;
        const meet = games.filter((g) => (g.homeId === a && g.awayId === b) || (g.homeId === b && g.awayId === a));
        expect(meet).toHaveLength(4);
        expect(meet.filter((g) => g.homeId === a)).toHaveLength(2);
      }
    }
  });
});

describe('event resolution', () => {
  it('is idempotent: a second resolve of the same event is rejected as duplicate', () => {
    const s = newGame();
    const ev = s.currentEvent!;
    const cmd = { type: 'resolveEvent' as const, eventId: ev.id, revision: s.revision, optionId: ev.options[0].id, boostId: null };
    const s1 = run(s, cmd);
    const again = execute(s1, { ...cmd, revision: s1.revision }, T0);
    expect(again.ok).toBe(false);
    expect(!again.ok && again.code).toBe('duplicate');
  });

  it('rejects stale revisions', () => {
    const s = newGame();
    const s1 = run(s, { type: 'autoLineup', mode: 'rest' });
    const ev = s1.currentEvent!;
    const r = execute(s1, { type: 'resolveEvent', eventId: ev.id, revision: s.revision, optionId: ev.options[0].id, boostId: null }, T0);
    expect(!r.ok && r.code).toBe('stale');
  });

  it('never mutates the input state', () => {
    const s = newGame();
    const before = JSON.stringify(s);
    step(s, 5);
    expect(JSON.stringify(s)).toBe(before);
  });

  it('every event offers a base choice without Influence or extra Cash', () => {
    let s = newGame(11);
    for (let i = 0; i < 60 && s.currentEvent; i++) {
      const ev = s.currentEvent;
      expect(ev.options.some((o) => o.cost.cash === 0 && o.cost.influence === 0)).toBe(true);
      s = step(s, i);
    }
  });

  it('charges Influence for the training boost exactly once', () => {
    let s = newGame(2);
    while (s.currentEvent!.templateId !== 'team_training') s = step(s, 1);
    const ev = s.currentEvent!;
    const before = s.influence;
    const s1 = run(s, { type: 'resolveEvent', eventId: ev.id, revision: s.revision, optionId: 'batting', boostId: 'extra_coaching' });
    expect(s1.influence).toBe(before - BALANCE.influence.trainingBoostCost);
    expect(s1.currentEvent!.resolution!.effects.some((e) => e.stat === 'influence')).toBe(true);
  });

  it('shows before/after values in the resolution and history', () => {
    let s = newGame(4);
    for (let i = 0; i < 4; i++) s = step(s, i);
    expect(s.history.some((h) => h.effects.length > 0)).toBe(true);
    for (const h of s.history) for (const e of h.effects) expect(e.before).not.toBe(e.after);
  });
});

describe('full season', () => {
  it('plays a whole season and counts every league game once', () => {
    const s = playSeason(newGame(21));
    expect(s.calendar).toMatchObject({ season: 2, round: 0, phase: 'preseason' });
    expect(s.currentEvent?.templateId).toBe('season_plan');
    const games = s.schedule.filter((g) => g.season === 1);
    expect(games.every((g) => g.result)).toBe(true);
    const table = computeStandings(s, 1);
    const totalWins = table.reduce((a, r) => a + r.wins, 0);
    expect(totalWins).toBe(games.length);
    expect(table.every((r) => r.played === 20)).toBe(true);
    expect(Object.keys(s.matches)).toHaveLength(20);
  }, 60_000);

  it('reconciles club cash with the ledger', () => {
    const s = playSeason(newGame(8));
    const sum = s.ledger.reduce((a, e) => a + e.amount, 0);
    expect(s.clubs[s.userClubId].cash).toBe(BALANCE.economy.startingCash + sum);
  }, 60_000);

  it('splits a season amount into 20 shares that sum exactly', () => {
    for (const amount of [48_000, 92_001, 13, 300_000]) {
      let total = 0;
      for (let r = 1; r <= 20; r++) total += roundShare(amount, r);
      expect(total).toBe(amount);
    }
  });

  it('runs 50 seeded seasons without errors, empty queues or invalid lineups', () => {
    for (let seed = 100; seed < 150; seed++) {
      const s = playSeason(newGame(seed), seed);
      expect(s.calendar.phase).toBe('preseason');
      for (const id of s.clubOrder) {
        const errors = validateLineup(s, id, s.clubs[id].lineup).filter((i) => i.severity === 'error');
        expect(errors).toEqual([]);
      }
    }
  }, 120_000);
});

describe('determinism', () => {
  it('same seed + same commands = same state, including across save/load', () => {
    let a = newGame(99);
    let b = newGame(99);
    for (let i = 0; i < 40; i++) {
      a = step(a, i);
      b = JSON.parse(JSON.stringify(step(b, i)));
    }
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});
