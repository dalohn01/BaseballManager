import { staminaBatters } from '../domain/pitching';
import { teamModifier, teamStatus } from '../domain/effective';
import { bullpenToday, RELIEF_SLOTS as BULLPEN_ROLES, type ReliefSlot as BullpenRole } from '../domain/todayPitching';
import { BALANCE } from '../balance/config';
import { effectiveRating, fieldingAt, offenseScore } from '../domain/lineup';
import { clamp, hashSeed, type Rng } from '../domain/rng';
import type { GameState } from '../domain/state';
import { resolveTactic } from '../domain/tactics';
import type {
  BaseState,
  BattingLine,
  BattingStyle,
  ClubId,
  DecidedBy,
  FieldSpot,
  GameId,
  Lineup,
  MatchResult,
  MatchSequence,
  PaOutcome,
  PitchingLine,
  PitchingStyle,
  PlayKind,
  PlayRecord,
  Player,
  PlayerId,
  RunnerMove,
  RunningStyle,
} from '../domain/types';

/**
 * Lightweight at-bat simulation. Documented simplifications (see README):
 * - no errors, hit-by-pitch, bunts, wild pitches or pinch hitters
 * - up to three pitchers per side: the starter by the hook, then bullpen roles
 *   (long relief early, setup in the 6th–8th, the closer in a 9th-inning save situation)
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
  /** Effective tactics for this player (team plan or his own instruction). */
  batting: BattingStyle;
  running: RunningStyle;
  /** Whether his running comes from his own instruction (for commentary). */
  runningSource: 'instruction' | 'team';
}
interface SimPitcher {
  id: PlayerId;
  name: string;
  /** Derived quality: (velocity + control) / 2, today's effective value. */
  pitching: number;
  velocity: number;
  control: number;
  /** Base stamina: how many batters before he tires. */
  stamina: number;
  style: PitchingStyle;
}
export interface SimTeam {
  clubId: ClubId;
  name: string;
  lineup: Lineup;
  batters: SimBatter[];
  starter: SimPitcher;
  /** Today's bullpen by role (null = no one available for it). */
  bullpen: Record<BullpenRole, SimPitcher | null>;
  /** When this team's starter is replaced (from its pitching plan). */
  hook: { maxBatters: number; pullRuns: number; minBatters: number };
  fielding: number;
  catcherFielding: number;
  strength: number;
}

export function buildSimTeam(state: GameState, clubId: ClubId, lineup: Lineup): SimTeam {
  const club = state.clubs[clubId];
  // Team (the squad's state, temporary boosts and a pep talk) is added to every rating today;
  // Fitness, Morale and Form are already in effectiveRating.
  const status = teamStatus(state, clubId);
  const motivation = (id: PlayerId) => teamModifier(state, state.players[id], status);
  const batters = lineup.battingOrder.map((slot) => {
    const p = state.players[slot.playerId];
    const running = resolveTactic(club.tactics, p.id, 'baserunning');
    const lift = motivation(p.id);
    return {
      id: p.id,
      name: p.lastName,
      contact: effectiveRating(p, 'contact') + lift,
      power: effectiveRating(p, 'power') + lift,
      speed: effectiveRating(p, 'speed') + lift,
      batting: resolveTactic(club.tactics, p.id, 'batting').value as BattingStyle,
      running: running.value as RunningStyle,
      runningSource: running.source === 'instruction' || running.source === 'matchInstruction' ? ('instruction' as const) : ('team' as const),
    };
  });
  const defenders = lineup.battingOrder.filter((s) => s.position !== 'DH');
  const fielding = defenders.reduce((sum, s) => sum + fieldingAt(state.players[s.playerId], s.position), 0) / defenders.length;
  const catcherSlot = defenders.find((s) => s.position === 'C');
  const catcherFielding = catcherSlot ? fieldingAt(state.players[catcherSlot.playerId], 'C') : 40;

  const sp = state.players[lineup.pitcherId];
  const pitchStyle = (id: PlayerId) => resolveTactic(club.tactics, id, 'pitching').value as PitchingStyle;
  const simPitcher = (p: Player): SimPitcher => {
    const lift = motivation(p.id);
    return { id: p.id, name: p.lastName, pitching: effectiveRating(p, 'pitching') + lift, velocity: effectiveRating(p, 'velocity') + lift, control: effectiveRating(p, 'control') + lift, stamina: p.ratings.stamina, style: pitchStyle(p.id) };
  };
  const starter = simPitcher(sp);
  const plan = club.pitchingPlan;
  const pen = bullpenToday(state, clubId, sp.id, plan.bullpen);
  const asSim = (p: Player | null): SimPitcher | null => (p ? simPitcher(p) : null);
  const bullpen = { closer: asSim(pen.closer), setup: asSim(pen.setup), long: asSim(pen.long) };

  return {
    clubId,
    name: club.name,
    lineup,
    batters,
    starter,
    bullpen,
    hook: BALANCE.match.hooks[plan.hook],
    fielding,
    catcherFielding,
    strength: teamStrength(state, lineup),
  };
}

