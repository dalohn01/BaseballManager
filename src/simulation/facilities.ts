import { BALANCE } from '../balance/config';
import type { EffectSink } from '../domain/effects';
import type { GameState } from '../domain/state';
import { absoluteRound, nextId, userClub } from '../domain/state';
import type { Club, FacilityId, FacilityModifier } from '../domain/types';
import { FACILITY_LABELS } from './economy';
export { capacityModifier, tickModifiers, trainingModifier } from './economy';
import { trainingFacilityFactor } from './training';

/*
 * Facilities: permanent levels bought directly (no event, no Time) and
 * temporary happenings (modifiers from events). The two are kept apart: a
 * level changes the base effect, a modifier adjusts it for a few matches.
 */

export const FACILITY_IDS: FacilityId[] = ['training', 'scouting', 'stadium'];
export const MAX_FACILITY_LEVEL = 3;

export const FACILITY_TAGLINE: Record<FacilityId, string> = {
  training: 'Give your players better tools to develop.',
  scouting: 'See the true potential of prospects.',
  stadium: 'More seats, more gate income.',
};

export interface FacilityEffectRow {
  label: string;
  value: (level: number) => string;
}

const pct = (x: number) => `${x >= 0 ? '+' : ''}${Math.round(x * 100)}%`;

/** Permanent effects per level, read from the same balance values the game uses. */
export const FACILITY_EFFECTS: Record<FacilityId, FacilityEffectRow[]> = {
  training: [{ label: 'Training progress', value: (l) => `×${trainingFacilityFactor(l).toFixed(1)}` }],
  scouting: [{ label: 'Potential estimate range', value: (l) => `±${BALANCE.recruitment.scoutRangeHalfWidth[l - 1]}` }],
  stadium: [{ label: 'Capacity', value: (l) => `${BALANCE.economy.stadiumCapacity[l - 1].toLocaleString('en-US')} seats` }],
};

const UPKEEP: Record<FacilityId, readonly number[]> = {
  training: BALANCE.economy.trainingUpkeepPerRound,
  scouting: BALANCE.economy.scoutingUpkeepPerRound,
  stadium: BALANCE.economy.stadiumUpkeepPerRound,
};

/** Running cost per round at a level. */
export const facilityUpkeep = (id: FacilityId, level: number) => UPKEEP[id][level - 1];

/** List price to reach the next level, or null at max level. */
export function listPrice(club: Club, id: FacilityId): number | null {
  const lvl = club.facilities[id];
  return lvl >= MAX_FACILITY_LEVEL ? null : BALANCE.facilities.cost[id][lvl - 1];
}

export const modifiersFor = (club: Club, id: FacilityId) => club.modifiers.filter((m) => m.facility === id);
const discountFor = (club: Club, id: FacilityId) => modifiersFor(club, id).find((m) => m.kind === 'upgradeDiscount') ?? null;

/** Price actually charged, after an active sponsor discount. */
export function upgradePrice(club: Club, id: FacilityId): number | null {
  const list = listPrice(club, id);
  if (list === null) return null;
  const d = discountFor(club, id);
  return d ? Math.round(list * (1 - d.value)) : list;
}

/** Money raised by a fundraiser for facilities is a credit toward the price, not free cash. */
export function earmarkedCredit(state: GameState, id: FacilityId): number {
  const price = upgradePrice(userClub(state), id);
  return price === null ? 0 : Math.min(state.actions.earmarked, price);
}

/** Club Cash actually charged: price after discount, minus earmarked fundraiser money. */
export function cashDue(state: GameState, id: FacilityId): number {
  const price = upgradePrice(userClub(state), id);
  return price === null ? 0 : price - earmarkedCredit(state, id);
}

/** Starting a build is a manager initiative: Influence on top of the price (never on happenings' repairs). */
export const UPGRADE_INFLUENCE = BALANCE.actions.facilityUpgrade.influence;

