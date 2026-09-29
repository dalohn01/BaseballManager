import { BALANCE } from '../balance/config';
import type { ClubId, MatchResult, PlayerId } from '../domain/types';
import type { CommentaryStep } from './commentary';

/*
 * The box score as presented so far: one shared model for the match summary,
 * standouts, the full box score and the player panels. Only plays whose
 * commentary has been shown to the end count, so nothing is revealed early;
 * team runs come straight from the scoreboard state of the current step
 * (a run appears exactly on its "Scores!" step). At the last step this equals
 * the engine's box score.
 */

export interface BatLine {
  id: PlayerId;
  clubId: ClubId;
  pa: number;
  ab: number;
  h: number;
  doubles: number;
  triples: number;
  hr: number;
  r: number;
  rbi: number;
  bb: number;
  k: number;
}

export interface PitchLine {
  id: PlayerId;
  clubId: ClubId;
  bf: number;
  outs: number;
  h: number;
  r: number;
  bb: number;
  k: number;
  hr: number;
}

export interface TeamLine {
  clubId: ClubId;
  r: number;
  h: number;
  hr: number;
  bb: number;
  k: number;
}

export interface PresentedBox {
  batting: Record<ClubId, BatLine[]>;
  pitching: Record<ClubId, PitchLine[]>;
  teams: Record<ClubId, TeamLine>;
}

const HITS = new Set(['single', 'double', 'triple', 'homeRun']);

/** Indices of plays whose commentary has been shown to the end (up to step `through`). */
export function finishedPlays(steps: CommentaryStep[], through: number): number[] {
  const seen = new Set<number>();
  for (let k = 0; k <= through && k < steps.length; k++) {
    const st = steps[k];
    if (st.playDone && st.seqIndex >= 0 && st.tone !== 'inning') seen.add(st.seqIndex);
  }
  return [...seen].sort((a, b) => a - b);
}

export function presentedBox(match: MatchResult, steps: CommentaryStep[], through: number): PresentedBox {
  const seq = match.sequence ?? [];
  const bat = new Map<PlayerId, BatLine>();
  const pit = new Map<PlayerId, PitchLine>();
  const sides: ['home' | 'away', ClubId][] = [
    ['away', match.awayId],
    ['home', match.homeId],
  ];
  // Every batter in either lineup takes part from the first pitch; starters too.
  for (const [side, clubId] of sides) {
    for (const slot of match.lineups[side].battingOrder) bat.set(slot.playerId, { id: slot.playerId, clubId, pa: 0, ab: 0, h: 0, doubles: 0, triples: 0, hr: 0, r: 0, rbi: 0, bb: 0, k: 0 });
    const sp = match.lineups[side].pitcherId;
    pit.set(sp, { id: sp, clubId, bf: 0, outs: 0, h: 0, r: 0, bb: 0, k: 0, hr: 0 });
  }
  const defenseOf = (battingClubId: ClubId) => (battingClubId === match.homeId ? match.awayId : match.homeId);
  const pitcher = (id: PlayerId, clubId: ClubId) => {
    let l = pit.get(id);
    if (!l) {
      l = { id, clubId, bf: 0, outs: 0, h: 0, r: 0, bb: 0, k: 0, hr: 0 };
      pit.set(id, l);
    }
    return l;
  };

  for (const i of finishedPlays(steps, through)) {
    const p = seq[i];
    const defClub = defenseOf(p.battingClubId);
    // A reliever who has been announced appears in the box score from then on.
    if (p.kind === 'pitchingChange') {
      pitcher(p.pitcherId, defClub);
      continue;
    }
    if (p.kind === 'suddenDeath' || p.kind === 'ghostRunner') continue;
    const off: 'home' | 'away' = p.half === 'top' ? 'away' : 'home';
    const runs = p.after.score[off] - p.before.score[off];
    const pl = pitcher(p.pitcherId, defClub);
    pl.outs += Math.max(0, Math.min(3, p.after.outs) - p.before.outs);
    pl.r += runs;
    for (const r of p.runners) if (r.to === 4) bat.get(r.playerId) && (bat.get(r.playerId)!.r += 1);
    if (p.kind !== 'plateAppearance') continue;
    const b = bat.get(p.batterId!);
    if (!b) continue;
    pl.bf += 1;
    b.pa += 1;
    const o = p.outcome!;
    if (o !== 'walk' && o !== 'sacFly') b.ab += 1;
    if (HITS.has(o)) {
      b.h += 1;
      pl.h += 1;
    }
    if (o === 'double') b.doubles += 1;
    if (o === 'triple') b.triples += 1;
    if (o === 'homeRun') {
      b.hr += 1;
      pl.hr += 1;
    }
    if (o === 'walk') {
      b.bb += 1;
      pl.bb += 1;
    }
    if (o === 'strikeout') {
      b.k += 1;
      pl.k += 1;
    }
    // No RBI on a double play (engine rule).
    if (o !== 'doublePlay') b.rbi += runs;
  }

  const batting: Record<ClubId, BatLine[]> = { [match.awayId]: [], [match.homeId]: [] };
  const pitching: Record<ClubId, PitchLine[]> = { [match.awayId]: [], [match.homeId]: [] };
  for (const [side, clubId] of sides) {
    batting[clubId] = match.lineups[side].battingOrder.map((s) => bat.get(s.playerId)!);
    pitching[clubId] = [...pit.values()].filter((l) => l.clubId === clubId);
  }
  // Team runs follow the scoreboard of the step on screen (runs show on their Scores! step).
  const score = steps[Math.min(through, steps.length - 1)]?.state.score ?? { home: 0, away: 0 };
  const teams: Record<ClubId, TeamLine> = {};
  for (const [side, clubId] of sides) {
    const lines = batting[clubId];
    teams[clubId] = {
      clubId,
      r: score[side],
      h: lines.reduce((a, l) => a + l.h, 0),
      hr: lines.reduce((a, l) => a + l.hr, 0),
      bb: lines.reduce((a, l) => a + l.bb, 0),
      k: lines.reduce((a, l) => a + l.k, 0),
    };
  }
  return { batting, pitching, teams };
}

