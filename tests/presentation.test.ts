import { describe, expect, it } from 'vitest';
import type { MatchResult, MatchSequence } from '../src/domain/types';
import { buildCommentary, gameSoFar, PACE, pitcherLine, todayLine, type CommentaryStep } from '../src/presentation/commentary';
import { CommentaryPlayback } from '../src/presentation/playback';
import { simMatch } from './helpers';

function stepsFor(m: MatchResult, s: ReturnType<typeof simMatch>['s']) {
  return buildCommentary({ match: m, name: (id) => s.players[id]?.lastName ?? id, clubName: (id) => s.clubs[id]?.name ?? id });
}

/** Finds a real simulated play matching `pred` across seeded games. */
function find(pred: (st: MatchSequence) => boolean) {
  for (let seed = 1; seed <= 400; seed++) {
    const { m, s } = simMatch(seed);
    const i = m.sequence!.findIndex(pred);
    if (i >= 0) {
      const steps = stepsFor(m, s);
      return { m, s, i, steps, play: steps.filter((x) => x.seqIndex === i), st: m.sequence![i] };
    }
  }
  throw new Error('no fixture found');
}

const total = (sc: { home: number; away: number }) => sc.home + sc.away;

function checkGame(m: MatchResult, steps: CommentaryStep[]) {
  const seq = m.sequence!;
  // Every recorded play is presented and its first finished step equals the engine's after-state.
  for (let i = 0; i < seq.length; i++) {
    const play = steps.filter((x) => x.seqIndex === i);
    expect(play.length).toBeGreaterThan(0);
    const done = play.find((x) => x.playDone && x.tone !== 'inning')!;
    expect(done, `play ${i} (${seq[i].kind}/${seq[i].outcome})`).toBeTruthy();
    if (seq[i].kind !== 'suddenDeath') {
      expect(done.state.outs).toBe(Math.min(3, seq[i].after.outs));
      expect(done.state.bases).toEqual(seq[i].after.bases);
    }
    expect(done.state.score).toEqual(seq[i].after.score);
    // Nothing before the finished step shows more runs than the engine credited.
    for (const x of play) expect(total(x.state.score)).toBeLessThanOrEqual(total(seq[i].after.score));
  }
  let prev: CommentaryStep | null = null;
  for (const x of steps) {
    const st = x.state;
    // Nobody is shown twice: no runner on two bases, the batter is not also a runner, a scorer is not on base.
    const onBase = st.bases.filter(Boolean);
    expect(new Set(onBase).size).toBe(onBase.length);
    if (st.batterId) expect(onBase).not.toContain(st.batterId);
    if (st.scoredId) expect(onBase).not.toContain(st.scoredId);
    for (const id of st.advancing) expect(onBase).toContain(id);
    expect(st.outs).toBeLessThanOrEqual(3);
    if (prev) {
      // The score never goes backwards (no temporary run taken back).
      expect(st.score.home).toBeGreaterThanOrEqual(prev.state.score.home);
      expect(st.score.away).toBeGreaterThanOrEqual(prev.state.score.away);
      expect(x.runs).toBe(total(st.score) - total(prev.state.score));
      if (prev.state.inning === st.inning && prev.state.half === st.half) expect(st.outs).toBeGreaterThanOrEqual(prev.state.outs);
    }
    prev = x;
  }
  const last = steps[steps.length - 1];
  expect(last.tone).toBe('final');
  expect(last.state.score).toEqual(m.runs);
  expect(new Set(steps.map((x) => x.id)).size).toBe(steps.length);
}