/** Single comprehensible number (0–100-ish) used for forecasts and sudden-death. */
export function teamStrength(state: GameState, lineup: Lineup): number {
  const clubId = state.players[lineup.pitcherId]?.clubId ?? state.players[lineup.battingOrder[0]?.playerId]?.clubId;
  const status = clubId && state.clubs[clubId] ? teamStatus(state, clubId) : null;
  // Team is added to every rating in the simulator, so it lifts each part the same way here.
  const team = (id: PlayerId) => (status ? teamModifier(state, state.players[id], status) : 0);
  const bats = lineup.battingOrder.map((s) => offenseScore(state.players[s.playerId]) + team(s.playerId));
  const offense = bats.reduce((a, b) => a + b, 0) / Math.max(1, bats.length);
  const defenders = lineup.battingOrder.filter((s) => s.position !== 'DH');
  const defense = defenders.reduce((a, s) => a + fieldingAt(state.players[s.playerId], s.position) + team(s.playerId), 0) / Math.max(1, defenders.length);
  const sp = state.players[lineup.pitcherId];
  const pitching = sp ? effectiveRating(sp, 'pitching') + team(sp.id) : 30;
  return offense * 0.45 + defense * 0.2 + pitching * 0.35;
}

export function winProbability(homeStrength: number, awayStrength: number): number {
  const diff = homeStrength + BALANCE.match.homeAdvantage - awayStrength;
  return 1 / (1 + Math.exp(-diff / 7));
}

type Outcome = 'strikeout' | 'walk' | 'single' | 'double' | 'triple' | 'homeRun' | 'groundOut' | 'flyOut';

/**
 * Tactical shifts to the plate-appearance odds. Balanced/Balanced is all zeros
 * and ×1, so it plays exactly as before tactics existed. Player attributes
 * decide how well an instruction is carried out: contact hitters cut more
 * strikeouts, power hitters gain more home runs, better pitchers suffer less
 * when attacking the zone.
 */
export function tacticShift(b: Pick<SimBatter, 'batting' | 'contact' | 'power'>, p: { style: PitchingStyle; pitching: number }) {
  const s = { k: 0, walk: 0, hit: 0, hr: 1, dbl: 1 };
  if (b.batting === 'contact') {
    s.k -= 0.02 + Math.max(0, b.contact - 50) * 0.0006;
    s.hit += 0.008;
    s.hr *= 0.65;
    s.dbl *= 0.9;
  } else if (b.batting === 'power') {
    s.k += Math.max(0.01, 0.03 - (b.power - 50) * 0.0005);
    s.hit -= 0.006;
    s.hr *= 1.15 + Math.max(0, b.power - 40) * 0.012;
    s.dbl *= 1.1;
  }
  if (p.style === 'attack') {
    s.walk -= 0.03;
    s.k += 0.008;
    // Good pitchers can live in the zone; weaker ones get hit.
    s.hit += Math.max(0.002, 0.016 - Math.max(0, p.pitching - 50) * 0.0006);
    s.hr *= 1.1;
  } else if (p.style === 'careful') {
    s.walk += 0.045;
    s.hit -= 0.012;
    s.hr *= 0.8;
  }
  return s;
}

