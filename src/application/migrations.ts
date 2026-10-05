import { withPitchingRatings } from '../domain/pitching';
import { createPlayer, marketSalary } from '../content/playerFactory';
import { defaultStaff, nextStarter, normalizeStaff } from '../domain/staff';
import { hashSeed } from '../domain/rng';
import { absoluteRound } from '../domain/state';
import { BALANCE } from '../balance/config';
import { generatePersonality, personalitySeed, PRIORITY_HINT } from '../domain/personality';
import type { Player } from '../domain/types';
import { defaultPitchingPlan } from '../domain/lineup';
import { bestPitching, emptyBullpen } from '../domain/todayPitching';
import { cycleId, defaultActions, defaultCycle } from '../simulation/cycle';
import { defaultTactics } from '../domain/tactics';
import { createRng } from '../domain/rng';
import { SCHEMA_VERSION, type GameState } from '../domain/state';
import { buildEvent, planPreseason } from '../events/planner';
import { startNextSeason } from '../simulation/season';

type AnyState = Record<string, unknown> & { schemaVersion: number };

/**
 * Upgrades older saves step by step. Never drops data; unknown newer versions
 * are rejected by the caller instead of being touched.
 */
export function migrate(input: AnyState): GameState {
  const s = structuredClone(input) as unknown as GameState & { schemaVersion: number };
  // Older steps build events that read personalities, so every save gets them first (idempotent).
  if (s.schemaVersion < 10) ensurePersonalities(s);
  if (s.schemaVersion === 1) {
    for (const p of Object.values(s.players)) {
      p.contract.startRound ??= 0;
    }
    for (const c of Object.values(s.clubs)) {
      c.project ??= null;
      c.publicStance ??= null;
      if (c.sponsor) {
        c.sponsor.kind ??= 'standard';
        c.sponsor.bonus ??= null;
      }
    }
    for (const ev of [s.currentEvent, s.nextEvent]) {
      if (ev) {
        ev.candidates ??= [];
        ev.rerollCost ??= null;
      }
    }
    s.schemaVersion = 2;
  }
  if (s.schemaVersion === 2) {
    s.promises ??= [];
    s.followUps ??= [];
    s.seasonSummaries ??= [];
    for (const p of Object.values(s.players)) p.pastSeasons ??= [];
    for (const c of Object.values(s.clubs)) {
      c.seasonPlan ??= null;
      c.spendingFreezeUntil ??= 0;
      c.seasonStartCash ??= c.cash;
    }
    // v2 ended a season with no further events; v3 continues into the next season.
    const phase = s.calendar.phase as string;
    const finished = phase === 'seasonComplete' || (s.currentEvent?.type === 'seasonReview' && s.currentEvent.status !== 'pending' && !s.nextEvent);
    if (finished) {
      const rng = createRng(s.rngState);
      startNextSeason(s, rng);
      s.queue = planPreseason(s, rng, s.calendar.season);
      s.currentEvent = buildEvent(s, s.queue.shift()!, rng, s.calendar.season, 0, 0);
      s.nextEvent = null;
      s.rngState = rng.getState();
    } else if (phase === 'seasonComplete') {
      s.calendar.phase = 'regular';
    }
    s.schemaVersion = 3;
  }
  if (s.schemaVersion === 3) {
    // Fatigue (0 = fresh, higher = worse) became fitness in percent (100 = fully ready).
    for (const p of Object.values(s.players) as (typeof s.players)[string][]) {
      const legacy = p as unknown as { fatigue?: number };
      if (legacy.fatigue !== undefined) {
        p.fitness ??= Math.max(0, Math.min(100, Math.round(100 - legacy.fatigue * 0.4)));
        delete legacy.fatigue;
      }
    }
    s.schemaVersion = 4;
  }
  if (s.schemaVersion === 4) {
    // Pitching plans (reliever, rest, hook) became part of each club.
    for (const c of Object.values(s.clubs)) c.pitchingPlan ??= defaultPitchingPlan();
    s.schemaVersion = 5;
  }
  if (s.schemaVersion === 5) {
    // Facility happenings (temporary modifiers) became part of each club.
    for (const c of Object.values(s.clubs)) c.modifiers ??= [];
    // Proposals still waiting in the plan become a happening; an open or pre-built one keeps working (legacy template).
    for (const q of s.queue) if (q.templateId === 'facility_expansion') q.templateId = 'facility_training_clinic';
    s.schemaVersion = 6;
  }
  if (s.schemaVersion === 6) {
    // Tactics: older saves play Balanced and every player follows the team.
    for (const c of Object.values(s.clubs)) c.tactics ??= defaultTactics();
    s.schemaVersion = 7;
  }
  if (s.schemaVersion === 7) {
    // Influence moved to a ×10 scale (it was start 10, costs 2). Converted exactly once:
    // the balance, and any Influence amounts frozen in saved events. A balance above the
    // new cap is kept; income simply pauses until it is below the cap.
    const x10 = (n: number) => Math.round(n * 10);
    s.influence = x10(s.influence ?? 1);
    for (const ev of [s.currentEvent, s.nextEvent]) {
      if (!ev) continue;
      for (const o of ev.options) o.cost.influence = x10(o.cost.influence);
      for (const b of ev.boosts) b.cost.influence = x10(b.cost.influence);
      if (ev.rerollCost !== null && ev.rerollCost !== undefined) ev.rerollCost = x10(ev.rerollCost);
      if (ev.resolution) ev.resolution.costPaid.influence = x10(ev.resolution.costPaid.influence);
    }
    // Satisfaction already uses 0–100 with the club's normal level around 75: values are kept as they are.
    // The round in progress finishes on its old two-event plan (no media, no cycle income for it);
    // the new cycle starts at the next round boundary, when the planner builds club → match → media.
    s.cycle ??= defaultCycle();
    s.actions ??= defaultActions();
    const done = Object.values(s.schedule ?? []).filter((g) => g.result && (g.homeId === s.userClubId || g.awayId === s.userClubId)).length;
    s.cycle.matchesPlayed = done;
    s.cycle.lastClosedId = cycleId(s.calendar.season, s.calendar.round);
    s.schemaVersion = 8;
  }
  if (s.schemaVersion === 8) {
    // Time moved from events to days: a round is club days plus match day, and
    // advancing a day costs the Time. The save is placed on the day of the event
    // in progress; slots that belong to a later day are planned again then.
    const D = BALANCE.season.daysPerRound;
    const cur = s.currentEvent;
    const cal = s.calendar;
    if (cur) {
      cal.season = cur.season;
      cal.round = cur.round;
      cal.phase = cur.round === 0 ? 'preseason' : ['draft', 'contracts', 'seasonReview'].includes(cur.type) ? 'postseason' : 'regular';
    }
    if (cal.phase === 'preseason') cal.day = cur ? 1 : 0;
    else if (cal.phase === 'postseason') cal.day = D + 1;
    else if (cur && (cur.phase === 'club' || (!cur.phase && cur.type !== 'leagueGame'))) {
      cal.day = 1;
      // The game and media of this round come on match day.
      s.queue = s.queue.filter((q) => q.kind === 'management');
      if (s.nextEvent && (s.nextEvent.type === 'leagueGame' || s.nextEvent.round !== cur.round)) s.nextEvent = null;
    } else {
      cal.day = cur ? D : 1;
      // An event already prepared for the next round belongs to a later day.
      if (cur && s.nextEvent && s.nextEvent.round !== cur.round) {
        s.nextEvent = null;
        s.queue = [];
      }
    }
    for (const ev of [s.currentEvent, s.nextEvent]) {
      if (!ev || ev.status !== 'pending') continue;
      for (const o of ev.options) o.cost.time = 0;
      for (const b of ev.boosts) b.cost.time = 0;
    }
    s.schemaVersion = 9;
  }
  if (s.schemaVersion === 9) {
    // The single priority becomes a seven-dimension personality: the old priority
    // sets the main tendency, the rest is generated from the player's own seed.
    // Happiness, skills, contracts, promises, programs and queued events are not
    // touched; already settled effects are not re-run. A player that already has a
    // personality keeps it, so running this again changes nothing.
    ensurePersonalities(s);
    s.schemaVersion = 10;
  }
  if (s.schemaVersion === 10) {
    // Pitching staffs: every club gets two more pitchers (a fuller bullpen, within the
    // roster limit), generated from a fixed per-club seed, and a standing staff built
    // from roles and ratings. Nothing else on existing players changes.
    let n = Math.max(0, ...Object.keys(s.players).map((id) => Number(id.replace(/\D/g, '')) || 0)) + 1;
    const usedNames = new Set(Object.values(s.players).map((p) => `${p.firstName} ${p.lastName}`));
    for (const clubId of s.clubOrder) {
      const club = s.clubs[clubId];
      if (club.staff) continue;
      const pitchers = club.roster.map((id) => s.players[id]).filter((p) => p?.isPitcher);
      const level = pitchers.length ? Math.round(pitchers.reduce((a, p) => a + p.ratings.pitching, 0) / pitchers.length) - 3 : 58;
      const rng = createRng(hashSeed(`v11:${s.seed}:${clubId}`));
      const add = Math.max(0, Math.min(2, BALANCE.roster.max - club.roster.length));
      for (let i = 0; i < add; i++) {
        const id = `p${n++}`;
        const age = 24 + rng.int(0, 8);
        const p = createPlayer(
          { id, clubId, primary: 'P', age, level, upside: rng.int(1, 6), role: 'reserve', salary: marketSalary(level, age), seasonsLeft: 2, startRound: absoluteRound(s.calendar.season, s.calendar.round), joinedSeason: s.calendar.season, scoutingLevel: club.facilities?.scouting ?? 1, usedNames },
          rng,
        );
        s.players[id] = p;
        club.roster.push(id);
      }
      club.staff = defaultStaff(s, clubId);
      club.pitchingPlan = { ...club.pitchingPlan, relieverId: null };
      // Today's starter now comes from the rotation (a pre-match screen still lets the manager change it).
      club.lineup = { ...club.lineup, pitcherId: nextStarter(s, clubId) };
    }
    s.schemaVersion = 11;
  }
  if (s.schemaVersion === 11) {
    // Four-man rotations and at least seven pitchers per club. Missing pitchers are
    // generated from a fixed per-club seed; the rotation grows with the best depth arm
    // (bullpen roles the manager set are kept) and empty roles are filled from depth.
    let n = Math.max(0, ...Object.keys(s.players).map((id) => Number(id.replace(/\D/g, '')) || 0)) + 1;
    const usedNames = new Set(Object.values(s.players).map((p) => `${p.firstName} ${p.lastName}`));
    for (const clubId of s.clubOrder) {
      const club = s.clubs[clubId];
      const pitchers = () => club.roster.map((id) => s.players[id]).filter((p) => p?.isPitcher);
      const level = Math.round(pitchers().reduce((a, p) => a + p.ratings.pitching, 0) / Math.max(1, pitchers().length)) - 3;
      const rng = createRng(hashSeed(`v12:${s.seed}:${clubId}`));
      while (pitchers().length < BALANCE.roster.minPitchers && club.roster.length < BALANCE.roster.max) {
        const id = `p${n++}`;
        const age = 24 + rng.int(0, 8);
        s.players[id] = createPlayer(
          { id, clubId, primary: 'P', age, level, upside: rng.int(1, 6), role: 'reserve', salary: marketSalary(level, age), seasonsLeft: 2, startRound: absoluteRound(s.calendar.season, s.calendar.round), joinedSeason: s.calendar.season, scoutingLevel: club.facilities?.scouting ?? 1, usedNames },
          rng,
        );
        club.roster.push(id);
      }
      const staff = normalizeStaff(s, clubId, club.staff);
      const assigned = () => new Set([...staff.rotation, staff.closer, staff.setup, staff.long].filter(Boolean));
      const depth = () => pitchers().filter((p) => !assigned().has(p.id)).sort((a, b) => b.ratings.pitching - a.ratings.pitching || a.id.localeCompare(b.id));
      while (staff.rotation.length < BALANCE.pitching.rotationSize && depth().length) staff.rotation.push(depth()[0].id);
      for (const r of ['closer', 'setup', 'long'] as const) if (!staff[r] && depth().length) staff[r] = depth()[0].id;
      club.staff = staff;
    }
    s.schemaVersion = 12;
  }
  if (s.schemaVersion === 12) {
    // Pitchers get four values like hitters: pitching splits into velocity and control
    // around the old value (their average stays it), and stamina follows the staff role:
    // the rotation lasts long, the bullpen is short. Hitters get placeholder values.
    const rotation = new Set(s.clubOrder.flatMap((id) => s.clubs[id].staff?.rotation ?? []));
    const upgrade = (p: Player) => {
      if (p.ratings.velocity !== undefined) return;
      const r = withPitchingRatings(p.id, p.isPitcher, p.ratings, rotation.has(p.id) || (!p.clubId && p.role === 'starter'));
      p.ratings = r;
      p.progress = { ...p.progress, velocity: 0, control: 0, stamina: 0 };
    };
    for (const p of Object.values(s.players)) upgrade(p);
    for (const ev of [s.currentEvent, s.nextEvent]) for (const c of ev?.candidates ?? []) upgrade(c);
    s.schemaVersion = 13;
  }
  if (s.schemaVersion === 13) {
    // Pitching is set per game: the standing staff goes, today's relief slots start empty
    // (the strongest are used until the manager sets them). Pitchers' rest is counted in
    // games from now on: each one lands at the start of the rest stage his fitness is in.
    for (const p of Object.values(s.players)) {
      if (!p.isPitcher) continue;
      const stages = BALANCE.modifiers.restStages;
      let stage = 0;
      for (let i = stages.length - 1; i > 0; i--) if (p.fitness >= stages[i].from) { stage = i; break; }
      p.fitness = stages[stage].fitness;
    }
    for (const clubId of s.clubOrder) {
      const club = s.clubs[clubId];
      delete club.staff;
      club.pitchingPlan = { relieverId: null, rest: [], bullpen: emptyBullpen(), hook: club.pitchingPlan?.hook ?? 'balanced' };
      club.lineup = { ...club.lineup, pitcherId: bestPitching(s, clubId).starterId || club.lineup.pitcherId };
    }
    s.schemaVersion = 14;
  }
  if (s.schemaVersion === 14) {
    // Pitchers of record are counted from now on (earlier games have no decisions stored).
    const add = (st: Player['stats']) => {
      st.wins ??= 0;
      st.losses ??= 0;
      st.saves ??= 0;
    };
    const all = [...Object.values(s.players), ...[s.currentEvent, s.nextEvent].flatMap((ev) => ev?.candidates ?? [])];
    for (const p of all) {
      add(p.stats);
      for (const past of p.pastSeasons ?? []) add(past.stats);
    }
    s.schemaVersion = 15;
  }
  if (s.schemaVersion !== SCHEMA_VERSION) throw new Error(`Cannot migrate save v${s.schemaVersion}`);
  return s;
}

export const canMigrate = (version: number) => version >= 1 && version <= SCHEMA_VERSION;

/** v10: the old single priority becomes the main tendency of a generated personality (once per player). */
function ensurePersonalities(s: GameState) {
  const migratePlayer = (p: Player & { priority?: string }) => {
    if (!p.personality) p.personality = generatePersonality(personalitySeed(p.id, `${p.firstName} ${p.lastName}`), PRIORITY_HINT[p.priority ?? ''] ?? {});
    delete p.priority;
    p.reactions ??= [];
  };
  for (const p of Object.values(s.players)) migratePlayer(p);
  for (const ev of [s.currentEvent, s.nextEvent]) for (const c of ev?.candidates ?? []) migratePlayer(c);
}
