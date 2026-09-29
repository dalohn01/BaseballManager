import type { ClubId, MatchResult, MatchSequence, PlayerId, RunnerMove } from '../domain/types';

/**
 * Commentary presentation: turns the simulator's recorded match sequence into
 * an ordered list of commentary steps. Every step carries the complete
 * presented state (score, outs, bases, who is at the plate), so text,
 * scoreboard and field always change together and any step can be shown on
 * its own (resume, skip). The simulator decides everything; this layer only
 * splits a play into readable moments where the recorded data supports it.
 * The texts never invent pitch counts, pitch speed, batted-ball type or which
 * fielder made the play — the engine does not model those.
 */

export type StepTone = 'build' | 'routine' | 'hit' | 'out' | 'score' | 'info' | 'inning' | 'final';

export interface ShownState {
  inning: number;
  half: 'top' | 'bottom';
  battingClubId: ClubId;
  outs: number;
  score: { home: number; away: number };
  /** Confirmed occupants of first, second and third. */
  bases: [PlayerId | null, PlayerId | null, PlayerId | null];
  /** Runners still shown at their last confirmed base but already on the move. */
  advancing: PlayerId[];
  /** Batter at the plate (until he is out or his base has been presented). */
  batterId: PlayerId | null;
  pitcherId: PlayerId;
  /** Brief marker at home plate for a runner who just scored (never an occupied base). */
  scoredId: PlayerId | null;
  /** A play is being told and its final state is not shown yet. */
  inProgress: boolean;
}

export interface CommentaryStep {
  /** Stable id: match, recorded play and part within that play. */
  id: string;
  index: number;
  /** Recorded play this step belongs to (−1 for the game-level final step). */
  seqIndex: number;
  part: number;
  tone: StepTone;
  headline: string | null;
  text: string;
  playerIds: PlayerId[];
  /** Player or spot highlighted on the field. */
  focus: PlayerId | null;
  state: ShownState;
  /** Base display time in ms at 1× speed. */
  duration: number;
  /** The play is finished; the shown state equals the engine's after-state. */
  playDone: boolean;
  /** Runs this step added (for the "+1 RUN" chip). */
  runs: number;
}

export interface CommentaryContext {
  match: MatchResult;
  name: (id: PlayerId) => string;
  clubName: (id: ClubId) => string;
}

/** Base display times (ms at 1×); fine-tune through play-testing. */
export const PACE = {
  build: 1000,
  contact: 1300,
  routine: 1300,
  big: 2100,
  score: 2000,
  settle: 1200,
  info: 1600,
  inning: 1500,
  inningEnd: 1200,
  final: 2600,
  /** Extra reading time per character over `readFree`, capped at `readMax`. */
  perChar: 28,
  readFree: 48,
  readMax: 1200,
} as const;

const BASE_NAME = ['home', 'first', 'second', 'third', 'home'] as const;
const ORD = ['', '1st', '2nd', '3rd'];
export const ordinalOf = (n: number) => (n <= 3 ? ORD[n] : `${n}th`);

function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}

function situation(bases: (PlayerId | null)[], outs: number): string {
  const on = ['first', 'second', 'third'].filter((_, i) => bases[i]);
  const where = on.length === 3 ? 'the bases loaded' : on.length ? `${on.length > 1 ? 'runners' : 'a runner'} on ${on.join(' and ')}` : 'nobody on';
  return `${where}, ${outs === 0 ? 'no' : outs} out${outs === 1 ? '' : 's'}`;
}

