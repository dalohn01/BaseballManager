import { describe, expect, it } from 'vitest';
import { migrate } from '../src/application/migrations';
import { EffectSink } from '../src/domain/effects';
import {
  DIMENSIONS,
  describePersonality,
  expression,
  generatePersonality,
  react,
  trainingFactor,
  type Personality,
} from '../src/domain/personality';
import { SCHEMA_VERSION } from '../src/domain/state';
import { applyReaction, reactionPreview } from '../src/simulation/reactions';
import { groupInfluence } from '../src/simulation/training';
import { newGame, playSeason } from './helpers';

/** A neutral personality with some values changed. */
const P = (v: Partial<Record<(typeof DIMENSIONS)[number], number>> = {}): Personality => ({
  version: 1,
  seed: 1,
  teamOrientation: 50,
  recognitionNeed: 50,
  outspokenness: 50,
  drive: 50,
  discipline: 50,
  temper: 50,
  consideration: 50,
  ...v,
});

describe('personality reactions (same situation, different profiles)', () => {
  it('1. a reasonable rotation hurts a team-first player less than a self-focused one who wants recognition', () => {
    const teamFirst = react(P({ teamOrientation: 85, recognitionNeed: 25 }), 'rotation', -1);
    const selfish = react(P({ teamOrientation: 15, recognitionNeed: 85 }), 'rotation', -1);
    expect(teamFirst.delta).toBeGreaterThan(selfish.delta);
    expect(teamFirst.delta).toBeLessThan(0);
    expect(selfish.delta).toBeLessThanOrEqual(-1.5);
  });

  it('2. a quiet player can be as unhappy as an outspoken one, but says less', () => {
    const quiet = P({ outspokenness: 10, recognitionNeed: 80 });
    const loud = P({ outspokenness: 90, recognitionNeed: 80 });
    expect(react(quiet, 'playing_time', -2).delta).toBe(react(loud, 'playing_time', -2).delta);
    expect(expression(quiet, -2)).toBe('silent');
    expect(expression(loud, -2)).not.toBe('silent');
  });

  it('3. drive and discipline give separate contributions: wanting a program is not the same as doing it', () => {
    const eager = P({ drive: 90, discipline: 15 });
    const steady = P({ drive: 15, discipline: 90 });
    expect(react(eager, 'development_opportunity', 2).delta).toBeGreaterThan(react(steady, 'development_opportunity', 2).delta);
    const a = trainingFactor(eager);
    const b = trainingFactor(steady);
    expect(a.drive).toBeGreaterThan(0);
    expect(a.discipline).toBeLessThan(0);
    expect(b.drive).toBeLessThan(0);
    expect(b.discipline).toBeGreaterThan(0);
    for (const x of [a, b, trainingFactor(P({ drive: 100, discipline: 100 })), trainingFactor(P({ drive: 0, discipline: 0 }))]) {
      expect(x.factor).toBeGreaterThanOrEqual(0.7);
      expect(x.factor).toBeLessThanOrEqual(1.3);
    }
  });

  it('4. team orientation does not soften a broken promise', () => {
    expect(react(P({ teamOrientation: 95 }), 'broken_promise', -8).delta).toBe(react(P({ teamOrientation: 5 }), 'broken_promise', -8).delta);
    expect(react(P({ temper: 90 }), 'broken_promise', -8).delta).toBeLessThan(-8);
  });

  it('5. public criticism hurts more than private criticism for a player who needs recognition', () => {
    const p = P({ recognitionNeed: 90 });
    const pub = react(p, 'public_criticism', -2);
    const priv = react(p, 'private_criticism', -2);
    expect(pub.factor).toBeGreaterThan(priv.factor);
    // For someone who does not care about status the difference is small.
    const q = P({ recognitionNeed: 20 });
    expect(react(q, 'public_criticism', -2).factor - react(q, 'private_criticism', -2).factor).toBeLessThan(pub.factor - priv.factor);
  });

  it('6. small changes give smooth effects (49 vs 51), no sign flips and no effect from zero', () => {
    for (const cause of ['rotation', 'playing_time', 'public_praise', 'broken_promise', 'development_opportunity'] as const) {
      for (const d of DIMENSIONS) {
        const a = react(P({ [d]: 49 }), cause, -3);
        const b = react(P({ [d]: 51 }), cause, -3);
        expect(Math.abs(a.delta - b.delta)).toBeLessThanOrEqual(0.2);
      }
      const extreme = react(P({ teamOrientation: 0, recognitionNeed: 100, drive: 100, temper: 100 }), cause, 2);
      expect(extreme.delta).toBeGreaterThan(0);
      expect(extreme.factor).toBeLessThanOrEqual(1.75);
      expect(react(P({ temper: 100 }), cause, 0).delta).toBe(0);
    }
  });

  it('7. group influence: one leader per session, at most four recipients, one irritation each', () => {
    const s = newGame(71);
    const players = s.clubs.hfx.roster.map((id) => s.players[id]);
    // Make two demanding, blunt players; only the stronger one leads.
    players[0].personality = P({ drive: 95, outspokenness: 95, consideration: 10, temper: 90, teamOrientation: 80 });
    players[1].personality = P({ drive: 90, outspokenness: 90, consideration: 10, temper: 90, teamOrientation: 80 });
    for (const p of players.slice(2)) p.personality = P({ drive: 20 });
    const g = groupInfluence(players)!;
    expect(g.leaderId).toBe(players[0].id);
    expect(g.tone).toBe('harsh');
    expect(g.recipients.length).toBeLessThanOrEqual(4);
    expect(new Set(g.recipients).size).toBe(g.recipients.length);
    expect(g.recipients).not.toContain(players[0].id);
    // A calm, considerate leader encourages instead.
    players[0].personality = P({ drive: 95, outspokenness: 95, consideration: 85, temper: 20, teamOrientation: 80 });
    players[1].personality = P();
    expect(groupInfluence(players)!.tone).toBe('encouraging');
  });

  it('8. the previewed number is the saved one, and a situation is never applied twice', () => {
    const s = structuredClone(newGame(72));
    const id = s.clubs.hfx.roster[3];
    const p = s.players[id];
    const shown = reactionPreview(p, 'public_praise', 3);
    const before = p.satisfaction;
    const sink = new EffectSink(s, 'evt-x');
    applyReaction(s, sink, id, 'public_praise', 3, 'Praised in the press', 'evt-x:praise');
    expect(Math.round((p.satisfaction - before) * 10) / 10).toBe(Math.min(shown, 100 - before));
    const after = p.satisfaction;
    applyReaction(s, sink, id, 'public_praise', 3, 'Praised in the press', 'evt-x:praise');
    expect(p.satisfaction).toBe(after);
    expect(p.reactions.filter((r) => r.id === 'evt-x:praise')).toHaveLength(1);
    expect(sink.records.filter((r) => r.stat === 'satisfaction')).toHaveLength(1);
  });
});

