import type { BaseState, ClubId, FieldSpot, MatchResult, MatchSequence, PlayerId } from '../domain/types';
import { BASE_PATH, BASES, BATTER_BOX, DUGOUT, FIELDER_SPOTS, MOUND, RUNNER_OFFSET, TIMING, VIEW, type Pt } from './fieldConfig';

/**
 * Presentation adapter: turns one simulator-recorded step (MatchSequence) into
 * an ordered visual timeline. It never decides outcomes — every runner, out
 * and run comes from the sequence; only timing and paths are presentational.
 */

export type Pose = 'ready' | 'pitch' | 'swing' | 'run' | 'catch' | 'throw' | 'cheer';

export interface Seg {
  t0: number;
  t1: number;
  from: Pt;
  to: Pt;
}
export interface BallSeg extends Seg {
  /** Arc height (in view units) at the middle of the segment. */
  peak: number;
}
export interface PoseSpan {
  t0: number;
  t1: number;
  pose: Pose;
}

export interface ActorPlan {
  id: PlayerId;
  clubId: ClubId;
  role: 'offense' | 'defense';
  start: Pt;
  segments: Seg[];
  poses: PoseSpan[];
  /** Fade in/out moments (e.g. a runner leaving after an out or a run). */
  fadeInAt?: number;
  fadeOutAt?: number;
}

export interface DisplayState extends BaseState {
  inning: number;
  half: 'top' | 'bottom';
}

export interface Presentation {
  seqIndex: number;
  duration: number;
  actors: ActorPlan[];
  ball: BallSeg[];
  ballHideAt: number;
  labels: { t0: number; t1: number; ids: PlayerId[] }[];
  updates: { t: number; state: DisplayState }[];
  /** Umpire-style calls over time; an empty text clears the banner. */
  calls: { t: number; text: string }[];
  resultAt: number;
  commentaryBefore: string;
  commentaryAfter: string;
  /** Batter/pitcher shown in the player row for this sequence. */
  batterId: PlayerId | null;
  pitcherId: PlayerId;
}

export interface MatchContext {
  match: MatchResult;
  /** Last name lookup for commentary. */
  name: (id: PlayerId) => string;
  /** Bats L/R for the batter's box side. */
  bats: (id: PlayerId) => 'L' | 'R' | 'S';
}

const lerp = (a: Pt, b: Pt, u: number): Pt => ({ x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u });
const add = (a: Pt, b: Pt): Pt => ({ x: a.x + b.x, y: a.y + b.y });
const onBase = (i: number): Pt => (i === 0 || i === 4 ? BASE_PATH[i] : add(BASE_PATH[i], RUNNER_OFFSET));

/** A point in direction `dir` (−1 = left line, 1 = right line) at `r` view units from home plate. */
export function fieldPoint(dir: number, r: number): Pt {
  const theta = (Math.max(-1.1, Math.min(1.1, dir)) * Math.PI) / 4;
  const hx = BASES.home.x * VIEW.width;
  const hy = BASES.home.y * VIEW.height;
  return { x: (hx + Math.sin(theta) * r) / VIEW.width, y: (hy - Math.cos(theta) * r) / VIEW.height };
}

const ORD = ['', '1st', '2nd', '3rd'];
const ordinal = (n: number) => (n <= 3 ? ORD[n] : `${n}th`);

export function isFirstOfHalf(seq: MatchSequence[], i: number): boolean {
  const prev = seq[i - 1];
  return !prev || prev.inning !== seq[i].inning || prev.half !== seq[i].half;
}

/**
 * Which steps "Next highlight" stops at: every non-routine step (hits, runs,
 * walks with runners on, double plays, steals, changes) plus inning-ending
 * outs with runners aboard and the final step. Skipped steps still update the
 * scoreboard and the log.
 */
export function isHighlight(seq: MatchSequence[], i: number): boolean {
  const s = seq[i];
  if (i === seq.length - 1) return true;
  if (s.kind !== 'plateAppearance') return true;
  if (s.runners.some((r) => r.to === 4)) return true;
  if (['single', 'double', 'triple', 'homeRun', 'doublePlay', 'sacFly'].includes(s.outcome!)) return true;
  if (s.outcome === 'walk' && s.before.bases.some(Boolean)) return true;
  if (s.after.outs >= 3 && s.before.bases.some(Boolean)) return true;
  return false;
}