/** Today's values after tiring: velocity decides strikeouts, control walks (and some home runs), their average hits. */
interface PitchNow {
  pitching: number;
  velocity: number;
  control: number;
}

function rollOutcome(b: SimBatter, pitcher: SimPitcher, now: PitchNow, fielding: number, rng: Rng): Outcome {
  const pitching = now.pitching;
  const sh = tacticShift(b, { style: pitcher.style, pitching });
  const O = BALANCE.match.odds;
  const walk = clamp(O.walk + (50 - now.control) * 0.0012 + (b.contact - 50) * 0.0004 + sh.walk, 0.03, 0.16);
  const k = clamp(O.strikeout + (now.velocity - b.contact) * 0.0035 + sh.k, 0.07, 0.4);
  const r = rng.next();
  if (r < k) return 'strikeout';
  if (r < k + walk) return 'walk';
  const hitChance = clamp(O.hit + (b.contact - pitching) * 0.0022 - (fielding - 50) * 0.0018 + sh.hit, 0.18, O.hitMax);
  if (rng.next() < hitChance) {
    // The ceiling only rises when a hitter swings for power; Balanced keeps the old cap.
    // Mistakes over the plate: poor control gives up a few more home runs.
    const mistakes = clamp(1 - (now.control - 60) * 0.004, 0.85, 1.15);
    const hr = clamp((O.homeRunShare + (b.power - 50) * 0.005) * sh.hr * mistakes, 0.02, sh.hr > 1 ? 0.36 : 0.28);
    const triple = clamp(O.tripleShare + (b.speed - 50) * 0.0008, 0.005, 0.05);
    const dbl = clamp((O.doubleShare + (b.power - 50) * 0.002) * sh.dbl, 0.1, 0.3);
    const t = rng.next();
    if (t < hr) return 'homeRun';
    if (t < hr + triple) return 'triple';
    if (t < hr + triple + dbl) return 'double';
    return 'single';
  }
  return rng.chance(0.5) ? 'groundOut' : 'flyOut';
}

/**
 * Batters a pitcher faces before he tires; each batter beyond costs 1 pitching.
 * Attacking the zone saves pitches, working the corners tires him sooner.
 */
export function tiresAfterBatters(style: PitchingStyle = 'balanced', stamina?: number): number {
  const base = stamina === undefined ? BALANCE.match.starterTiresAfterBatters : staminaBatters(stamina);
  return base + (style === 'attack' ? 3 : style === 'careful' ? -4 : 0);
}

