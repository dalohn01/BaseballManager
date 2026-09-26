import { describe, expect, it } from 'vitest';
import type { MatchResult, MatchSequence } from '../src/domain/types';
import { buildPresentation, isFirstOfHalf, type MatchContext } from '../src/presentation/adapter';
import { frameAt } from '../src/presentation/frame';
import { MatchPlayback } from '../src/presentation/playback';
import { simMatch } from './helpers';

function ctxFor(m: MatchResult, s: ReturnType<typeof simMatch>['s']): MatchContext {
  return { match: m, name: (id) => s.players[id]?.lastName ?? id, bats: (id) => s.players[id]?.bats ?? 'R' };
}

/** Finds a real simulated step matching `pred` across seeded games. */
function find(pred: (st: MatchSequence, all: MatchSequence[], i: number) => boolean) {
  for (let seed = 1; seed <= 400; seed++) {
    const { m, s } = simMatch(seed);
    const i = m.sequence!.findIndex((st, idx) => pred(st, m.sequence!, idx));
    if (i >= 0) return { m, s, i, ctx: ctxFor(m, s) };
  }
  throw new Error('no fixture found');
}

function checkPresentation(ctx: MatchContext, i: number) {
  const st = ctx.match.sequence![i];
  const p = buildPresentation(ctx, i);
  const end = frameAt(p, p.duration);
  // The closing frame always matches the simulator's after-snapshot.
  expect(end.state.outs).toBe(st.after.outs);
  expect(end.state.bases).toEqual(st.after.bases);
  expect(end.state.score).toEqual(st.after.score);
  expect(end.commentary).toBe(st.text);
  // Before the result moment, the commentary never reveals the result.
  const early = frameAt(p, Math.max(0, p.resultAt - 1));
  expect(early.commentary).not.toBe(st.text);
  // Each player appears exactly once (batter → runner is the same figure).
  const ids = p.actors.map((a) => a.id);
  expect(new Set(ids).size).toBe(ids.length);
  // Roles follow the half-inning: the batting club is on offense.
  for (const a of p.actors) {
    expect(a.clubId).toBe(a.role === 'offense' ? st.battingClubId : st.battingClubId === ctx.match.homeId ? ctx.match.awayId : ctx.match.homeId);
  }
  // Labels only name visible actors in the scene, at most three at a time.
  for (let t = 0; t <= p.duration; t += 100) {
    const f = frameAt(p, t);
    expect(f.labels.length).toBeLessThanOrEqual(3);
    for (const id of f.labels) expect(ids).toContain(id);
    // Score never runs ahead of the after-snapshot.
    expect(f.state.score.home).toBeLessThanOrEqual(st.after.score.home);
    expect(f.state.score.away).toBeLessThanOrEqual(st.after.score.away);
  }
  return { p, st };
}

