import type { ClubId, MatchResult, PlayerId } from '../domain/types';

/*
 * Pitchers of record and a short recap, read from the recorded sequence (no
 * new randomness). Simplified scoring rules:
 * - Loss: the losing side's pitcher on the mound when the winners took the
 *   lead for good.
 * - Win: the winners' pitcher of record at that moment; a starter needs five
 *   innings (15 outs), otherwise the win goes to the reliever with the most outs.
 * - Save: the winners' finishing reliever (not the winner), who got at least one
 *   out and entered with a lead of 1–3 runs, or pitched three innings.
 * A game decided without a lead change (sudden death) has no pitchers of record.
 */

export interface PitcherDecisions {
  win: PlayerId | null;
  loss: PlayerId | null;
  save: PlayerId | null;
  winnerId: ClubId | null;
}

type Side = 'home' | 'away';

interface GoAhead {
  index: number;
  inning: number;
  half: 'top' | 'bottom';
  /** Winners' runs in that half-inning. */
  runsInHalf: number;
  winPitcher: PlayerId;
  lossPitcher: PlayerId;
}

function winnerSide(m: MatchResult): Side | null {
  if (m.runs.home === m.runs.away) return null;
  return m.runs.home > m.runs.away ? 'home' : 'away';
}

/** The moment the winners took the lead for good, with the pitchers involved. */
function goAhead(m: MatchResult): GoAhead | null {
  const w = winnerSide(m);
  if (!w || !m.sequence?.length) return null;
  const l: Side = w === 'home' ? 'away' : 'home';
  const onMound: Record<Side, PlayerId> = { home: m.lineups.home.pitcherId, away: m.lineups.away.pitcherId };
  let found: GoAhead | null = null;
  for (const e of m.sequence) {
    const fielding: Side = e.battingClubId === m.homeId ? 'away' : 'home';
    onMound[fielding] = e.pitcherId;
    const b = e.before.score;
    const a = e.after.score;
    if (b[w] <= b[l] && a[w] > a[l]) found = { index: e.index, inning: e.inning, half: e.half, runsInHalf: 0, winPitcher: onMound[w], lossPitcher: e.pitcherId };
  }
  if (found) {
    const g = found;
    const half = m.sequence.filter((e) => e.inning === g.inning && e.half === g.half);
    const first = half[0]?.before.score[w] ?? 0;
    const last = half.at(-1)?.after.score[w] ?? first;
    g.runsInHalf = last - first;
  }
  return found;
}

export function pitcherDecisions(m: MatchResult): PitcherDecisions {
  const w = winnerSide(m);
  const none: PitcherDecisions = { win: null, loss: null, save: null, winnerId: w ? (w === 'home' ? m.homeId : m.awayId) : null };
  const g = goAhead(m);
  if (!w || !g) return none;
  const l: Side = w === 'home' ? 'away' : 'home';
  const starter = m.lineups[w].pitcherId;
  const relievers = m.pitchersUsed[w].filter((id) => id !== starter);
  let win = g.winPitcher;
  if (win === starter && (m.pitching[starter]?.outs ?? 0) < 15 && relievers.length) {
    win = [...relievers].sort((a, b) => (m.pitching[b]?.outs ?? 0) - (m.pitching[a]?.outs ?? 0))[0];
  }
  let save: PlayerId | null = null;
  const finisher = m.pitchersUsed[w].at(-1);
  if (finisher && finisher !== win && finisher !== starter) {
    const entry = m.sequence!.find((e) => e.pitcherId === finisher && (e.battingClubId === m.homeId ? 'away' : 'home') === w);
    const lead = entry ? entry.before.score[w] - entry.before.score[l] : 0;
    const outs = m.pitching[finisher]?.outs ?? 0;
    if (outs >= 1 && lead > 0 && (lead <= 3 || outs >= 9)) save = finisher;
  }
  return { ...none, win, loss: g.lossPitcher, save };
}

const ORD = ['zeroth', 'first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth'];
const ordinal = (n: number) => ORD[n] ?? `${n}th`;
const NUM = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];
const num = (n: number) => NUM[n] ?? String(n);

/**
 * A two-sentence recap: how the winners got the lead for good, and how the
 * game finished. Names are the clubs' short names.
 */
export function matchRecap(m: MatchResult, names: Record<ClubId, string>): string {
  const w = winnerSide(m);
  if (!w) return 'The game ended level.';
  const l: Side = w === 'home' ? 'away' : 'home';
  const W = names[w === 'home' ? m.homeId : m.awayId];
  const L = names[l === 'home' ? m.homeId : m.awayId];
  const margin = m.runs[w] - m.runs[l];
  if (m.decidedBy === 'suddenDeath') return `Level after extra innings, the ${W} won it in the sudden-death decider.`;
  const g = goAhead(m);
  if (!g) return `The ${W} won ${m.runs[w]}–${m.runs[l]}.`;
  let first: string;
  if (m.walkOff && g.half === 'bottom' && g.inning >= 9) {
    first = `The ${W} won it with a walk-off in the ${ordinal(g.inning)}.`;
  } else if (g.inning === 1) {
    first = `The ${W} took the lead in the first and never gave it up.`;
  } else {
    const big = g.runsInHalf >= 2 ? `A ${num(g.runsInHalf)}-run ${ordinal(g.inning)}` : `A run in the ${ordinal(g.inning)}`;
    first = `${big} put the ${W} ahead for good.`;
  }
  // The losers' reply after the go-ahead half (same inning's other half included).
  const after = (m.sequence ?? []).filter((e) => e.index > g.index);
  const lateRuns = after.length ? (after.at(-1)!.after.score[l] - after[0].before.score[l]) : 0;
  let second: string;
  if (margin === 1 && lateRuns > 0) second = `The ${L} answered with ${num(lateRuns)}, but could not find the tying run.`;
  else if (margin === 1) second = `The ${L} could not find the tying run.`;
  else if (margin >= 5) second = `It was never close after that: ${m.runs[w]}–${m.runs[l]}.`;
  else if (lateRuns > 0) second = `The ${L} got ${num(lateRuns)} back, but it finished ${m.runs[w]}–${m.runs[l]}.`;
  else second = `The ${L} did not score again.`;
  if (m.walkOff && g.half === 'bottom' && g.inning >= 9) second = m.innings > 9 ? `It took ${m.innings} innings.` : `Final: ${m.runs[w]}–${m.runs[l]}.`;
  return `${first} ${second}`;
}
