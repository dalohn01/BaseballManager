import { applyReaction, fmtDelta, reactionPreview } from './reactions';
import { individualProgram } from './programs';
import { clamp } from '../domain/rng';
import { nd } from '../domain/personality';

/** Next-game boost after a private demand: disciplined players follow through (range in BALANCE.personality). */
export function demandBoost(p: Player): number {
  const [lo, hi] = BALANCE.personality.demandBoostRange;
  return Math.round(BALANCE.actions.pepTalk.ratingBoost * clamp(1 + 0.5 * nd(p.personality.discipline), lo, hi));
}
import { BALANCE } from '../balance/config';
import type { EffectSink } from '../domain/effects';
import type { Rng } from '../domain/rng';
import type { ActionKind, GameState } from '../domain/state';
import { absoluteRound, playerName, userClub } from '../domain/state';
import type { Player } from '../domain/types';
import { growthKeys } from './programs';
import { restLabel, restStage, teamStatus, type RestStage } from '../domain/effective';
import { goalProgress } from './goals';
import { boardFundingLeft, communityBlocker, grantBoardFunding, markCommunity, programBlocker, startProgram } from './locks';

/*
 * Direct manager actions: initiatives paid with Influence (and sometimes
 * money), never Time, and never taking an event slot. Every action checks
 * everything first (actionBlocker) and then applies cost, effect, lock and
 * log together (applyAction) in one cloned state, so a failed or repeated
 * request changes nothing. Locks are shared with the events that describe the
 * same effort (individual programs, the fan forum, board funding).
 */

const A = BALANCE.actions;

export interface ActionOption {
  id: string;
  label: string;
  /** Concrete, known outcome shown before paying. */
  effect: string;
  blocker: string | null;
}

export interface ActionPreview {
  kind: ActionKind;
  title: string;
  target: string | null;
  cost: { influence: number; cash: number };
  effect: string;
  duration: string;
  cooldown: string;
  balanceAfter: number;
  blocker: string | null;
  options?: ActionOption[];
}

const played = (s: GameState) => s.cycle.matchesPlayed;
const since = (s: GameState, key: string) => (s.actions.lastUse[key] === undefined ? Infinity : played(s) - s.actions.lastUse[key]);
const games = (n: number) => `${n} game${n === 1 ? '' : 's'}`;

const spendingBlocker = (s: GameState, cash: number): string | null => {
  const c = userClub(s);
  if (cash <= 0) return null;
  if (c.cash < 0) return 'Cash is negative: new voluntary spending is blocked.';
  if (c.spendingFreezeUntil > 0 && c.spendingFreezeUntil >= absoluteRound(s.calendar.season, s.calendar.round)) return "Owners' spending freeze: no voluntary spending right now.";
  if (c.cash < cash) return `Needs $${cash.toLocaleString('en-US')} Club Cash.`;
  return null;
};

function boardOptions(s: GameState): ActionOption[] {
  const c = userClub(s);
  const B = A.boardMeeting;
  const g = goalProgress(s);
  const left = boardFundingLeft(s);
  const plan = c.seasonPlan;
  return [
    {
      id: 'funding',
      label: 'Request funding',
      effect: `+$${B.funding.toLocaleString('en-US')} Club Cash, owner confidence −${B.fundingConfidenceCost}.`,
      blocker:
        c.ownerConfidence < BALANCE.board.investmentMinConfidence
          ? `The owners need confidence ${BALANCE.board.investmentMinConfidence}+ to invest (now ${Math.round(c.ownerConfidence)}).`
          : left < B.funding
            ? `This season's board budget is used up ($${Math.max(0, left).toLocaleString('en-US')} left).`
            : null,
    },
    {
      id: 'target',
      label: 'Revisit the target',
      effect: `Wins target −2 (the original target stays on record), owner confidence −${B.lowerTargetCost}.`,
      blocker: !plan
        ? 'No season plan has been agreed.'
        : plan.direction === 'rebuild' || plan.winsTarget === null
          ? 'A rebuild has no wins target to revisit.'
          : g?.onTrack
            ? 'You are on track: the owners see no reason to change the target.'
            : null,
    },
    {
      id: 'present',
      label: 'Present your results',
      effect: g ? (g.onTrack ? `On track: owner confidence +${B.presentOnTrack}.` : `Behind the goal: owner confidence +${B.presentBehind}.`) : `No plan to report on: owner confidence +${B.presentBehind}.`,
      blocker: null,
    },
  ];
}