export const inningsPitched = (outs: number) => `${Math.floor(outs / 3)}.${outs % 3}`;

// ---------- Standouts ----------

export interface Standout {
  id: PlayerId;
  clubId: ClubId;
  kind: 'batter' | 'pitcher';
  score: number;
  /** Visible performance line that explains the pick. */
  line: string;
}

/**
 * Internal selection score from this game only (never OVR, season or
 * popularity). Batters: hits, extra bases, home runs, RBI, runs and walks
 * against failed at-bats. Pitchers need a minimum number of outs, then outs
 * and strikeouts count against runs, hits and walks allowed.
 */
export function batterScore(l: BatLine): number {
  const w = BALANCE.match.standouts.batter;
  return w.hit * l.h + w.extraBase * (l.doubles + 2 * l.triples) + w.homeRun * l.hr + w.rbi * l.rbi + w.run * l.r + w.walk * l.bb - w.out * (l.ab - l.h);
}

export function pitcherScore(l: PitchLine): number {
  const w = BALANCE.match.standouts.pitcher;
  if (l.outs < w.minOuts) return -Infinity;
  return w.out * l.outs + w.strikeout * l.k - w.run * l.r - w.hitOrWalk * (l.h + l.bb);
}

export function batterLine(l: BatLine): string {
  const parts = [`${l.h}–${l.ab}`];
  if (l.hr) parts.push(`${l.hr} HR`);
  else if (l.doubles + l.triples) parts.push(`${l.doubles + l.triples} XBH`);
  if (l.rbi) parts.push(`${l.rbi} RBI`);
  if (l.r && parts.length < 3) parts.push(`${l.r} R`);
  if (l.bb && parts.length < 3) parts.push(`${l.bb} BB`);
  return parts.join(' · ');
}

export const pitcherLineText = (l: PitchLine) => `${inningsPitched(l.outs)} IP · ${l.r} R · ${l.k} K`;

function candidates(box: PresentedBox): Standout[] {
  const out: Standout[] = [];
  const min = BALANCE.match.standouts.minScore;
  for (const lines of Object.values(box.batting)) for (const l of lines) {
    const score = batterScore(l);
    if (score >= min) out.push({ id: l.id, clubId: l.clubId, kind: 'batter', score, line: batterLine(l) });
  }
  for (const lines of Object.values(box.pitching)) for (const l of lines) {
    const score = pitcherScore(l);
    if (score >= min) out.push({ id: l.id, clubId: l.clubId, kind: 'pitcher', score, line: pitcherLineText(l) });
  }
  return out.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
}

/**
 * Up to two standouts at step `through`, re-evaluated after each finished
 * play. The current picks stay unless a new candidate is clearly better (by
 * the configured margin), so the list does not flicker on small differences.
 * Pure: the same step always gives the same list (reload-safe).
 */
export function standouts(match: MatchResult, steps: CommentaryStep[], through: number): Standout[] {
  const { margin, slots } = BALANCE.match.standouts;
  const boundaries = finishedPlays(steps, through);
  let picks: PlayerId[] = [];
  let last: Standout[] = [];
  // Walk play by play: only a completed play can change the selection.
  const stepAt = (seqIndex: number) => {
    for (let k = Math.min(through, steps.length - 1); k >= 0; k--) if (steps[k].seqIndex === seqIndex && steps[k].playDone) return k;
    return through;
  };
  for (const i of boundaries) {
    const pool = candidates(presentedBox(match, steps, stepAt(i)));
    const byId = new Map(pool.map((c) => [c.id, c]));
    // Keep current picks that still qualify.
    picks = picks.filter((id) => byId.has(id));
    for (const c of pool) {
      if (picks.includes(c.id)) continue;
      if (picks.length < slots) {
        picks.push(c.id);
        continue;
      }
      const weakest = picks.map((id) => byId.get(id)!).sort((a, b) => a.score - b.score)[0];
      if (c.score > weakest.score + margin) picks = [...picks.filter((id) => id !== weakest.id), c.id];
    }
    last = picks.map((id) => byId.get(id)!).sort((a, b) => b.score - a.score);
  }
  return last;
}
