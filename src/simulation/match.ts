import { BALANCE } from '../balance/config';
import { effectiveRating, fieldingAt, offenseScore } from '../domain/lineup';
import { clamp, hashSeed, type Rng } from '../domain/rng';
import type { GameState } from '../domain/state';
import type {
  BaseState,
  BattingLine,
  ClubId,
  DecidedBy,
  FieldSpot,
  GameId,
  Lineup,
  MatchResult,
  MatchSequence,
  PaOutcome,
  PitchingLine,
  PitchingPlan,
  PlayKind,
  PlayRecord,
  Player,
  PlayerId,
  RunnerMove,
} from '../domain/types';

/**
 * Lightweight at-bat simulation. Documented simplifications (see README):
 * - no errors, hit-by-pitch, bunts, wild pitches or pinch hitters
 * - one pitching change at most (starter → planned or best-rested reliever)
 * - from inning 10 a runner starts on second (prototype extra-innings rule)
 * - after inning 15 a clearly labelled sudden-death decides a tie
 * - on a walk-off, all runs of the deciding play count
 */

interface SimBatter {
  id: PlayerId;
  name: string;
  contact: number;
  power: number;
  speed: number;
}
interface SimPitcher {
  id: PlayerId;
  name: string;
  pitching: number;
}
export interface SimTeam {
  clubId: ClubId;
  name: string;
  lineup: Lineup;
  batters: SimBatter[];
  starter: SimPitcher;
  reliever: SimPitcher | null;
  /** When this team's starter is replaced (from its pitching plan). */
  hook: { maxBatters: number; pullRuns: number; minBatters: number };
  fielding: number;
  catcherFielding: number;
  strength: number;
}

export function buildSimTeam(state: GameState, clubId: ClubId, lineup: Lineup): SimTeam {
  const club = state.clubs[clubId];
  const batters = lineup.battingOrder.map((slot) => {
    const p = state.players[slot.playerId];
    return {
      id: p.id,
      name: p.lastName,
      contact: effectiveRating(p, 'contact'),
      power: effectiveRating(p, 'power'),
      speed: effectiveRating(p, 'speed'),
    };
  });
  const defenders = lineup.battingOrder.filter((s) => s.position !== 'DH');
  const fielding = defenders.reduce((sum, s) => sum + fieldingAt(state.players[s.playerId], s.position), 0) / defenders.length;
  const catcherSlot = defenders.find((s) => s.position === 'C');
  const catcherFielding = catcherSlot ? fieldingAt(state.players[catcherSlot.playerId], 'C') : 40;

  const sp = state.players[lineup.pitcherId];
  const starter = { id: sp.id, name: sp.lastName, pitching: effectiveRating(sp, 'pitching') };
  const plan = club.pitchingPlan;
  const rp = chooseReliever(state, clubId, sp.id, plan);
  const reliever = rp ? { id: rp.id, name: rp.lastName, pitching: effectiveRating(rp, 'pitching') } : null;

  return {
    clubId,
    name: club.name,
    lineup,
    batters,
    starter,
    reliever,
    hook: BALANCE.match.hooks[plan.hook],
    fielding,
    catcherFielding,
    strength: teamStrength(state, lineup),
  };
}

/**
 * The pitcher who comes in when the starter is replaced: the planned reliever if
 * he is available, otherwise the best-rested pitcher who is not resting today.
 * Pitchers marked "rest" are never used. Null = the starter pitches the whole game.
 */
export function chooseReliever(state: GameState, clubId: ClubId, starterId: PlayerId, plan: PitchingPlan): Player | null {
  const available = state.clubs[clubId].roster
    .map((id) => state.players[id])
    .filter((p) => p.isPitcher && p.id !== starterId && !plan.rest.includes(p.id));
  const planned = available.find((p) => p.id === plan.relieverId);
  if (planned) return planned;
  const value = (p: Player) => effectiveRating(p, 'pitching') - (100 - p.fitness) * 1.5;
  return [...available].sort((a, b) => value(b) - value(a) || a.id.localeCompare(b.id))[0] ?? null;
}