export function actionPreview(s: GameState, kind: ActionKind, target: string | null = null, option: string | null = null): ActionPreview {
  const c = userClub(s);
  const p: Player | null = target ? s.players[target] ?? null : null;
  const mine = !!p && p.clubId === s.userClubId;
  const base = { kind, target, balanceAfter: 0, blocker: null as string | null };
  let r: ActionPreview;
  switch (kind) {
    case 'pepTalk': {
      // Praise (a private positive talk) or set expectations (private criticism): one talk per player per game.
      const demand = option === 'demand';
      const mood = p && mine ? ` Happiness ${fmtDelta(reactionPreview(p, demand ? 'private_criticism' : 'private_praise', demand ? -2 : 2))}.` : '';
      r = demand
        ? { ...base, title: 'Set expectations', cost: { influence: A.pepTalk.influence, cash: 0 }, effect: `A clear, private demand: +${p ? demandBoost(p) : A.pepTalk.ratingBoost} to his ratings in the next league game (his discipline decides how well he follows through).${mood} Does not make an undisciplined player disciplined.`, duration: 'Next league game', cooldown: 'One talk per player per game' }
        : { ...base, title: 'Pep talk', cost: { influence: A.pepTalk.influence, cash: 0 }, effect: `${p ? p.lastName : 'He'} is motivated: +${A.pepTalk.ratingBoost} to his ratings in the next league game.${mood} Does not solve a role problem or a broken promise.`, duration: 'Next league game', cooldown: 'One talk per player per game' };
      if (!mine) r.blocker = 'Choose a player from your squad.';
      else if (s.actions.motivated.includes(p!.id)) r.blocker = `${p!.lastName} is already motivated for the next game.`;
      break;
    }
    case 'tacticsSession': {
      const T = A.tacticsSession;
      const n = since(s, 'tacticsSession');
      const now = teamStatus(s, c.id);
      r = { ...base, title: 'Tactics session', cost: { influence: T.influence, cash: 0 }, effect: `The squad goes through the game plan together: Team +${T.team} for everyone in the next league game (Team ${fmtDelta(now.level)} → ${fmtDelta(Math.min(2, now.level + T.team))}).`, duration: 'Next league game', cooldown: `One session per ${games(T.cooldown)}` };
      if (s.actions.teamBoost) r.blocker = 'The squad has already had a session for the next game.';
      else if (n < T.cooldown) r.blocker = `The next session can be held in ${games(T.cooldown - n)}.`;
      else if (now.level >= 2) r.blocker = 'Team is already at its best (+2).';
      break;
    }
    case 'extraTraining': {
      r = { ...base, title: 'Extra training', cost: { influence: A.extraTraining.influence, cash: 0 }, effect: p ? `Development progress in ${growthKeys(p).join(' and ')} (same session as an individual program), fitness ${A.extraTraining.fitness}, happiness ${fmtDelta(reactionPreview(p, 'development_opportunity', A.extraTraining.satisfaction))}.` : 'Individual development session.', duration: 'Now; program slot until after the next game', cooldown: 'One program per player' };
      if (!mine) r.blocker = 'Choose a player from your squad.';
      else r.blocker = programBlocker(s, p!.id);
      break;
    }
    case 'recovery': {
      r = { ...base, title: 'Recovery program', cost: { influence: A.recovery.influence, cash: A.recovery.cash }, effect: p?.isPitcher ? `One rest stage now (${restLabel(restStage(p))} → ${restLabel(Math.min(3, restStage(p) + 1) as RestStage)}).` : p ? `Fitness +${A.recovery.fitnessNow} now (${p.fitness}% → ${Math.min(100, p.fitness + A.recovery.fitnessNow)}%).` : 'Extra recovery.', duration: 'Now; program slot until after the next game', cooldown: 'One program per player' };
      if (!mine) r.blocker = 'Choose a player from your squad.';
      else r.blocker = programBlocker(s, p!.id) ?? ((p!.isPitcher ? restStage(p!) === 3 : p!.fitness >= 100) ? `${p!.lastName} is already fully fit.` : spendingBlocker(s, A.recovery.cash));
      break;
    }
    case 'boardMeeting': {
      const options = boardOptions(s);
      const chosen = options.find((o) => o.id === option) ?? null;
      const n = since(s, 'boardMeeting');
      r = { ...base, title: 'Board meeting', cost: { influence: A.boardMeeting.influence, cash: 0 }, effect: chosen?.effect ?? 'Choose one item for the agenda.', duration: 'Now', cooldown: `One meeting per ${games(A.boardMeeting.cooldown)}`, options };
      if (n < A.boardMeeting.cooldown) r.blocker = `The owners meet again in ${games(A.boardMeeting.cooldown - n)}.`;
      else if (!chosen) r.blocker = 'Choose one item for the agenda.';
      else r.blocker = chosen.blocker;
      break;
    }
    case 'communityInitiative': {
      const I = A.communityInitiative;
      r = { ...base, title: 'Community initiative', cost: { influence: I.influence, cash: I.cash }, effect: `A supporters' meeting and a local activity: fan support +${I.fans}, local roots +${I.local}.`, duration: 'Now', cooldown: `One per ${games(I.cooldown)} (shared with fan forums)` };
      r.blocker = communityBlocker(s) ?? spendingBlocker(s, I.cash);
      break;
    }
    case 'fundraiser': {
      const F = A.fundraiser;
      const f = s.actions.fundraiser;
      const expected = Math.round(c.fanSupport * F.amountPerSupport);
      r = { ...base, title: 'Fundraiser for the ballpark', cost: { influence: F.influence, cash: 0 }, effect: `Supporters raise money for facility upgrades over ${games(F.duration)}: about $${expected.toLocaleString('en-US')} at today's fan support, paid once as a credit toward the next upgrade (not free cash).`, duration: games(F.duration), cooldown: `One campaign at a time; the next can start ${games(F.cooldown)} after the last started` };
      const n = since(s, 'fundraiser');
      if (f) r.blocker = `A campaign is running (ends after game ${f.endsAt - played(s)} from now).`;
      else if (n < F.cooldown) r.blocker = `The next campaign can start in ${games(F.cooldown - n)}.`;
      break;
    }
  }
  if (!r.blocker && s.influence < r.cost.influence) r.blocker = `Needs ${r.cost.influence} Influence (you have ${Math.floor(s.influence)}).`;
  r.balanceAfter = s.influence - r.cost.influence;
  return r;
}