/** Chance a runner on first tries to steal second, by speed and running style. */
export function stealAttempt(speed: number, style: RunningStyle): number {
  const O = BALANCE.match.odds;
  const usual = speed >= O.stealMinSpeed ? O.stealBase + (speed - O.stealMinSpeed) * O.stealPerSpeed : 0;
  // Aggressive: slower runners go too, everyone more often. Cautious: only the fastest, rarely.
  if (style === 'aggressive') return speed >= O.stealMinSpeed - 10 ? O.stealBase + 0.03 + (speed - (O.stealMinSpeed - 10)) * O.stealPerSpeed * 1.25 : 0.03;
  if (style === 'cautious') return speed >= O.stealMinSpeed + 10 ? usual * 0.4 : 0;
  return usual;
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
    for (const r of BULLPEN_ROLES) if (t.bullpen[r]) names[t.bullpen[r]!.id] = t.bullpen[r]!.name;
  }
  const P = BALANCE.pitching;
  const isSave = (lead: number) => lead >= P.saveLead[0] && lead <= P.saveLead[1];
  /** Who comes in, by inning and score: long relief early, setup in the middle innings, the closer to save it. */
  const reliefFor = (team: SimTeam, used: PlayerId[], lead: number): { p: SimPitcher; role: BullpenRole } | null => {
    const order: BullpenRole[] =
      inning <= P.longReliefUntilInning ? ['long', 'setup', 'closer'] : inning < cfg.innings ? ['setup', 'long', 'closer'] : isSave(lead) ? ['closer', 'setup', 'long'] : ['setup', 'long', 'closer'];
    for (const role of order) {
      const p = team.bullpen[role];
      if (p && !used.includes(p.id)) return { p, role };
    }
    return null;
  };
  const ROLE_WORD: Record<BullpenRole, string> = { closer: 'closer', setup: 'setup man', long: 'long relief' };

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

    let halfStart = true;
    while (outs < 3) {
      // Pitching changes: the starter by the hook, a tired reliever, or the closer for a save.
      const pl = pitching[def.pitcher.id];
      const lead = score[fieldingKey] - score[battingKey];
      let change: { p: SimPitcher; role: BullpenRole } | null = null;
      if (def.used.length < P.maxPitchersPerGame) {
        const isStarter = def.pitcher.id === def.team.starter.id;
        const closer = def.team.bullpen.closer;
        if (halfStart && inning >= cfg.innings && isSave(lead) && closer && !def.used.includes(closer.id)) change = { p: closer, role: 'closer' };
        else if (isStarter && (pl.battersFaced >= def.team.hook.maxBatters || (pl.r >= def.team.hook.pullRuns && pl.battersFaced >= def.team.hook.minBatters))) change = reliefFor(def.team, def.used, lead);
        else if (!isStarter && pl.battersFaced >= P.relieverMaxBatters) change = reliefFor(def.team, def.used, lead);
      }
      halfStart = false;
      if (change) {
        def.pulled = true;
        const prev = def.pitcher;
        def.pitcher = change.p;
        def.used.push(def.pitcher.id);
        pitching[def.pitcher.id] = emptyPitching();
        const text = `Pitching change: ${def.pitcher.name} (${ROLE_WORD[change.role]}) replaces ${prev.name}.`;
        record('pitchingChange', text, 0);
        const s = snap();
        push({ kind: 'pitchingChange', batterId: null, pitcherId: def.pitcher.id, previousPitcherId: prev.id, outcome: null, before: s, after: s, runners: [], outOrder: [], fielder: null, ball: null, text });
      }

      // Stolen base attempt: runner on first, second open.
      const r1 = bases[0];
      if (r1 && !bases[1] && outs < 2) {
        const runner = off.team.batters.find((b) => b.id === r1)!;
        const usual = stealAttempt(runner.speed, 'balanced');
        const attempt = stealAttempt(runner.speed, runner.running);
        // Only drawn when an attempt is possible (as before), so Balanced keeps the same random stream.
        const roll = attempt > 0 ? rng.next() : 1;
        if (roll < attempt) {
          // The attempt happened only because of the running instruction: tell the viewer.
          const byTactic = roll >= usual ? { playerId: r1, kind: 'steal' as const, source: runner.runningSource } : undefined;
          const success = clamp(BALANCE.match.odds.stealSuccess + (runner.speed - 50) * 0.008 - (def.team.catcherFielding - 50) * 0.004, 0.4, 0.92);
          const before = snap();
          const catcher = fielderAt('C');
          if (rng.chance(success)) {
            bases[1] = r1;
            bases[0] = null;
            batting[r1].sb += 1;
            record('steal', `${runner.name} steals second.`, 0, r1);
            push({ kind: 'steal', batterId: null, pitcherId: def.pitcher.id, outcome: null, before, after: snap(), runners: [{ playerId: r1, from: 1, to: 2 }], outOrder: [], fielder: catcher ? { spot: 'C', playerId: catcher } : null, ball: null, text: `${runner.name} steals second.`, tactic: byTactic });
          } else {
            bases[0] = null;
            outs += 1;
            pitching[def.pitcher.id].outs += 1;
            record('caughtStealing', `${runner.name} is caught stealing.`, 0, r1);
            push({ kind: 'caughtStealing', batterId: null, pitcherId: def.pitcher.id, outcome: null, before, after: snap(), runners: [{ playerId: r1, from: 1, to: 'out' }], outOrder: [r1], fielder: catcher ? { spot: 'C', playerId: catcher } : null, ball: null, text: `${runner.name} is caught stealing.`, tactic: byTactic });
            if (outs >= 3) break;
          }
        }
      }

      const batter = off.team.batters[off.idx];
      off.idx = (off.idx + 1) % 9;
      const pitcher = def.pitcher;
      const pLine = pitching[pitcher.id];
      // Attacking the zone saves pitches; working the corners tires a pitcher sooner.
      const tiredBy = Math.max(0, pLine.battersFaced - tiresAfterBatters(pitcher.style, pitcher.stamina));
      const pitchValue = pitcher.pitching - tiredBy * 1.0;
      const now: PitchNow = { pitching: pitchValue, velocity: pitcher.velocity - tiredBy, control: pitcher.control - tiredBy };
      pLine.battersFaced += 1;
      const bLine = batting[batter.id];
      bLine.pa += 1;

      const outcome = rollOutcome(batter, pitcher, now, def.team.fielding, rng);
      const runnerOf = (id: PlayerId) => off.team.batters.find((b) => b.id === id)!;
      let tacticNote: MatchSequence['tactic'];
      /**
       * An extra-base decision. Balanced uses one draw exactly as before.
       * Aggressive runners go more often; when they go only because of the
       * instruction, a slower runner can be thrown out. Cautious runners hold.
       */
      const sendRunner = (id: PlayerId, usualChance: number): 'safe' | 'held' | 'out' => {
        const r = runnerOf(id);
        const chance = clamp(usualChance + (r.running === 'aggressive' ? 0.15 : r.running === 'cautious' ? -0.08 : 0), 0.02, 0.97);
        const roll = rng.next();
        if (roll >= chance) return 'held';
        if (roll < usualChance) return 'safe';
        // Only the instruction sent him.
        if (rng.chance(clamp(0.35 - (r.speed - 50) * 0.01, 0.06, 0.55))) {
          tacticNote = { playerId: id, kind: 'thrownOut', source: r.runningSource };
          return 'out';
        }
        tacticNote = { playerId: id, kind: 'extraBase', source: r.runningSource };
        return 'safe';
      };
      const runnerOut = () => {
        outs += 1;
        pLine.outs += 1;
      };
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
            const go = sendRunner(b2, clamp(BALANCE.match.odds.scoreFromSecondOnSingle + (speedOf(b2) - 50) * 0.008, 0.3, 0.92));
            if (go === 'safe') scored.push(b2);
            else if (go === 'out') runnerOut();
            else next[2] = b2;
          }
          if (b1 && outs < 3) {
            const go = next[2] ? 'held' : sendRunner(b1, clamp(BALANCE.match.odds.firstToThirdOnSingle + (speedOf(b1) - 50) * 0.006, 0.1, 0.6));
            if (go === 'safe') next[2] = b1;
            else if (go === 'out') runnerOut();
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
            const go = sendRunner(b1, clamp(BALANCE.match.odds.scoreFromFirstOnDouble + (speedOf(b1) - 50) * 0.008, 0.15, 0.8));
            if (go === 'safe') scored.push(b1);
            else if (go === 'out') runnerOut();
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
            // Productive out: the runner on first moves up while the batter is thrown out.
            if (bases[0] && !bases[1] && rng.chance(BALANCE.match.odds.groundOutAdvanceFromFirst)) {
              bases[1] = bases[0];
              bases[0] = null;
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
          // A runner on second tags up and takes third on a deep enough fly.
          if (outs < 3 && bases[1] && !bases[2] && rng.chance(clamp(BALANCE.match.odds.tagSecondToThird + (speedOf(bases[1]) - 50) * 0.006, 0.05, 0.6))) {
            bases[2] = bases[1];
            bases[1] = null;
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
          tactic: tacticNote,
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

  // What each pitcher was told and when each starter was due out, for the match view's pitcher card.
  const pitchStyles: Record<PlayerId, PitchingStyle> = {};
  for (const team of [home, away]) {
    pitchStyles[team.starter.id] = team.starter.style;
    for (const r of BULLPEN_ROLES) if (team.bullpen[r]) pitchStyles[team.bullpen[r]!.id] = team.bullpen[r]!.style;
  }
  return {
    id: input.id,
    season: input.season,
    round: input.round,
    homeId: home.clubId,
    awayId: away.clubId,
    pitchStyles,
    hooks: { home: { ...home.hook, reliever: BULLPEN_ROLES.some((r) => home.bullpen[r]) }, away: { ...away.hook, reliever: BULLPEN_ROLES.some((r) => away.bullpen[r]) } },
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