/** Single comprehensible number (0–100-ish) used for forecasts and sudden-death. */
export function teamStrength(state: GameState, lineup: Lineup): number {
  const bats = lineup.battingOrder.map((s) => offenseScore(state.players[s.playerId]));
  const offense = bats.reduce((a, b) => a + b, 0) / Math.max(1, bats.length);
  const defenders = lineup.battingOrder.filter((s) => s.position !== 'DH');
  const defense = defenders.reduce((a, s) => a + fieldingAt(state.players[s.playerId], s.position), 0) / Math.max(1, defenders.length);
  const sp = state.players[lineup.pitcherId];
  const pitching = sp ? effectiveRating(sp, 'pitching') : 30;
  return offense * 0.45 + defense * 0.2 + pitching * 0.35;
}

export function winProbability(homeStrength: number, awayStrength: number): number {
  const diff = homeStrength + BALANCE.match.homeAdvantage - awayStrength;
  return 1 / (1 + Math.exp(-diff / 7));
}

type Outcome = 'strikeout' | 'walk' | 'single' | 'double' | 'triple' | 'homeRun' | 'groundOut' | 'flyOut';

function rollOutcome(b: SimBatter, pitching: number, fielding: number, rng: Rng): Outcome {
  const walk = clamp(0.085 + (50 - pitching) * 0.0012 + (b.contact - 50) * 0.0004, 0.03, 0.16);
  const k = clamp(0.215 + (pitching - b.contact) * 0.0035, 0.07, 0.4);
  const r = rng.next();
  if (r < k) return 'strikeout';
  if (r < k + walk) return 'walk';
  const hitChance = clamp(0.315 + (b.contact - pitching) * 0.0022 - (fielding - 50) * 0.0018, 0.18, 0.42);
  if (rng.next() < hitChance) {
    const hr = clamp(0.11 + (b.power - 50) * 0.005, 0.02, 0.28);
    const triple = clamp(0.02 + (b.speed - 50) * 0.0008, 0.005, 0.05);
    const dbl = clamp(0.2 + (b.power - 50) * 0.002, 0.1, 0.3);
    const t = rng.next();
    if (t < hr) return 'homeRun';
    if (t < hr + triple) return 'triple';
    if (t < hr + triple + dbl) return 'double';
    return 'single';
  }
  return rng.chance(0.5) ? 'groundOut' : 'flyOut';
}

const emptyBatting = (): BattingLine => ({ pa: 0, ab: 0, h: 0, doubles: 0, triples: 0, hr: 0, rbi: 0, r: 0, bb: 0, so: 0, sb: 0 });
const emptyPitching = (): PitchingLine => ({ battersFaced: 0, outs: 0, h: 0, r: 0, bb: 0, so: 0 });

export interface MatchInput {
  id: GameId;
  season: number;
  round: number;
  home: SimTeam;
  away: SimTeam;
  rng: Rng;
}