/** Why the facility cannot be upgraded right now, or null. */
export function upgradeBlocker(state: GameState, id: FacilityId): string | null {
  const club = userClub(state);
  if (club.facilities[id] >= MAX_FACILITY_LEVEL) return `Max level reached: the ${FACILITY_LABELS[id]} is at level ${MAX_FACILITY_LEVEL}.`;
  if (club.project?.facility === id) return 'Construction is already under way here.';
  const price = cashDue(state, id);
  if (state.influence < UPGRADE_INFLUENCE) return `Needs ${UPGRADE_INFLUENCE} Influence to start the build (you have ${Math.floor(state.influence)}).`;
  if (club.cash < 0) return 'Cash is negative: new voluntary spending is blocked.';
  const until = club.spendingFreezeUntil;
  if (until > 0 && until >= absoluteRound(state.calendar.season, state.calendar.round)) {
    return `Owners' spending freeze: no voluntary spending until after round ${until - absoluteRound(state.calendar.season, 0)}.`;
  }
  if (club.ownerConfidence < BALANCE.facilities.minOwnerConfidence) {
    return `The owners must back the investment: confidence ${club.ownerConfidence}, needs ${BALANCE.facilities.minOwnerConfidence}.`;
  }
  if (club.cash < price) return `Not enough Club Cash: needs $${price.toLocaleString('en-US')}, you have $${Math.max(0, club.cash).toLocaleString('en-US')}.`;
  return null;
}

/**
 * Buys the next level. The caller has cloned the state and checked the
 * blocker; cash, level, discount use and the ledger change here, once.
 */
export function applyUpgrade(state: GameState, id: FacilityId, sink: EffectSink) {
  const club = userClub(state);
  const credit = earmarkedCredit(state, id);
  const price = cashDue(state, id);
  const before = club.facilities[id];
  const discount = discountFor(club, id);
  const notes = [discount ? `${Math.round(discount.value * 100)}% sponsor discount` : '', credit ? `${credit.toLocaleString('en-US')} from the fundraiser` : ''].filter(Boolean).join(', ');
  if (price > 0) sink.cash(club.id, -price, 'facility', `${FACILITY_LABELS[id]} → level ${before + 1}${notes ? ` (${notes})` : ''}`);
  // Earmarked money is used once, for this purpose only.
  state.actions.earmarked -= credit;
  const inf = state.influence;
  state.influence -= UPGRADE_INFLUENCE;
  sink.record({ targetKind: 'resource', targetId: 'influence', targetLabel: 'Manager', stat: 'influence', statLabel: 'Influence', before: inf, after: state.influence });
  club.facilities[id] = before + 1;
  // A discount is used up by the purchase it applied to.
  if (discount) club.modifiers = club.modifiers.filter((m) => m.id !== discount.id);
  sink.record({ targetKind: 'club', targetId: club.id, targetLabel: FACILITY_LABELS[id], stat: `facility.${id}`, statLabel: 'Level', before, after: before + 1 });
  if (id === 'training') {
    // Chain: the next team session shows what the new Training Center contributed.
    state.followUps.push({
      id: nextId(state, 'fu'),
      templateId: 'team_training',
      dueRound: absoluteRound(state.calendar.season, state.calendar.round) + 1,
      originEventId: null,
      data: { facilityLevel: before + 1, completedRound: state.calendar.round },
    });
  }
}

export function addModifier(state: GameState, clubId: string, m: Omit<FacilityModifier, 'id'>) {
  state.clubs[clubId].modifiers.push({ ...m, id: nextId(state, 'mod') });
}

/** Readable effect of a happening, e.g. "Training progress +15%". */
export function modifierEffect(m: FacilityModifier): string {
  switch (m.kind) {
    case 'upgradeDiscount':
      return `${Math.round(m.value * 100)}% off the next ${FACILITY_LABELS[m.facility]} upgrade`;
    case 'trainingBoost':
      return `Training progress ${pct(m.value)}`;
    case 'capacityCut':
      return `Capacity −${Math.round(m.value * 100)}%`;
  }
}