describe('presentation adapter', () => {
  it('single with several runners on', () => {
    const { ctx, i } = find((st) => st.outcome === 'single' && st.before.bases.filter(Boolean).length >= 2);
    const { p, st } = checkPresentation(ctx, i);
    const scorers = st.runners.filter((r) => r.to === 4).length;
    const runUpdates = p.updates.filter((u, k) => k > 0 && u.state.score[st.half === 'top' ? 'away' : 'home'] > p.updates[k - 1].state.score[st.half === 'top' ? 'away' : 'home']).length;
    expect(runUpdates).toBe(scorers);
    expect(p.calls.map((c) => c.text)).toContain('SINGLE');
  });

  it('strikeout for the third out', () => {
    const { ctx, i } = find((st) => st.outcome === 'strikeout' && st.after.outs === 3);
    const { p } = checkPresentation(ctx, i);
    expect(p.calls.map((c) => c.text)).toContain('STRIKEOUT');
  });

  it('walk with the bases loaded forces in a run', () => {
    const { ctx, i } = find((st) => st.outcome === 'walk' && st.before.bases.every(Boolean));
    const { st } = checkPresentation(ctx, i);
    expect(st.runners.filter((r) => r.to === 4)).toHaveLength(1);
  });

  it('fly out, home run, double play, steals, pitching change and ghost runner', () => {
    for (const pred of [
      (st: MatchSequence) => st.outcome === 'flyOut',
      (st: MatchSequence) => st.outcome === 'sacFly',
      (st: MatchSequence) => st.outcome === 'homeRun' && st.before.bases.some(Boolean),
      (st: MatchSequence) => st.outcome === 'doublePlay',
      (st: MatchSequence) => st.outcome === 'groundOut',
      (st: MatchSequence) => st.kind === 'steal',
      (st: MatchSequence) => st.kind === 'caughtStealing',
      (st: MatchSequence) => st.kind === 'pitchingChange',
      (st: MatchSequence) => st.kind === 'ghostRunner',
    ]) {
      const { ctx, i } = find(pred);
      checkPresentation(ctx, i);
    }
  });

  it('a new half-inning swaps offense and defense and shows an intro', () => {
    const { ctx, i } = find((st, all, idx) => idx > 0 && isFirstOfHalf(all, idx) && st.half === 'bottom');
    const { p, st } = checkPresentation(ctx, i);
    expect(p.calls[0].text).toMatch(/^BOTTOM /);
    const prev = buildPresentation(ctx, i - 1);
    const offPrev = prev.actors.find((a) => a.role === 'offense')!.clubId;
    const offNow = p.actors.find((a) => a.role === 'offense')!.clubId;
    expect(offNow).toBe(st.battingClubId);
    expect(offNow).not.toBe(offPrev);
  });

  it('every step of 30 games is presentable and ends on its after-snapshot', () => {
    for (let seed = 1; seed <= 30; seed++) {
      const { m, s } = simMatch(seed);
      const ctx = ctxFor(m, s);
      for (let i = 0; i < m.sequence!.length; i++) checkPresentation(ctx, i);
    }
  });
});

describe('playback controller', () => {
  const { m, s } = simMatch(7);
  const ctx = ctxFor(m, s);
  const final = m.sequence![m.sequence!.length - 1].after;

  it('ignores repeated Next while a sequence plays and never reveals results early', () => {
    const pb = new MatchPlayback(ctx, 'highlights');
    expect(pb.next()).toBe(true);
    const cursor = pb.cursor;
    expect(pb.next()).toBe(false);
    expect(pb.next()).toBe(false);
    expect(pb.cursor).toBe(cursor);
    expect(pb.logThrough).toBeLessThan(cursor);
    pb.tick(pb.presentation!.resultAt);
    expect(pb.logThrough).toBe(cursor);
  });

  it('plays from start to FINAL and matches the simulated result', () => {
    const pb = new MatchPlayback(ctx, 'all', true);
    pb.setAuto(true);
    for (let i = 0; i < 100_000 && pb.phase !== 'finished'; i++) {
      if (pb.phase === 'ready' && pb.cursor === -1) pb.next();
      pb.tick(50);
    }
    expect(pb.phase).toBe('finished');
    expect(pb.display()!.score).toEqual(m.runs);
    expect(pb.display()!.score).toEqual(final.score);
  });

  it('highlight mode skips routine plays but keeps the scoreboard in sync', () => {
    const pb = new MatchPlayback(ctx, 'highlights');
    pb.next();
    const i = pb.cursor;
    // The scoreboard at the start of the highlight equals that step's before-snapshot.
    expect(pb.display()!.score).toEqual(m.sequence![i].before.score);
    expect(pb.revealedThrough).toBe(i - 1);
  });

  it('skip mid-sequence ends on the authoritative result; turning auto off finishes the current step only', () => {
    const pb = new MatchPlayback(ctx, 'highlights');
    pb.next();
    pb.tick(100);
    pb.skip();
    expect(pb.phase).toBe('finished');
    expect(pb.display()!.score).toEqual(final.score);
    expect(pb.next()).toBe(false);

    const pb2 = new MatchPlayback(ctx, 'highlights');
    pb2.setAuto(true);
    pb2.next();
    pb2.setAuto(false);
    pb2.tick(1_000_000);
    const c = pb2.cursor;
    pb2.tick(5_000);
    expect(pb2.cursor).toBe(c);
    expect(pb2.phase).toBe('ready');
  });

  it('can resume from a stored cursor', () => {
    const pb = new MatchPlayback(ctx, 'all', false, 10);
    expect(pb.cursor).toBe(10);
    expect(pb.display()!.score).toEqual(m.sequence![10].after.score);
    expect(pb.next()).toBe(true);
    expect(pb.cursor).toBe(11);
  });
});