export function simulateMatch(input: MatchInput): MatchResult {
  const { home, away, rng } = input;
  const cfg = BALANCE.match;
  const batting: Record<PlayerId, BattingLine> = {};
  const pitching: Record<PlayerId, PitchingLine> = {};
  const plays: PlayRecord[] = [];
  const score = { home: 0, away: 0 };
  const hits = { home: 0, away: 0 };
  const linescore: { home: (number | null)[]; away: number[] } = { home: [], away: [] };
  const names: Record<PlayerId, string> = {};
  for (const t of [home, away]) {
    for (const b of t.batters) {
      batting[b.id] = emptyBatting();
      names[b.id] = b.name;
    }
    names[t.starter.id] = t.starter.name;
    if (t.reliever) names[t.reliever.id] = t.reliever.name;
  }

  const side = {
    home: { team: home, idx: 0, pitcher: home.starter, pulled: false, used: [home.starter.id] as PlayerId[] },
    away: { team: away, idx: 0, pitcher: away.starter, pulled: false, used: [away.starter.id] as PlayerId[] },
  };
  pitching[home.starter.id] = emptyPitching();
  pitching[away.starter.id] = emptyPitching();

  let inning = 0;
  let walkOff = false;
  let decidedBy: DecidedBy = 'regulation';
  const sequence: MatchSequence[] = [];
  /** Runners who scored during the step currently being recorded. */
  let stepRuns: PlayerId[] = [];

  const playHalf = (half: 'top' | 'bottom') => {
    const battingKey = half === 'top' ? 'away' : 'home';
    const fieldingKey = half === 'top' ? 'home' : 'away';
    const off = side[battingKey];
    const def = side[fieldingKey];
    const line = linescore[battingKey];
    line.push(0);
    let outs = 0;
    const bases: (PlayerId | null)[] = [null, null, null];

    const record = (kind: PlayKind, text: string, runs: number, batterId?: PlayerId) => {
      plays.push({
        inning,
        half,
        battingClubId: off.team.clubId,
        kind,
        text,
        runs,
        outs,
        score: { ...score },
        batterId,
        pitcherId: def.pitcher.id,
      });
    };
    const isWalkOff = () => half === 'bottom' && inning >= cfg.innings && score.home > score.away;

    const snap = (): BaseState => ({ outs, bases: [bases[0], bases[1], bases[2]], score: { ...score } });
    const push = (s: Omit<MatchSequence, 'index' | 'inning' | 'half' | 'battingClubId'>) =>
      sequence.push({ index: sequence.length, inning, half, battingClubId: off.team.clubId, ...s });
    const fielderAt = (spot: FieldSpot): PlayerId | null =>
      spot === 'P' ? def.pitcher.id : (def.team.lineup.battingOrder.find((s) => s.position === spot)?.playerId ?? null);

    const scoreRun = (runnerId: PlayerId, rbiBatter: PlayerId | null) => {
      stepRuns.push(runnerId);
      score[battingKey] += 1;
      line[line.length - 1] = (line[line.length - 1] ?? 0) + 1;
      batting[runnerId].r += 1;
      if (rbiBatter) batting[rbiBatter].rbi += 1;
      pitching[def.pitcher.id].r += 1;
    };

    if (inning >= cfg.ghostRunnerFromInning) {
      const ghost = off.team.batters[(off.idx + 8) % 9];
      const before = snap();
      bases[1] = ghost.id;
      record('ghostRunner', `${ghost.name} starts on second (extra-innings rule).`, 0);
      push({ kind: 'ghostRunner', batterId: null, pitcherId: def.pitcher.id, outcome: null, before, after: snap(), runners: [], outOrder: [], fielder: null, ball: null, text: `${ghost.name} starts on second (extra-innings rule).` });
    }

    while (outs < 3) {
      // Pitching change
      const pl = pitching[def.pitcher.id];
      if (
        !def.pulled &&
        def.team.reliever &&
        (pl.battersFaced >= def.team.hook.maxBatters || (pl.r >= def.team.hook.pullRuns && pl.battersFaced >= def.team.hook.minBatters))
      ) {
        def.pulled = true;
        const prev = def.pitcher;
        def.pitcher = def.team.reliever;
        def.used.push(def.pitcher.id);
        pitching[def.pitcher.id] = emptyPitching();
        record('pitchingChange', `Pitching change: ${def.pitcher.name} replaces ${prev.name}.`, 0);
        const s = snap();
        push({ kind: 'pitchingChange', batterId: null, pitcherId: def.pitcher.id, previousPitcherId: prev.id, outcome: null, before: s, after: s, runners: [], outOrder: [], fielder: null, ball: null, text: `Pitching change: ${def.pitcher.name} replaces ${prev.name}.` });
      }

      // Stolen base attempt: runner on first, second open.
      const r1 = bases[0];
      if (r1 && !bases[1] && outs < 2) {
        const runner = off.team.batters.find((b) => b.id === r1)!;
        const attempt = runner.speed >= 60 ? 0.05 + (runner.speed - 60) * 0.004 : 0;
        if (attempt > 0 && rng.chance(attempt)) {
          const success = clamp(0.62 + (runner.speed - 50) * 0.008 - (def.team.catcherFielding - 50) * 0.004, 0.4, 0.92);
          const before = snap();
          const catcher = fielderAt('C');
          if (rng.chance(success)) {
            bases[1] = r1;
            bases[0] = null;
            batting[r1].sb += 1;
            record('steal', `${runner.name} steals second.`, 0, r1);
            push({ kind: 'steal', batterId: null, pitcherId: def.pitcher.id, outcome: null, before, after: snap(), runners: [{ playerId: r1, from: 1, to: 2 }], outOrder: [], fielder: catcher ? { spot: 'C', playerId: catcher } : null, ball: null, text: `${runner.name} steals second.` });
          } else {
            bases[0] = null;
            outs += 1;
            pitching[def.pitcher.id].outs += 1;
            record('caughtStealing', `${runner.name} is caught stealing.`, 0, r1);
            push({ kind: 'caughtStealing', batterId: null, pitcherId: def.pitcher.id, outcome: null, before, after: snap(), runners: [{ playerId: r1, from: 1, to: 'out' }], outOrder: [r1], fielder: catcher ? { spot: 'C', playerId: catcher } : null, ball: null, text: `${runner.name} is caught stealing.` });
            if (outs >= 3) break;
          }
        }
      }

      const batter = off.team.batters[off.idx];
      off.idx = (off.idx + 1) % 9;
      const pitcher = def.pitcher;
      const pLine = pitching[pitcher.id];
      const tiredBy = Math.max(0, pLine.battersFaced - cfg.starterTiresAfterBatters);
      const pitchValue = pitcher.pitching - tiredBy * 1.0;
      pLine.battersFaced += 1;
      const bLine = batting[batter.id];
      bLine.pa += 1;

      const outcome = rollOutcome(batter, pitchValue, def.team.fielding, rng);
      const speedOf = (id: PlayerId) => off.team.batters.find((b) => b.id === id)?.speed ?? 50;
      const scored: PlayerId[] = [];
      const runnersBefore = bases.filter(Boolean).length;
      const before = snap();
      stepRuns = [];
      let doublePlay = false;

      switch (outcome) {
        case 'strikeout': {
          bLine.ab += 1;
          bLine.so += 1;
          pLine.so += 1;
          outs += 1;
          pLine.outs += 1;
          const risp = bases[1] || bases[2];
          if (outs === 3 && risp) record('strikeout', `${batter.name} strikes out, stranding ${runnersBefore}.`, 0, batter.id);
          break;
        }
        case 'walk': {
          bLine.bb += 1;
          pLine.bb += 1;
          if (bases[0] && bases[1] && bases[2]) scored.push(bases[2]);
          if (bases[0] && bases[1]) bases[2] = bases[1];
          if (bases[0]) bases[1] = bases[0];
          bases[0] = batter.id;
          break;
        }
        case 'single': {
          bLine.ab += 1;
          bLine.h += 1;
          pLine.h += 1;
          hits[battingKey] += 1;
          const [b1, b2, b3] = bases;
          const next: (PlayerId | null)[] = [batter.id, null, null];
          if (b3) scored.push(b3);
          if (b2) {
            if (rng.chance(clamp(0.6 + (speedOf(b2) - 50) * 0.008, 0.3, 0.9))) scored.push(b2);
            else next[2] = b2;
          }
          if (b1) {
            if (!next[2] && rng.chance(clamp(0.28 + (speedOf(b1) - 50) * 0.006, 0.1, 0.55))) next[2] = b1;
            else next[1] = b1;
          }
          bases.splice(0, 3, ...next);
          break;
        }
        case 'double': {
          bLine.ab += 1;
          bLine.h += 1;
          bLine.doubles += 1;
          pLine.h += 1;
          hits[battingKey] += 1;
          const [b1, b2, b3] = bases;
          const next: (PlayerId | null)[] = [null, batter.id, null];
          if (b3) scored.push(b3);
          if (b2) scored.push(b2);
          if (b1) {
            if (rng.chance(clamp(0.42 + (speedOf(b1) - 50) * 0.008, 0.15, 0.75))) scored.push(b1);
            else next[2] = b1;
          }
          bases.splice(0, 3, ...next);
          break;
        }
        case 'triple':
        case 'homeRun': {
          bLine.ab += 1;
          bLine.h += 1;
          pLine.h += 1;
          hits[battingKey] += 1;
          for (const b of [bases[2], bases[1], bases[0]]) if (b) scored.push(b);
          if (outcome === 'triple') {
            bLine.triples += 1;
            bases.splice(0, 3, null, null, batter.id);
          } else {
            bLine.hr += 1;
            scored.push(batter.id);
            bases.splice(0, 3, null, null, null);
          }
          break;
        }
        case 'groundOut': {
          bLine.ab += 1;
          if (bases[0] && outs < 2 && rng.chance(clamp(0.25 + (def.team.fielding - 50) * 0.004 - (batter.speed - 50) * 0.004, 0.05, 0.45))) {
            doublePlay = true;
            outs += 2;
            pLine.outs += 2;
            bases[0] = null;
            if (outs < 3) {
              // Other runners move up one base; a runner from third scores (no RBI on a DP).
              if (bases[2]) {
                scoreRun(bases[2], null);
                bases[2] = null;
              }
              if (bases[1]) {
                bases[2] = bases[1];
                bases[1] = null;
              }
            }
            record('doublePlay', `${batter.name} grounds into a double play.`, 0, batter.id);
            break;
          }
          outs += 1;
          pLine.outs += 1;
          if (outs < 3) {
            if (bases[2] && rng.chance(0.5)) {
              scored.push(bases[2]);
              bases[2] = null;
            }
            if (bases[1] && !bases[2] && rng.chance(0.5)) {
              bases[2] = bases[1];
              bases[1] = null;
            }
          }
          break;
        }
        case 'flyOut': {
          outs += 1;
          pLine.outs += 1;
          if (outs < 3 && bases[2] && rng.chance(clamp(0.5 + (speedOf(bases[2]) - 50) * 0.006, 0.25, 0.8))) {
            // Sacrifice fly: not an at-bat.
            scored.push(bases[2]);
            bases[2] = null;
          } else {
            bLine.ab += 1;
          }
          break;
        }
      }

      for (const id of scored) scoreRun(id, batter.id);

      // Record the plate appearance for the visual match view.
      {
        const after = snap();
        const label: PaOutcome = doublePlay ? 'doublePlay' : outcome === 'flyOut' && stepRuns.length > 0 ? 'sacFly' : outcome;
        const moveOf = (id: PlayerId, from: 0 | 1 | 2 | 3): RunnerMove => {
          const at = after.bases.indexOf(id);
          return { playerId: id, from, to: stepRuns.includes(id) ? 4 : at >= 0 ? ((at + 1) as 1 | 2 | 3) : 'out' };
        };
        const runners: RunnerMove[] = [];
        for (const i of [2, 1, 0] as const) {
          const id = before.bases[i];
          if (id) runners.push(moveOf(id, (i + 1) as 1 | 2 | 3));
        }
        runners.push(moveOf(batter.id, 0));
        const outOrder = doublePlay ? [before.bases[0]!, batter.id] : runners.filter((r) => r.to === 'out').map((r) => r.playerId);
        const meta = playMetadata(`${input.id}:${sequence.length}`, label);
        const fielderId = meta.spot ? fielderAt(meta.spot) : null;
        push({
          kind: 'plateAppearance',
          batterId: batter.id,
          pitcherId: pitcher.id,
          outcome: label,
          before,
          after,
          runners,
          outOrder,
          fielder: meta.spot && fielderId ? { spot: meta.spot, playerId: fielderId } : null,
          ball: meta.ball,
          text: describePlay(batter.name, label, meta.spot, runners.filter((r) => r.to === 4 && r.playerId !== batter.id).map((r) => names[r.playerId]), after.outs),
        });
      }

      if (scored.length > 0 || outcome === 'homeRun' || outcome === 'triple' || outcome === 'double') {
        const runText = scored.filter((id) => id !== batter.id).map((id) => `${names[id]} scores.`).join(' ');
        const verb: Record<Outcome, string> = {
          single: 'singles',
          double: 'doubles',
          triple: 'triples',
          homeRun: scored.length === 4 ? 'hits a grand slam' : scored.length > 1 ? `hits a ${scored.length}-run homer` : 'homers',
          walk: 'draws a bases-loaded walk',
          groundOut: 'grounds out',
          flyOut: 'hits a sacrifice fly',
          strikeout: 'strikes out',
        };
        const kind: PlayKind = outcome === 'flyOut' ? 'sacFly' : (outcome as PlayKind);
        record(kind, `${batter.name} ${verb[outcome]}.${runText ? ' ' + runText : ''}`, scored.length, batter.id);
      }

      if (isWalkOff()) {
        walkOff = true;
        const winner = off.team.name;
        record('walkOff', `Walk-off! ${winner} win it in the ${ordinal(inning)}.`, 0, batter.id);
        return;
      }
    }
  };

  const maxRegular = cfg.innings;
  while (true) {
    inning += 1;
    playHalf('top');
    if (inning >= maxRegular && score.home > score.away) {
      linescore.home.push(null);
      break;
    }
    playHalf('bottom');
    if (walkOff) break;
    if (inning >= maxRegular && score.home !== score.away) break;
    if (inning >= cfg.suddenDeathAfterInning) {
      // Prototype sudden-death: a single weighted decision, shown as its own column.
      const pHome = winProbability(home.strength, away.strength);
      const sdBefore: BaseState = { outs: 3, bases: [null, null, null], score: { ...score } };
      const homeWins = rng.chance(pHome);
      score[homeWins ? 'home' : 'away'] += 1;
      linescore.home.push(homeWins ? 1 : 0);
      linescore.away.push(homeWins ? 0 : 1);
      decidedBy = 'suddenDeath';
      plays.push({
        inning,
        half: 'bottom',
        battingClubId: homeWins ? home.clubId : away.clubId,
        kind: 'suddenDeath',
        text: `Still tied after ${inning}. Prototype sudden-death rule: ${homeWins ? home.name : away.name} take the deciding run.`,
        runs: 1,
        outs: 3,
        score: { ...score },
      });
      sequence.push({
        index: sequence.length,
        inning,
        half: 'bottom',
        kind: 'suddenDeath',
        battingClubId: homeWins ? home.clubId : away.clubId,
        batterId: null,
        pitcherId: side[homeWins ? 'away' : 'home'].pitcher.id,
        outcome: null,
        before: sdBefore,
        after: { outs: 3, bases: [null, null, null], score: { ...score } },
        runners: [],
        outOrder: [],
        fielder: null,
        ball: null,
        text: `Still tied after ${inning}. Prototype sudden-death rule: ${homeWins ? home.name : away.name} take the deciding run.`,
      });
      break;
    }
  }
  if (decidedBy !== 'suddenDeath' && inning > maxRegular) decidedBy = 'extraInnings';

  const winnerName = score.home > score.away ? home.name : away.name;
  plays.push({
    inning,
    half: 'bottom',
    battingClubId: score.home > score.away ? home.clubId : away.clubId,
    kind: 'final',
    text: `Final: ${winnerName} win ${Math.max(score.home, score.away)}–${Math.min(score.home, score.away)}.`,
    runs: 0,
    outs: 3,
    score: { ...score },
  });

  return {
    id: input.id,
    season: input.season,
    round: input.round,
    homeId: home.clubId,
    awayId: away.clubId,
    // Copies: a stored result must not share objects with the clubs' live lineups.
    lineups: structuredClone({ home: home.lineup, away: away.lineup }),
    linescore,
    runs: { ...score },
    hits,
    innings: inning,
    decidedBy,
    walkOff,
    batting,
    pitching,
    pitchersUsed: { home: side.home.used, away: side.away.used },
    plays,
    sequence,
  };
}