const listNames = (names: string[]) => (names.length <= 1 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`);

export function buildCommentary(ctx: CommentaryContext): CommentaryStep[] {
  const { match, name } = ctx;
  const seq = match.sequence ?? [];
  const steps: CommentaryStep[] = [];
  let part = 0;
  let seqIndex = -1;
  const pick = (options: string[]) => options[hash(`${match.id}:${seqIndex}:${part}`) % options.length];

  const push = (s: Omit<CommentaryStep, 'id' | 'index' | 'seqIndex' | 'part' | 'duration' | 'runs'> & { base: number }) => {
    const prev = steps[steps.length - 1]?.state;
    const runs = prev ? s.state.score.home + s.state.score.away - (prev.score.home + prev.score.away) : 0;
    const extra = Math.min(PACE.readMax, Math.max(0, s.text.length + (s.headline?.length ?? 0) - PACE.readFree) * PACE.perChar);
    const { base, ...rest } = s;
    steps.push({ ...rest, id: `${match.id}:${seqIndex}:${part}`, index: steps.length, seqIndex, part, duration: base + extra, runs: Math.max(0, runs) });
    part++;
  };
  const clone = (st: ShownState): ShownState => ({ ...st, bases: [...st.bases] as ShownState['bases'], score: { ...st.score }, advancing: [...st.advancing] });

  const firstOfHalf = (i: number) => i === 0 || seq[i - 1].inning !== seq[i].inning || seq[i - 1].half !== seq[i].half;
  const lastOfHalf = (i: number) => i === seq.length - 1 || seq[i + 1].inning !== seq[i].inning || seq[i + 1].half !== seq[i].half;
  const leadLine = (score: { home: number; away: number }) => {
    if (score.home === score.away) return `It's tied ${score.home}–${score.away}.`;
    const homeAhead = score.home > score.away;
    return `${ctx.clubName(homeAhead ? match.homeId : match.awayId)} lead ${Math.max(score.home, score.away)}–${Math.min(score.home, score.away)}.`;
  };

  for (let i = 0; i < seq.length; i++) {
    const s = seq[i];
    seqIndex = i;
    part = 0;
    const startPitcher = s.kind === 'pitchingChange' ? s.previousPitcherId! : s.pitcherId;
    const base: ShownState = {
      inning: s.inning,
      half: s.half,
      battingClubId: s.battingClubId,
      outs: s.before.outs,
      score: { ...s.before.score },
      bases: [...s.before.bases] as ShownState['bases'],
      advancing: [],
      batterId: null,
      pitcherId: startPitcher,
      scoredId: null,
      inProgress: false,
    };

    if (s.kind === 'suddenDeath') {
      const winner = s.after.score.home > s.before.score.home ? match.homeId : match.awayId;
      push({
        tone: 'score',
        headline: 'SUDDEN DEATH',
        text: `Still tied after ${s.inning}. The prototype sudden-death rule gives ${ctx.clubName(winner)} the deciding run.`,
        playerIds: [],
        focus: null,
        state: { ...clone(base), outs: 0, score: { ...s.after.score }, bases: [null, null, null], battingClubId: winner },
        playDone: true,
        base: PACE.big,
      });
      continue;
    }

    if (firstOfHalf(i)) {
      const scoreText = i === 0 ? `${name(startPitcher)} takes the mound.` : leadLine(s.before.score);
      push({
        tone: 'inning',
        headline: `${s.half === 'top' ? 'TOP' : 'BOTTOM'} ${ordinalOf(s.inning).toUpperCase()}`,
        text: `${ctx.clubName(s.battingClubId)} come to bat. ${scoreText}`,
        playerIds: [startPitcher],
        focus: null,
        state: { ...clone(base), outs: 0, bases: [null, null, null] },
        // Introduces the half; the play it is grouped with has not started yet.
        playDone: false,
        base: PACE.inning,
      });
    }

    const after: ShownState = { ...clone(base), outs: Math.min(3, s.after.outs), score: { ...s.after.score }, bases: [...s.after.bases] as ShownState['bases'], pitcherId: s.pitcherId };

    if (s.kind === 'ghostRunner') {
      const id = s.after.bases[1]!;
      push({ tone: 'info', headline: 'EXTRA INNINGS', text: `${name(id)} starts on second base under the extra-innings rule.`, playerIds: [id], focus: id, state: after, playDone: true, base: PACE.info });
    } else if (s.kind === 'pitchingChange') {
      push({
        tone: 'info',
        headline: 'PITCHING CHANGE',
        text: `${name(s.pitcherId)} comes in to replace ${name(s.previousPitcherId!)}.`,
        playerIds: [s.pitcherId, s.previousPitcherId!],
        focus: s.pitcherId,
        state: after,
        playDone: true,
        base: PACE.info,
      });
    } else if (s.kind === 'steal' || s.kind === 'caughtStealing') {
      const r = s.runners[0];
      const target = r.to === 'out' ? r.from + 1 : r.to;
      // Only when the simulator says the attempt came from the running instruction.
      const why = s.tactic?.kind === 'steal' ? (s.tactic.source === 'instruction' ? ' — his aggressive instruction' : ' — the aggressive running plan') : '';
      push({ tone: 'build', headline: null, text: why ? `${name(r.playerId)} takes his chance for ${BASE_NAME[target]}${why}…` : `${name(r.playerId)} takes off for ${BASE_NAME[target]}…`, playerIds: [r.playerId], focus: r.playerId, state: { ...clone(base), advancing: [r.playerId], inProgress: true }, playDone: false, base: PACE.build });
      if (s.kind === 'steal') {
        push({ tone: 'hit', headline: 'SAFE!', text: `${name(r.playerId)} steals ${BASE_NAME[target]}.`, playerIds: [r.playerId], focus: r.playerId, state: after, playDone: true, base: PACE.big });
      } else {
        push({ tone: 'out', headline: 'CAUGHT STEALING', text: `${name(r.playerId)} is thrown out at ${BASE_NAME[target]}.`, playerIds: [r.playerId], focus: r.playerId, state: after, playDone: true, base: PACE.big });
      }
    } else {
      plateAppearance(s, base, after);
    }

    if (lastOfHalf(i) && s.after.outs >= 3) {
      const left = s.after.bases.filter(Boolean).length;
      push({
        tone: 'inning',
        headline: null,
        text: `That's three outs. End of the ${s.half} of the ${ordinalOf(s.inning)}${left ? ` — ${left} left on base` : ''}.`,
        playerIds: [],
        focus: null,
        state: { ...clone(after), bases: [null, null, null], advancing: [] },
        playDone: true,
        base: PACE.inningEnd,
      });
    }
  }

  // Final: the authoritative result.
  seqIndex = -1;
  part = 0;
  const last = steps[steps.length - 1];
  if (last) {
    const winner = match.runs.home > match.runs.away ? match.homeId : match.awayId;
    const tail = match.decidedBy === 'suddenDeath' ? ' (prototype sudden-death)' : match.innings > 9 ? ` in ${match.innings} innings` : '';
    push({
      tone: 'final',
      headline: match.walkOff ? 'WALK-OFF WIN!' : 'FINAL',
      text: `${ctx.clubName(winner)} win ${Math.max(match.runs.home, match.runs.away)}–${Math.min(match.runs.home, match.runs.away)}${tail}.`,
      playerIds: [],
      focus: null,
      state: { ...clone(last.state), score: { ...match.runs }, advancing: [], batterId: null, scoredId: null, inProgress: false },
      playDone: true,
      base: PACE.final,
    });
  }
  return steps;

  function plateAppearance(s: MatchSequence, before: ShownState, after: ShownState) {
    const batter = s.batterId!;
    const B = name(batter);
    const P = name(s.pitcherId);
    const outcome = s.outcome!;
    const others = s.runners.filter((r) => r.playerId !== batter);
    const batterMove = s.runners.find((r) => r.playerId === batter)!;
    const offenseKey: 'home' | 'away' = s.half === 'top' ? 'away' : 'home';
    // Runs actually credited by the engine (a third out can stop a run from counting).
    const runsCredited = s.after.score[offenseKey] - s.before.score[offenseKey];
    const scorers = s.runners.filter((r) => r.to === 4).slice(0, runsCredited);
    const late = s.inning >= 7 && Math.abs(s.before.score.home - s.before.score.away) <= 2;
    const atPlate: ShownState = { ...clone(before), batterId: batter, inProgress: true };

    // Build-up only when the situation (not the outcome) makes it tense, so it never hints at the result.
    if (s.before.bases.some(Boolean) || late) {
      push({
        tone: 'build',
        headline: null,
        text: pick([`${P} delivers to ${B}…`, `${B} steps in with ${situation(s.before.bases, s.before.outs)}.`, `${P} looks in, ${B} waiting…`]),
        playerIds: [batter, s.pitcherId],
        focus: batter,
        state: atPlate,
        playDone: false,
        base: PACE.build,
      });
    }

    const done = (st: ShownState): ShownState => ({ ...clone(st), batterId: null, advancing: [], scoredId: null, inProgress: false });

    if (outcome === 'homeRun') {
      const n = scorers.length;
      const kind = n === 4 ? 'a grand slam' : n > 1 ? `a ${n}-run home run` : 'a solo home run';
      const ahead = scorers.filter((r) => r.playerId !== batter).map((r) => name(r.playerId));
      push({
        tone: 'score',
        headline: n === 4 ? 'GRAND SLAM!' : 'HOME RUN!',
        text: `${B} hits ${kind}!${ahead.length ? ` ${listNames(ahead)} score${ahead.length > 1 ? '' : 's'} ahead of him.` : ''}`,
        playerIds: [batter, ...scorers.map((r) => r.playerId)],
        focus: batter,
        state: { ...done(after), scoredId: batter },
        playDone: true,
        base: PACE.big,
      });
      return;
    }

    if (outcome === 'doublePlay') {
      const [leadOut, batterOut] = s.outOrder;
      const s1 = clone(atPlate);
      s1.outs = Math.min(3, before.outs + 1);
      s1.bases = s1.bases.map((id) => (id === leadOut ? null : id)) as ShownState['bases'];
      s1.advancing = others.filter((r) => r.to !== 'out' && r.to !== r.from).map((r) => r.playerId);
      push({ tone: 'out', headline: null, text: `${B} hits it on the ground — ${name(leadOut)} is forced out at second.`, playerIds: [leadOut, batter], focus: leadOut, state: s1, playDone: false, base: PACE.contact });
      const s2 = clone(s1);
      s2.outs = Math.min(3, before.outs + 2);
      s2.batterId = null;
      const moreToTell = scorers.length > 0 || s2.advancing.length > 0;
      push({
        tone: 'out',
        headline: 'DOUBLE PLAY!',
        text: `${name(batterOut)} is out at first as well.`,
        playerIds: [batterOut],
        focus: batterOut,
        state: moreToTell ? s2 : done(after),
        playDone: !moreToTell,
        base: PACE.big,
      });
      if (moreToTell) runnersFinish(s, s2, after, scorers, others, null);
      return;
    }

    const isHit = outcome === 'single' || outcome === 'double' || outcome === 'triple';
    const isOut = outcome === 'strikeout' || outcome === 'groundOut' || outcome === 'flyOut' || outcome === 'sacFly';
    const movers = others.filter((r) => r.to !== r.from);
    const simple = movers.length === 0 && scorers.length === 0;

    const result = clone(atPlate);
    if (isOut) {
      result.outs = Math.min(3, before.outs + 1);
      result.batterId = null;
    }
    result.advancing = movers.filter((r) => r.to !== 'out').map((r) => r.playerId);

    let headline: string | null = null;
    let text: string;
    let tone: StepTone = 'routine';
    let base: number = PACE.routine;
    switch (outcome) {
      case 'single':
        headline = 'BASE HIT!';
        text = pick([`${B} singles.`, `${B} gets a base hit.`, `Base hit for ${B}.`]);
        break;
      case 'double':
        headline = 'DOUBLE!';
        text = pick([`${B} doubles.`, `${B} gets a double.`]);
        break;
      case 'triple':
        headline = 'TRIPLE!';
        text = `${B} gets all the way to third — a triple.`;
        break;
      case 'walk':
        text = pick([`${B} draws a walk.`, `Ball four — ${B} walks.`]);
        if (s.before.bases.every(Boolean)) headline = 'BASES-LOADED WALK';
        break;
      case 'strikeout':
        text = pick([`${P} strikes out ${B}.`, `${B} strikes out.`, `Strike three — ${B} is out.`]);
        break;
      case 'groundOut':
        text = pick([`${B} grounds out.`, `${B} hits it on the ground and is thrown out.`]);
        break;
      default:
        text = pick([`${B} flies out.`, `${B} hits a fly ball — caught.`]);
    }
    if (isHit) {
      tone = 'hit';
      base = PACE.big;
    } else if (isOut) {
      tone = 'out';
      // An out that ends the inning with runners stranded matters more than a routine one.
      if (result.outs >= 3 && s.before.bases.some(Boolean)) {
        base = PACE.big;
        headline = outcome === 'strikeout' ? 'STRIKEOUT!' : null;
      }
    } else if (headline) {
      tone = 'hit';
      base = PACE.big;
    }

    if (simple) {
      // Nothing else happens: the result step is also the final state.
      const st = done(after);
      push({ tone, headline, text, playerIds: [batter], focus: batter, state: st, playDone: true, base });
      return;
    }
    push({ tone, headline, text, playerIds: [batter], focus: batter, state: result, playDone: false, base });
    runnersFinish(s, result, after, scorers, others, isOut ? null : batterMove);
  }

  /** Scoring runners one at a time (lead runner first), then the remaining runners settle. */
  function runnersFinish(s: MatchSequence, from: ShownState, after: ShownState, scorers: RunnerMove[], others: RunnerMove[], batterMove: RunnerMove | null) {
    let st = clone(from);
    const offenseKey: 'home' | 'away' = s.half === 'top' ? 'away' : 'home';
    for (const r of scorers) {
      if (r.playerId === s.batterId) continue;
      st = clone(st);
      st.bases = st.bases.map((id) => (id === r.playerId ? null : id)) as ShownState['bases'];
      st.advancing = st.advancing.filter((id) => id !== r.playerId);
      st.score[offenseKey] += 1;
      st.scoredId = r.playerId;
      const sac = s.outcome === 'sacFly';
      push({
        tone: 'score',
        headline: 'SCORES!',
        text: sac
          ? `${name(r.playerId)} tags up and scores on the sacrifice fly.`
          : s.tactic?.kind === 'extraBase' && s.tactic.playerId === r.playerId
            ? `${name(r.playerId)} keeps running and scores — ${s.tactic.source === 'instruction' ? 'his aggressive instruction' : 'aggressive baserunning'} pays off!`
            : pick([`${name(r.playerId)} crosses home plate!`, `${name(r.playerId)} comes home to score!`]),
        playerIds: [r.playerId],
        focus: r.playerId,
        state: st,
        playDone: false,
        base: PACE.score,
      });
    }
    // A runner sent on a hit and thrown out (only aggressive running does this): its own step, after the runs.
    if (s.outcome === 'single' || s.outcome === 'double') {
      for (const r of others.filter((x) => x.to === 'out')) {
        st = clone(st);
        st.bases = st.bases.map((id) => (id === r.playerId ? null : id)) as ShownState['bases'];
        st.advancing = st.advancing.filter((id) => id !== r.playerId);
        st.outs = Math.min(3, st.outs + 1);
        st.scoredId = null;
        const target = s.outcome === 'single' && r.from === 1 ? 'third' : 'home';
        const own = s.tactic?.kind === 'thrownOut' && s.tactic.playerId === r.playerId && s.tactic.source === 'instruction';
        push({
          tone: 'out',
          headline: 'OUT AT ' + target.toUpperCase() + '!',
          text: `${name(r.playerId)} tries for ${target} ${own ? 'on his aggressive instruction' : 'on aggressive running'} and is thrown out.`,
          playerIds: [r.playerId],
          focus: r.playerId,
          state: st,
          playDone: false,
          base: PACE.big,
        });
      }
    }
    const settling = others.filter((r) => r.to !== 4 && r.to !== 'out' && r.to !== r.from);
    const parts = settling.map((r) =>
      s.tactic?.kind === 'extraBase' && s.tactic.playerId === r.playerId ? `${name(r.playerId)} takes ${BASE_NAME[r.to as number]} on aggressive running.` : `${name(r.playerId)} to ${BASE_NAME[r.to as number]}.`,
    );
    if (batterMove && batterMove.to !== 'out' && batterMove.to !== 4) parts.push(`${name(batterMove.playerId)} to ${BASE_NAME[batterMove.to]}.`);
    const final: ShownState = { ...clone(after), batterId: null, advancing: [], scoredId: null, inProgress: false };
    if (parts.length) {
      push({ tone: 'routine', headline: null, text: parts.join(' '), playerIds: [...settling.map((r) => r.playerId), ...(batterMove ? [batterMove.playerId] : [])], focus: null, state: final, playDone: true, base: PACE.settle });
    } else {
      // Nothing left to move: close the play on the last step with the authoritative state.
      const lastStep = steps[steps.length - 1];
      lastStep.state = { ...final, scoredId: lastStep.state.scoredId };
      lastStep.playDone = true;
    }
  }
}