export function buildPresentation(ctx: MatchContext, index: number, opts: { reducedMotion?: boolean } = {}): Presentation {
  const { match } = ctx;
  const seq = match.sequence!;
  const s = seq[index];
  const scale = opts.reducedMotion ? TIMING.reducedScale : 1;
  const T = (ms: number) => Math.round(ms * scale);
  const offenseSide = s.half === 'top' ? 'away' : 'home';
  const defenseSide = s.half === 'top' ? 'home' : 'away';
  const offClub = s.half === 'top' ? match.awayId : match.homeId;
  const defClub = s.half === 'top' ? match.homeId : match.awayId;
  const defLineup = match.lineups[defenseSide];
  const offDugout = DUGOUT[offenseSide];
  const defDugout = DUGOUT[defenseSide];

  const actors = new Map<PlayerId, ActorPlan>();
  const actor = (id: PlayerId, role: ActorPlan['role'], start: Pt): ActorPlan => {
    let a = actors.get(id);
    if (!a) {
      a = { id, clubId: role === 'offense' ? offClub : defClub, role, start, segments: [], poses: [] };
      actors.set(id, a);
    }
    return a;
  };
  const moveTo = (a: ActorPlan, t0: number, t1: number, to: Pt) => {
    const from = a.segments.length ? a.segments[a.segments.length - 1].to : a.start;
    a.segments.push({ t0, t1, from, to });
  };

  // Defense: the eight fielders from the stored lineup, the current pitcher on the mound.
  const spotOf = new Map<PlayerId, FieldSpot>();
  for (const slot of defLineup.battingOrder) {
    if (slot.position === 'DH') continue;
    spotOf.set(slot.playerId, slot.position);
    actor(slot.playerId, 'defense', FIELDER_SPOTS[slot.position]);
  }
  const pitcherId = s.kind === 'pitchingChange' ? s.previousPitcherId! : s.pitcherId;
  spotOf.set(pitcherId, 'P');
  actor(pitcherId, 'defense', MOUND);
  const byspot = (spot: FieldSpot) => [...spotOf.entries()].find(([, v]) => v === spot)?.[0] ?? null;

  // Offense: runners already on base, and the batter at the plate.
  s.before.bases.forEach((id, i) => {
    if (id) actor(id, 'offense', onBase(i + 1));
  });
  if (s.batterId) actor(s.batterId, 'offense', ctx.bats(s.batterId) === 'L' ? BATTER_BOX.left : BATTER_BOX.right);

  const ball: BallSeg[] = [];
  const labels: Presentation['labels'] = [];
  const updates: Presentation['updates'] = [];
  const display = (st: BaseState): DisplayState => ({ ...st, bases: [...st.bases] as DisplayState['bases'], score: { ...st.score }, inning: s.inning, half: s.half });
  let live = display(s.before);
  const bump = (t: number, change: (d: DisplayState) => void) => {
    live = { ...live, bases: [...live.bases] as DisplayState['bases'], score: { ...live.score } };
    change(live);
    updates.push({ t, state: live });
  };

  // Half-inning intro: a short banner while both teams take their places.
  const intro = isFirstOfHalf(seq, index) ? T(TIMING.halfChange) : 0;
  const calls: Presentation['calls'] = intro
    ? [
        { t: 0, text: `${s.half === 'top' ? 'TOP' : 'BOTTOM'} ${ordinal(s.inning).toUpperCase()}` },
        { t: intro, text: '' },
      ]
    : [];
  const setCall = (t: number, text: string) => calls.push({ t, text });
  updates.push({ t: 0, state: live });

  const beforeText = describeSituation(ctx, s);
  let resultAt = intro + T(TIMING.setup);
  let end = resultAt;

  /** Runs a runner along the base path; returns arrival time. Scores update on reaching home. */
  const runBases = (id: PlayerId, from: number, to: number, t0: number, perBase: number, scores: boolean): number => {
    const a = actor(id, 'offense', onBase(from));
    let t = t0;
    for (let b = from + 1; b <= to; b++) {
      moveTo(a, t, t + perBase, onBase(b));
      t += perBase;
    }
    a.poses.push({ t0, t1: t, pose: 'run' });
    if (scores) {
      bump(t, (d) => (d.score[offenseSide] += 1));
      a.poses.push({ t0: t, t1: t + T(400), pose: 'cheer' });
      a.fadeOutAt = t + T(500);
    }
    return t;
  };
  const jogOff = (id: PlayerId, t0: number) => {
    const a = actor(id, 'offense', onBase(0));
    moveTo(a, t0, t0 + T(900), offDugout);
    a.fadeOutAt = t0 + T(700);
  };

  if (s.kind === 'plateAppearance') {
    const pitcher = pitcherId;
    const batter = s.batterId!;
    const tPitch = intro + T(TIMING.setup);
    const tc = tPitch + T(TIMING.pitch);
    const release = add(MOUND, { x: 0, y: -0.012 });
    const plate = add(BASES.home, { x: 0, y: -0.02 });
    ball.push({ t0: tPitch, t1: tc, from: release, to: plate, peak: 6 });
    actor(pitcher, 'defense', MOUND).poses.push({ t0: tPitch - T(120), t1: tPitch + T(200), pose: 'pitch' });
    labels.push({ t0: 0, t1: tc + T(150), ids: [batter, pitcher] });
    const outcome = s.outcome!;
    const catcherGlove = add(FIELDER_SPOTS.C, { x: 0, y: -0.015 });
    const perBase = T(TIMING.perBase);
    const others = s.runners.filter((r) => r.playerId !== batter);
    const batterMove = s.runners.find((r) => r.playerId === batter)!;

    if (outcome === 'strikeout' || outcome === 'walk') {
      ball.push({ t0: tc, t1: tc + T(120), from: plate, to: catcherGlove, peak: 2 });
      if (outcome === 'strikeout') {
        actor(batter, 'offense', onBase(0)).poses.push({ t0: tc - T(90), t1: tc + T(150), pose: 'swing' });
        resultAt = tc + T(250);
        setCall(resultAt, 'STRIKEOUT');
        bump(resultAt, (d) => (d.outs = Math.min(3, d.outs + 1)));
        jogOff(batter, resultAt + T(250));
        end = resultAt + T(900);
      } else {
        resultAt = tc + T(200);
        setCall(resultAt, 'WALK');
        let last = resultAt;
        for (const r of s.runners) {
          if (r.to === 'out' || r.to === r.from) continue;
          const arrive = runBases(r.playerId, r.from, r.to, resultAt + T(150), T(TIMING.perBase * 1.4), r.to === 4);
          last = Math.max(last, arrive);
        }
        labels.push({ t0: resultAt, t1: last + T(300), ids: [batter] });
        end = last;
      }
    } else {
      // Ball in play.
      actor(batter, 'offense', onBase(0)).poses.push({ t0: tc - T(90), t1: tc + T(120), pose: 'swing' });
      const type = s.ball?.type ?? (outcome === 'homeRun' ? 'over' : outcome === 'groundOut' || outcome === 'doublePlay' ? 'ground' : 'fly');
      const dir = s.ball?.dir ?? 0;
      const flight = T(TIMING.flight[type]);
      const fielderId = s.fielder?.playerId ?? null;
      const fielderSpot = s.fielder?.spot ?? null;
      const target = ballTarget(outcome, type, dir, fielderSpot);
      const peak = type === 'ground' ? 3 : type === 'line' ? 40 : type === 'pop' ? 170 : type === 'over' ? 230 : 150;
      ball.push({ t0: tc, t1: tc + flight, from: plate, to: target, peak });
      const tLand = tc + flight;
      const fielder = fielderId ? actors.get(fielderId) ?? null : null;
      // Hits keep rolling a little before they are picked up.
      const collect = outcome === 'single' || outcome === 'double' || outcome === 'triple' ? lerp(target, fieldPoint(dir, outcome === 'single' ? 420 : 560), 0.45) : target;
      const tCollect = outcome === 'single' || outcome === 'double' || outcome === 'triple' ? tLand + T(300) : tLand;
      if (fielder && outcome !== 'homeRun') {
        moveTo(fielder, tc + T(TIMING.fielderReact), tCollect, collect);
        fielder.poses.push({ t0: tc + T(TIMING.fielderReact), t1: tCollect, pose: 'run' }, { t0: tCollect, t1: tCollect + T(250), pose: 'catch' });
        if (tCollect > tLand) ball.push({ t0: tLand, t1: tCollect, from: target, to: collect, peak: 1 });
      } else if (outcome === 'homeRun') {
        const nearest = byspot(dir < -0.3 ? 'LF' : dir > 0.3 ? 'RF' : 'CF');
        const nf = nearest ? actors.get(nearest) : null;
        if (nf) {
          moveTo(nf, tc + T(TIMING.fielderReact), tLand - T(200), fieldPoint(dir, 560));
          nf.poses.push({ t0: tc, t1: tLand, pose: 'run' });
        }
      }
      const focus = fielderId ? [fielderId, batter] : [batter];
      labels.push({ t0: tc + T(150), t1: tCollect + T(400), ids: focus });

      const throwTo = (t0: number, from: Pt, to: Pt, fromId: PlayerId | null): number => {
        const t1 = t0 + T(TIMING.throwMs);
        ball.push({ t0, t1, from, to, peak: 25 });
        if (fromId) actor(fromId, 'defense', from).poses.push({ t0: t0 - T(80), t1: t0 + T(180), pose: 'throw' });
        return t1;
      };

      if (outcome === 'homeRun') {
        let last = tLand;
        for (const r of [...others, batterMove]) {
          const arrive = runBases(r.playerId, r.from, 4, tc + T(200), T(TIMING.perBase * 1.15), true);
          last = Math.max(last, arrive);
        }
        resultAt = tLand;
        setCall(resultAt, 'HOME RUN');
        labels.push({ t0: tLand, t1: last, ids: [batter] });
        end = last;
      } else if (outcome === 'single' || outcome === 'double' || outcome === 'triple') {
        let last = tCollect;
        for (const r of [...others, batterMove]) {
          if (r.to === 'out') continue;
          const arrive = runBases(r.playerId, r.from, r.to, tc + T(100), perBase, r.to === 4);
          last = Math.max(last, arrive);
          if (r.to === 4) labels.push({ t0: arrive - perBase, t1: arrive + T(300), ids: [r.playerId] });
        }
        // Throw back to the infield once the ball is picked up.
        const cutoff = add(BASES.second, { x: 0, y: 0.03 });
        if (fielder) throwTo(tCollect + T(120), collect, cutoff, fielderId);
        resultAt = Math.max(tCollect, tc + perBase);
        setCall(resultAt, outcome === 'single' ? 'SINGLE' : outcome === 'double' ? 'DOUBLE' : 'TRIPLE');
        end = Math.max(last, tCollect + T(TIMING.throwMs) + T(150));
      } else if (outcome === 'groundOut' || outcome === 'doublePlay') {
        let last = tCollect;
        if (outcome === 'doublePlay') {
          // Lead runner forced at second, then the batter at first — the order the simulator recorded.
          const [leadOut, batterOut] = s.outOrder;
          const coverSpot: FieldSpot = fielderSpot === 'SS' || fielderSpot === '3B' ? '2B' : 'SS';
          const coverId = byspot(coverSpot);
          if (coverId) moveTo(actors.get(coverId)!, tc + T(100), tCollect, add(BASES.second, { x: 0, y: 0.01 }));
          const t1 = throwTo(tCollect + T(100), collect, BASES.second, fielderId);
          const lead = actor(leadOut, 'offense', onBase(1));
          moveTo(lead, tc + T(100), t1, lerp(onBase(1), onBase(2), 0.85));
          lead.poses.push({ t0: tc + T(100), t1, pose: 'run' });
          bump(t1, (d) => (d.outs = Math.min(3, d.outs + 1)));
          jogOff(leadOut, t1 + T(200));
          const t2 = throwTo(t1 + T(150), BASES.second, BASES.first, coverId);
          const bat = actor(batterOut, 'offense', onBase(0));
          moveTo(bat, tc + T(120), t2 + T(80), lerp(onBase(0), onBase(1), 0.9));
          bat.poses.push({ t0: tc + T(120), t1: t2, pose: 'run' });
          bump(t2, (d) => (d.outs = Math.min(3, d.outs + 1)));
          jogOff(batterOut, t2 + T(250));
          labels.push({ t0: tCollect, t1: t2 + T(300), ids: [fielderId ?? batterOut, leadOut, batterOut].filter(Boolean) as PlayerId[] });
          resultAt = t2;
          setCall(resultAt, 'DOUBLE PLAY');
          last = t2;
        } else {
          const firstBaseman = byspot('1B');
          const receiverSpot = fielderSpot === '1B' ? null : firstBaseman;
          if (fielderSpot === '1B' && fielder) {
            moveTo(fielder, tCollect + T(50), tCollect + T(450), BASES.first);
          } else if (receiverSpot) {
            moveTo(actors.get(receiverSpot)!, tc + T(100), tCollect, add(BASES.first, { x: 0.01, y: -0.01 }));
          }
          const tOut = fielderSpot === '1B' ? tCollect + T(450) : throwTo(tCollect + T(120), collect, BASES.first, fielderId);
          const bat = actor(batter, 'offense', onBase(0));
          moveTo(bat, tc + T(120), tOut + T(80), lerp(onBase(0), onBase(1), 0.92));
          bat.poses.push({ t0: tc + T(120), t1: tOut, pose: 'run' });
          bump(tOut, (d) => (d.outs = Math.min(3, d.outs + 1)));
          jogOff(batter, tOut + T(250));
          resultAt = tOut;
          setCall(resultAt, 'OUT');
          last = tOut;
        }
        for (const r of others) {
          if (r.to === 'out' || r.to === r.from) continue;
          const arrive = runBases(r.playerId, r.from, r.to, tc + T(150), perBase, r.to === 4);
          last = Math.max(last, arrive);
          if (r.to === 4) labels.push({ t0: arrive - perBase, t1: arrive + T(300), ids: [r.playerId] });
        }
        end = last;
      } else {
        // Fly out, pop out, sacrifice fly: out on the catch, runners may tag up afterwards.
        const bat = actor(batter, 'offense', onBase(0));
        moveTo(bat, tc + T(120), tCollect, lerp(onBase(0), onBase(1), 0.55));
        bat.poses.push({ t0: tc + T(120), t1: tCollect, pose: 'run' });
        bump(tCollect, (d) => (d.outs = Math.min(3, d.outs + 1)));
        jogOff(batter, tCollect + T(200));
        resultAt = tCollect;
        setCall(resultAt, 'OUT');
        let last = tCollect;
        for (const r of others) {
          if (r.to === 'out' || r.to === r.from) continue;
          const arrive = runBases(r.playerId, r.from, r.to, tCollect + T(100), perBase, r.to === 4);
          last = Math.max(last, arrive);
          if (r.to === 4) {
            labels.push({ t0: tCollect, t1: arrive + T(300), ids: [r.playerId] });
            if (fielder) throwTo(tCollect + T(200), collect, BASES.home, fielderId);
            setCall(arrive, 'SAC FLY');
            resultAt = arrive;
          }
        }
        end = last;
      }
    }
  } else if (s.kind === 'steal' || s.kind === 'caughtStealing') {
    const r = s.runners[0];
    const t0 = intro + T(TIMING.setup);
    const catcher = s.fielder?.playerId ?? byspot('C');
    const tArrive = t0 + T(900);
    const runner = actor(r.playerId, 'offense', onBase(1));
    moveTo(runner, t0, tArrive, r.to === 'out' ? lerp(onBase(1), onBase(2), 0.9) : onBase(2));
    runner.poses.push({ t0, t1: tArrive, pose: 'run' });
    if (catcher) {
      ball.push({ t0: t0 + T(380), t1: tArrive, from: add(FIELDER_SPOTS.C, { x: 0, y: -0.02 }), to: BASES.second, peak: 30 });
      actor(catcher, 'defense', FIELDER_SPOTS.C).poses.push({ t0: t0 + T(300), t1: t0 + T(500), pose: 'throw' });
    }
    const cover = byspot('SS');
    if (cover) moveTo(actors.get(cover)!, t0 + T(100), tArrive - T(100), add(BASES.second, { x: -0.012, y: 0.01 }));
    labels.push({ t0, t1: tArrive + T(500), ids: [r.playerId, ...(catcher ? [catcher] : [])] });
    resultAt = tArrive;
    setCall(resultAt, r.to === 'out' ? 'OUT' : 'SAFE');
    if (r.to === 'out') {
      bump(resultAt, (d) => (d.outs = Math.min(3, d.outs + 1)));
      jogOff(r.playerId, resultAt + T(300));
    }
    end = resultAt + T(400);
  } else if (s.kind === 'pitchingChange') {
    const old = actors.get(s.previousPitcherId!)!;
    moveTo(old, intro + T(200), intro + T(1100), defDugout);
    old.fadeOutAt = intro + T(900);
    const fresh = actor(s.pitcherId, 'defense', defDugout);
    fresh.fadeInAt = intro + T(300);
    moveTo(fresh, intro + T(400), intro + T(1400), MOUND);
    fresh.poses.push({ t0: intro + T(400), t1: intro + T(1400), pose: 'run' });
    labels.push({ t0: intro + T(300), t1: intro + T(2000), ids: [s.pitcherId] });
    resultAt = intro + T(300);
    setCall(resultAt, 'PITCHING CHANGE');
    end = intro + T(1600);
  } else if (s.kind === 'ghostRunner') {
    const id = s.after.bases[1]!;
    const a = actor(id, 'offense', onBase(2));
    a.fadeInAt = intro + T(100);
    labels.push({ t0: intro + T(100), t1: intro + T(1500), ids: [id] });
    resultAt = intro + T(100);
    setCall(resultAt, 'RUNNER ON SECOND');
    end = intro + T(TIMING.special);
  } else {
    resultAt = intro + T(300);
    setCall(resultAt, 'SUDDEN DEATH');
    end = intro + T(TIMING.special);
  }

  // The authoritative after-snapshot always closes the sequence.
  const closeAt = Math.max(end, resultAt);
  updates.push({ t: closeAt, state: display(s.after) });
  const duration = closeAt + T(TIMING.resultHold);

  // Players jog off after the third out so the next half starts clean.
  if (s.after.outs >= 3) {
    for (const id of s.after.bases) if (id) jogOff(id, closeAt);
  }

  return {
    seqIndex: index,
    duration,
    actors: [...actors.values()],
    ball,
    ballHideAt: ball.length ? Math.max(...ball.map((b) => b.t1)) + T(250) : 0,
    labels,
    updates: updates.sort((a, b) => a.t - b.t),
    calls: calls.sort((a, b) => a.t - b.t),
    resultAt,
    commentaryBefore: beforeText,
    commentaryAfter: s.text,
    batterId: s.batterId,
    pitcherId: s.kind === 'pitchingChange' ? s.pitcherId : pitcherId,
  };
}