/** Applies a checked action: cost, effect, lock and log together. Returns a one-line summary. */
export function applyAction(s: GameState, kind: ActionKind, target: string | null, option: string | null, sink: EffectSink, rng: Rng): string {
  const pv = actionPreview(s, kind, target, option);
  const c = userClub(s);
  const infBefore = s.influence;
  s.influence -= pv.cost.influence;
  sink.record({ targetKind: 'resource', targetId: 'influence', targetLabel: 'Manager', stat: 'influence', statLabel: 'Influence', before: infBefore, after: s.influence });
  if (pv.cost.cash > 0) sink.cash(c.id, -pv.cost.cash, 'event', pv.title);
  const p = target ? s.players[target] : null;
  let summary = pv.title;
  switch (kind) {
    case 'pepTalk': {
      const demand = option === 'demand';
      const id = `act-${s.actions.log.length}-${played(s)}:${p!.id}`;
      s.actions.motivated.push(p!.id);
      s.actions.boosts ??= {};
      s.actions.boosts[p!.id] = demand ? demandBoost(p!) : A.pepTalk.ratingBoost;
      s.actions.lastUse[`pepTalk:${p!.id}`] = played(s);
      if (demand) applyReaction(s, sink, p!.id, 'private_criticism', -2, 'Told privately to raise his level', id);
      else applyReaction(s, sink, p!.id, 'private_praise', 2, 'Encouraged in a private talk', id);
      summary = demand ? `Set expectations with ${playerName(p!)}: +${s.actions.boosts[p!.id]} next game.` : `Pep talk with ${playerName(p!)}: motivated for the next game.`;
      break;
    }
    case 'extraTraining': {
      individualProgram(s, sink, rng, p!, { base: A.extraTraining.base, fitness: A.extraTraining.fitness, satisfaction: A.extraTraining.satisfaction, multiplier: 1, source: 'extra training', situationId: `act-${s.actions.log.length}-${played(s)}:${p!.id}` });
      summary = `Extra training for ${playerName(p!)}.`;
      break;
    }
    case 'recovery':
      // A pitcher's rest is a stage: the program moves him one stage up.
      if (p!.isPitcher) sink.playerMood(p!.id, 'fitness', BALANCE.modifiers.restStages[Math.min(3, restStage(p!) + 1)].fitness - p!.fitness, 'Recovery program');
      else sink.playerMood(p!.id, 'fitness', A.recovery.fitnessNow, 'Recovery program');
      startProgram(s, p!.id, 'recovery', 'recovery');
      summary = `Recovery program for ${playerName(p!)}.`;
      break;
    case 'tacticsSession':
      s.actions.lastUse.tacticsSession = played(s);
      s.actions.teamBoost = A.tacticsSession.team;
      summary = `Tactics session: Team +${A.tacticsSession.team} in the next game.`;
      break;
    case 'boardMeeting': {
      const B = A.boardMeeting;
      s.actions.lastUse.boardMeeting = played(s);
      if (option === 'funding') {
        grantBoardFunding(s, B.funding);
        sink.cash(c.id, B.funding, 'event', 'Board meeting: funding');
        sink.clubMood(c.id, 'ownerConfidence', -B.fundingConfidenceCost, 'Asked the owners for more money');
        summary = `Board meeting: +$${B.funding.toLocaleString('en-US')} funding.`;
      } else if (option === 'target') {
        const plan = c.seasonPlan!;
        plan.changes = [...plan.changes, { from: plan.direction, to: plan.direction, round: s.calendar.round }];
        plan.winsTarget = Math.max(0, (plan.winsTarget ?? 0) - 2);
        sink.clubMood(c.id, 'ownerConfidence', -B.lowerTargetCost, 'Asked for a lower target');
        summary = `Board meeting: wins target lowered to ${plan.winsTarget}.`;
      } else {
        const g = goalProgress(s);
        sink.clubMood(c.id, 'ownerConfidence', g?.onTrack ? B.presentOnTrack : B.presentBehind, g?.onTrack ? 'Presented results on track' : 'Presented results behind the goal');
        summary = 'Board meeting: results presented.';
      }
      break;
    }
    case 'communityInitiative': {
      const I = A.communityInitiative;
      markCommunity(s);
      sink.clubMood(c.id, 'fanSupport', I.fans, 'Community initiative');
      sink.brand(c.id, 'local', I.local);
      summary = 'Community initiative held.';
      break;
    }
    case 'fundraiser': {
      const F = A.fundraiser;
      s.actions.lastUse.fundraiser = played(s);
      s.actions.fundraiser = { purpose: 'Ballpark facilities', startedAt: played(s), endsAt: played(s) + F.duration, amount: 0 };
      summary = 'Fundraiser started for the ballpark facilities.';
      break;
    }
  }
  return summary;
}

/** Called once per completed league game: a finished fundraiser pays out once, as earmarked money. */
export function settleFundraiser(s: GameState): number {
  const f = s.actions.fundraiser;
  if (!f || s.cycle.matchesPlayed < f.endsAt) return 0;
  const amount = Math.round(userClub(s).fanSupport * A.fundraiser.amountPerSupport);
  s.actions.earmarked += amount;
  s.actions.fundraiser = null;
  return amount;
}