/** Hits, walks and strikeouts per club, counted only from steps already presented. */
export function gameSoFar(match: MatchResult, steps: CommentaryStep[], through: number) {
  const seq = match.sequence ?? [];
  const done = new Set<number>();
  for (let k = 0; k <= through && k < steps.length; k++) if (steps[k].playDone && steps[k].seqIndex >= 0) done.add(steps[k].seqIndex);
  const row = () => ({ h: 0, bb: 0, k: 0 });
  const out: Record<string, ReturnType<typeof row>> = { [match.homeId]: row(), [match.awayId]: row() };
  for (const i of done) {
    const st = seq[i];
    if (st.kind !== 'plateAppearance') continue;
    const r = out[st.battingClubId];
    if (['single', 'double', 'triple', 'homeRun'].includes(st.outcome!)) r.h++;
    if (st.outcome === 'walk') r.bb++;
    if (st.outcome === 'strikeout') r.k++;
  }
  return out;
}

/** A batter's line today (hits for at-bats), counted only from finished, presented plays. */
export function todayLine(match: MatchResult, steps: CommentaryStep[], through: number, id: PlayerId) {
  const seq = match.sequence ?? [];
  let ab = 0;
  let h = 0;
  const seen = new Set<number>();
  for (let k = 0; k <= through && k < steps.length; k++) {
    const st = steps[k];
    if (!st.playDone || st.seqIndex < 0 || seen.has(st.seqIndex)) continue;
    seen.add(st.seqIndex);
    const p = seq[st.seqIndex];
    if (p.kind !== 'plateAppearance' || p.batterId !== id) continue;
    if (p.outcome !== 'walk' && p.outcome !== 'sacFly') ab++;
    if (['single', 'double', 'triple', 'homeRun'].includes(p.outcome!)) h++;
  }
  return { ab, h };
}