describe('generation and description', () => {
  it('is stable per seed, varied, and rarely extreme or flat', () => {
    expect(generatePersonality(123)).toEqual(generatePersonality(123));
    const all = Array.from({ length: 400 }, (_, i) => generatePersonality(1000 + i));
    for (const d of DIMENSIONS) {
      const v = all.map((p) => p[d]);
      const mean = v.reduce((a, b) => a + b, 0) / v.length;
      expect(mean).toBeGreaterThan(40);
      expect(mean).toBeLessThan(60);
      expect(v.filter((x) => x < 25 || x > 75).length / v.length).toBeLessThan(0.35);
      expect(new Set(v).size).toBeGreaterThan(20);
    }
    const names = new Set(all.map((p) => describePersonality(p).name));
    expect(names.size).toBeGreaterThan(6);
  });

  it('a calm driver is never described as short-fused; names follow the actual combination', () => {
    const calm = P({ teamOrientation: 85, drive: 85, outspokenness: 85, temper: 15, consideration: 75 });
    expect(describePersonality(calm).text).not.toMatch(/short fuse/);
    expect(describePersonality(P({ teamOrientation: 85, drive: 85, outspokenness: 85, temper: 85 })).name).toBe('Demanding team driver');
    expect(describePersonality(P()).name).toBe('Balanced');
  });

  it('every player in a new game has a personality and no legacy priority', () => {
    const s = newGame(73);
    for (const p of Object.values(s.players)) {
      expect(p.personality.version).toBe(1);
      expect('priority' in p).toBe(false);
    }
  });
});

describe('migration to personalities (v10)', () => {
  it('maps the old priority to the main tendency, keeps happiness and skills, and is idempotent', () => {
    const v9 = JSON.parse(JSON.stringify(newGame(74)));
    v9.schemaVersion = 9;
    const ids = Object.keys(v9.players);
    ids.forEach((id, i) => {
      delete v9.players[id].personality;
      delete v9.players[id].reactions;
      v9.players[id].priority = i % 2 ? 'loyalty' : 'money';
    });
    const m = migrate(v9);
    expect(m.schemaVersion).toBe(SCHEMA_VERSION);
    const loyal = ids.filter((_, i) => i % 2).map((id) => m.players[id].personality.teamOrientation);
    const money = ids.filter((_, i) => !(i % 2)).map((id) => m.players[id].personality.teamOrientation);
    const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    expect(mean(loyal)).toBeGreaterThan(mean(money) + 15);
    for (const id of ids) {
      expect(m.players[id].satisfaction).toBe(v9.players[id].satisfaction);
      expect(m.players[id].ratings).toEqual(v9.players[id].ratings);
      expect('priority' in m.players[id]).toBe(false);
    }
    // Running it again (from the same old save or on the result) changes nothing.
    expect(JSON.stringify(migrate(JSON.parse(JSON.stringify(v9))).players)).toBe(JSON.stringify(m.players));
    expect(JSON.stringify(migrate(JSON.parse(JSON.stringify(m))).players)).toBe(JSON.stringify(m.players));
  });
});

describe('balance: personalities in a normal season', () => {
  it('a normal squad plays a season without every personality demanding a decision', () => {
    for (const seed of [81, 82, 83]) {
      const s = playSeason(newGame(seed), seed);
      const season1 = s.history.filter((h) => h.season === 1);
      const playerIssues = season1.filter((h) => ['trade_request', 'individual_training_prospect'].includes(h.templateId)).length;
      expect(playerIssues, `seed ${seed}`).toBeLessThanOrEqual(6);
      const squad = s.clubs.hfx.roster.map((id) => s.players[id].satisfaction);
      expect(squad.reduce((a, b) => a + b, 0) / squad.length, `seed ${seed}`).toBeGreaterThan(50);
    }
  }, 120_000);
});
