import { createPlayer, marketSalary } from '../content/playerFactory';
import { defaultStaff, nextStarter } from '../domain/staff';
import { hashSeed } from '../domain/rng';
import { absoluteRound } from '../domain/state';
import { BALANCE } from '../balance/config';
import { generatePersonality, personalitySeed, PRIORITY_HINT } from '../domain/personality';
import type { Player } from '../domain/types';
import { defaultPitchingPlan } from '../domain/lineup';
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