/** Where the ball ends its flight, derived from the recorded outcome, type and direction. */
function ballTarget(outcome: string, type: string, dir: number, spot: FieldSpot | null): Pt {
  if (outcome === 'homeRun') return fieldPoint(dir, 650);
  if (spot && (outcome === 'groundOut' || outcome === 'doublePlay' || outcome === 'flyOut' || outcome === 'sacFly')) {
    // Close to the fielder who makes the play, nudged toward the recorded direction.
    const home = FIELDER_SPOTS[spot];
    const r = Math.hypot((home.x - BASES.home.x) * VIEW.width, (home.y - BASES.home.y) * VIEW.height);
    return lerp(home, fieldPoint(dir, r), 0.35);
  }
  const r = outcome === 'single' ? (type === 'ground' ? 330 : 370) : outcome === 'double' ? 500 : 540;
  return fieldPoint(dir, r);
}

/** Pre-play commentary: the situation, never the result. */
function describeSituation(ctx: MatchContext, s: MatchSequence): string {
  const bases = s.before.bases;
  const on = ['first', 'second', 'third'].filter((_, i) => bases[i]);
  const situation = on.length === 3 ? 'the bases loaded' : on.length ? `runner${on.length > 1 ? 's' : ''} on ${on.join(' and ')}` : 'the bases empty';
  const outs = `${s.before.outs} out${s.before.outs === 1 ? '' : 's'}`;
  switch (s.kind) {
    case 'plateAppearance':
      return `${ctx.name(s.batterId!)} steps up with ${situation}, ${outs}.`;
    case 'steal':
    case 'caughtStealing':
      return `${ctx.name(s.runners[0].playerId)} takes off for second…`;
    case 'pitchingChange':
      return `The manager walks to the mound.`;
    case 'ghostRunner':
      return `Extra innings: a runner starts on second.`;
    default:
      return `Still tied. The prototype sudden-death rule decides it.`;
  }
}