// ---------- Presentation metadata recorded by the simulator ----------

type Weighted<T> = [T, number][];

/** Deterministic pick from a hash (never the game RNG). */
function pickBy<T>(h: number, items: Weighted<T>): T {
  const total = items.reduce((a, [, w]) => a + w, 0);
  let roll = (h % 10_000) / 10_000 * total;
  for (const [item, w] of items) {
    if (roll < w) return item;
    roll -= w;
  }
  return items[items.length - 1][0];
}

/** Ball direction on the field: −1 = left-field line, 0 = straight away, 1 = right-field line. */
const SPOT_DIR: Record<FieldSpot, number> = { '3B': -0.55, SS: -0.22, P: 0, '2B': 0.22, '1B': 0.55, LF: -0.6, CF: 0, RF: 0.6, C: 0, DH: 0 };

/**
 * Who handled the ball and where it went. Cosmetic by design: derived from a
 * hash of match id and step index, so it never changes simulated outcomes and
 * always looks the same when replayed.
 */
function playMetadata(key: string, outcome: PaOutcome): { spot: FieldSpot | null; ball: MatchSequence['ball'] } {
  const h = hashSeed(key);
  const h2 = hashSeed(`${key}:b`);
  const jitter = ((h2 % 1000) / 1000 - 0.5) * 0.2;
  const outfield: Weighted<FieldSpot> = [['LF', 1], ['CF', 1.2], ['RF', 1]];
  switch (outcome) {
    case 'strikeout':
    case 'walk':
      return { spot: null, ball: null };
    case 'single': {
      const spot = pickBy(h, outfield);
      return { spot, ball: { type: h2 % 5 < 2 ? 'ground' : 'line', dir: SPOT_DIR[spot] + jitter } };
    }
    case 'double': {
      const spot = pickBy(h, outfield);
      return { spot, ball: { type: h2 % 2 ? 'line' : 'fly', dir: SPOT_DIR[spot] * 1.3 + jitter } };
    }
    case 'triple': {
      const spot = pickBy<FieldSpot>(h, [['CF', 1], ['RF', 1.4]]);
      return { spot, ball: { type: 'fly', dir: SPOT_DIR[spot] + 0.15 + jitter } };
    }
    case 'homeRun': {
      const dir = pickBy(h, [[-0.6, 1], [-0.25, 1], [0, 1], [0.25, 1], [0.6, 1]]);
      return { spot: null, ball: { type: 'over', dir: dir + jitter } };
    }
    case 'groundOut':
    case 'doublePlay': {
      const spot = pickBy<FieldSpot>(h, outcome === 'doublePlay' ? [['SS', 3], ['2B', 3], ['3B', 1.5]] : [['SS', 3], ['2B', 3], ['3B', 2], ['1B', 1.5], ['P', 0.5]]);
      return { spot, ball: { type: 'ground', dir: SPOT_DIR[spot] + jitter / 2 } };
    }
    case 'flyOut':
    case 'sacFly': {
      const spot = pickBy<FieldSpot>(h, outcome === 'sacFly' ? outfield : [...outfield, ['SS', 0.25], ['2B', 0.25], ['3B', 0.15], ['1B', 0.15]]);
      const infield = !['LF', 'CF', 'RF'].includes(spot);
      return { spot, ball: { type: infield ? 'pop' : 'fly', dir: SPOT_DIR[spot] + jitter / 2 } };
    }
  }
}