/** A pitcher's line today, counted only from finished, presented plays (never ahead of the commentary). */
export function pitcherLine(match: MatchResult, steps: CommentaryStep[], through: number, pitcherId: PlayerId) {
  const seq = match.sequence ?? [];
  const line = { bf: 0, outs: 0, h: 0, r: 0, bb: 0, k: 0, hr: 0 };
  const seen = new Set<number>();
  for (let k = 0; k <= through && k < steps.length; k++) {
    const st = steps[k];
    if (!st.playDone || st.seqIndex < 0 || seen.has(st.seqIndex)) continue;
    seen.add(st.seqIndex);
    const p = seq[st.seqIndex];
    if (p.pitcherId !== pitcherId || p.kind === 'pitchingChange') continue;
    const off: 'home' | 'away' = p.half === 'top' ? 'away' : 'home';
    line.outs += Math.max(0, Math.min(3, p.after.outs) - p.before.outs);
    line.r += p.after.score[off] - p.before.score[off];
    if (p.kind !== 'plateAppearance') continue;
    line.bf += 1;
    if (['single', 'double', 'triple', 'homeRun'].includes(p.outcome!)) line.h += 1;
    if (p.outcome === 'homeRun') line.hr += 1;
    if (p.outcome === 'walk') line.bb += 1;
    if (p.outcome === 'strikeout') line.k += 1;
  }
  return line;
}