describe('commentary steps', () => {
  it('50 games: every play ends on the engine state, no early runs, no duplicate markers', () => {
    for (let seed = 1; seed <= 50; seed++) {
      const { m, s } = simMatch(seed);
      checkGame(m, stepsFor(m, s));
    }
  });

  it('side panels count only plays already finished on screen', () => {
    const { m, s } = simMatch(4);
    const steps = stepsFor(m, s);
    const seq = m.sequence!;
    for (let k = 0; k < steps.length; k++) {
      const finished = new Set(steps.slice(0, k + 1).filter((x) => x.playDone && x.tone !== 'inning' && x.seqIndex >= 0).map((x) => x.seqIndex));
      const ks = [...finished].filter((i) => seq[i].outcome === 'strikeout');
      const rows = gameSoFar(m, steps, k);
      expect(rows[m.homeId].k + rows[m.awayId].k).toBe(ks.length);
    }
    // At the very first step (Top of the 1st) nothing has happened yet.
    const first = gameSoFar(m, steps, 0);
    expect(first[m.homeId].h + first[m.awayId].h + first[m.homeId].k + first[m.awayId].k + first[m.homeId].bb + first[m.awayId].bb).toBe(0);
    expect(todayLine(m, steps, 0, seq[0].batterId!)).toEqual({ ab: 0, h: 0 });
  });

  it('the pitcher card line equals the engine box score at the end and never runs ahead', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const { m, s } = simMatch(seed);
      const steps = stepsFor(m, s);
      const last = steps.length - 1;
      for (const [id, box] of Object.entries(m.pitching)) {
        const l = pitcherLine(m, steps, last, id);
        expect([l.bf, l.outs, l.h, l.bb, l.k, l.r]).toEqual([box.battersFaced, box.outs, box.h, box.bb, box.so, box.r]);
        // Midway, never more than the final line.
        const mid = pitcherLine(m, steps, Math.floor(last / 2), id);
        expect(mid.bf).toBeLessThanOrEqual(box.battersFaced);
      }
      expect(m.pitchStyles).toBeTruthy();
    }
  });

  it('are deterministic and stable across rebuilds (ids, texts, durations)', () => {
    const { m, s } = simMatch(3);
    expect(stepsFor(m, s)).toEqual(stepsFor(m, s));
  });

  it('a hit that drives in a run is told as hit → score → runners settle', () => {
    const { play, st } = find(
      (x) => x.outcome === 'single' && x.runners.some((r) => r.to === 4) && x.runners.some((r) => r.playerId !== x.batterId && r.to !== 4 && r.to !== r.from),
    );
    const kinds = play.filter((x) => x.tone !== 'build' && x.tone !== 'inning').map((x) => x.headline ?? x.tone);
    expect(kinds[0]).toBe('BASE HIT!');
    expect(kinds).toContain('SCORES!');
    expect(kinds[kinds.length - 1]).toBe('routine');
    const hit = play.find((x) => x.headline === 'BASE HIT!')!;
    // The hit step does not show the run or the final bases yet; the batter is still at the plate.
    expect(hit.state.score).toEqual(st.before.score);
    expect(hit.state.batterId).toBe(st.batterId);
    expect(hit.state.inProgress).toBe(true);
    const score = play.find((x) => x.headline === 'SCORES!')!;
    expect(score.runs).toBe(1);
    expect(score.state.scoredId).not.toBeNull();
    expect(score.state.bases).not.toContain(score.state.scoredId);
    // A runner still moving is shown at his last confirmed base, marked as advancing.
    expect(score.state.advancing.length).toBeGreaterThan(0);
    const settle = play.find((x) => x.playDone)!;
    expect(settle.state.bases).toEqual(st.after.bases);
    expect(settle.state.batterId).toBeNull();
  });

  it('build-up steps show only the situation before the pitch', () => {
    const { play, st } = find((x) => x.outcome === 'double' && x.before.bases.some(Boolean));
    const build = play.find((x) => x.tone === 'build')!;
    expect(build.state.score).toEqual(st.before.score);
    expect(build.state.bases).toEqual(st.before.bases);
    expect(build.state.outs).toBe(st.before.outs);
    expect(build.text).not.toMatch(/double/i);
  });

  it('third out ends the half with its own step and the next half starts clean', () => {
    const { steps, i, st } = find((x) => x.kind === 'plateAppearance' && x.after.outs === 3 && x.before.bases.some(Boolean));
    const end = steps.find((x) => x.seqIndex === i && x.tone === 'inning')!;
    expect(end.text).toMatch(/three outs/i);
    expect(end.state.bases).toEqual([null, null, null]);
    expect(end.state.score).toEqual(st.after.score);
    const nextHalf = steps[end.index + 1];
    expect(nextHalf.tone === 'inning' || nextHalf.tone === 'final').toBe(true);
    if (nextHalf.tone === 'inning') expect(nextHalf.state.outs).toBe(0);
  });

  it('double play: lead runner first, then the batter, in the recorded order', () => {
    const { play, st, s } = find((x) => x.outcome === 'doublePlay');
    const outs = play.filter((x) => x.tone === 'out');
    expect(outs[0].text).toContain(s.players[st.outOrder[0]].lastName);
    expect(outs[0].state.outs).toBe(st.before.outs + 1);
    expect(outs[1].headline).toBe('DOUBLE PLAY!');
    expect(outs[1].state.outs).toBe(Math.min(3, st.before.outs + 2));
  });

  it('home run, walk, steal, caught stealing, pitching change and extra innings are presented', () => {
    for (const [pred, headline] of [
      [(x: MatchSequence) => x.outcome === 'homeRun' && x.before.bases.some(Boolean), /HOME RUN|GRAND SLAM/],
      [(x: MatchSequence) => x.kind === 'steal', /SAFE/],
      [(x: MatchSequence) => x.kind === 'caughtStealing', /CAUGHT STEALING/],
      [(x: MatchSequence) => x.kind === 'pitchingChange', /PITCHING CHANGE/],
      [(x: MatchSequence) => x.kind === 'ghostRunner', /EXTRA INNINGS/],
      [(x: MatchSequence) => x.outcome === 'walk' && x.before.bases.every(Boolean), /BASES-LOADED WALK/],
    ] as const) {
      const { play } = find(pred);
      expect(play.some((x) => headline.test(x.headline ?? ''))).toBe(true);
    }
  });

  it('never names a fielder or a pitch speed the engine does not model', () => {
    for (let seed = 1; seed <= 10; seed++) {
      const { m, s } = simMatch(seed);
      for (const x of stepsFor(m, s)) expect(x.text).not.toMatch(/mph|to (left|center|right)|line drive|pop[- ]up|count/i);
    }
  });

  it('tempo: important moments stay longer than routine ones', () => {
    expect(PACE.score).toBeGreaterThan(PACE.routine);
    expect(PACE.big).toBeGreaterThan(PACE.build);
  });
});