const SPOT_WORD: Partial<Record<FieldSpot, string>> = {
  LF: 'left', CF: 'center', RF: 'right', SS: 'short', '2B': 'second', '3B': 'third', '1B': 'first', P: 'the pitcher', C: 'the catcher',
};

/** Result text shown after the play has been animated (the view never shows it earlier). */
function describePlay(name: string, outcome: PaOutcome, spot: FieldSpot | null, scorers: string[], outsAfter: number): string {
  const where = spot ? SPOT_WORD[spot] : '';
  const main: Record<PaOutcome, string> = {
    strikeout: `${name} strikes out.`,
    walk: `${name} draws a walk.`,
    single: `${name} singles to ${where}.`,
    double: `${name} doubles to ${where}.`,
    triple: `${name} triples to ${where}.`,
    homeRun: scorers.length === 3 ? `${name} hits a grand slam!` : scorers.length ? `${name} hits a ${scorers.length + 1}-run homer!` : `${name} homers!`,
    groundOut: `${name} grounds out to ${where}.`,
    doublePlay: `${name} grounds into a double play.`,
    flyOut: spot && ['LF', 'CF', 'RF'].includes(spot) ? `${name} flies out to ${where}.` : `${name} pops out to ${where}.`,
    sacFly: `${name} hits a sacrifice fly to ${where}.`,
  };
  const runs = scorers.map((s) => `${s} scores.`).join(' ');
  const end = outsAfter >= 3 ? ' Side retired.' : '';
  return `${main[outcome]}${runs ? ' ' + runs : ''}${end}`;
}

export function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}