describe('commentary playback', () => {
  const { m, s } = simMatch(7);
  const steps = stepsFor(m, s);

  it('next moves one step, skip ends on the authoritative final step', () => {
    const pb = new CommentaryPlayback(steps);
    expect(pb.index).toBe(-1);
    pb.next();
    expect(pb.index).toBe(0);
    pb.next();
    expect(pb.index).toBe(1);
    pb.skip();
    expect(pb.finished).toBe(true);
    expect(pb.step!.state.score).toEqual(m.runs);
    expect(pb.next()).toBe(false);
    expect(pb.delay()).toBeNull();
  });

  it('autoplay delay follows the step and speed; pause stops scheduling', () => {
    const pb = new CommentaryPlayback(steps, 0);
    const d1 = pb.delay()!;
    expect(d1).toBe(steps[0].duration);
    pb.speed = 'fast';
    expect(pb.delay()).toBe(Math.round(steps[0].duration / 2));
    pb.speed = 'slow';
    expect(pb.delay()).toBeGreaterThan(steps[0].duration);
    pb.auto = false;
    expect(pb.delay()).toBeNull();
  });

  it('autoplay to the end and manual stepping reach the same final state', () => {
    const auto = new CommentaryPlayback(steps, 0);
    let guard = 0;
    while (auto.delay() !== null && guard++ < 10_000) auto.next();
    const manual = new CommentaryPlayback(steps);
    while (manual.next());
    const skipped = new CommentaryPlayback(steps, 5);
    skipped.skip();
    expect(auto.step!.state).toEqual(manual.step!.state);
    expect(skipped.step!.state).toEqual(manual.step!.state);
  });

  it('resumes from a stored position with a consistent state', () => {
    const pb = new CommentaryPlayback(steps, 40);
    expect(pb.index).toBe(40);
    expect(pb.step).toBe(steps[40]);
    expect(new CommentaryPlayback(steps, 99_999).finished).toBe(true);
  });
});
