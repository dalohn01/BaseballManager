import { boardCheckin, boardEmergency, facilityDisruption, facilityExpansion, facilitySponsorDiscount, facilityTrainingClinic, mediaExpectations, mediaSpotlight, sponsorOffer } from './templates/club';
import { fansAfterLoss, fansCommunityDay, fansTicketPrices } from './templates/fanInteraction';
import { fansProtest, mediaStanceReview, promiseFollowUp, tradeRequest } from './templates/followUps';
import { individualProspect, individualVeteran, teamScrimmage } from './templates/individualTraining';
import { leagueGame } from './templates/leagueGame';
import { mediaPostgame } from './templates/media';
import { draft, freeAgent, tryouts } from './templates/recruitment';
import { boardCourseChange, boardUltimatum, contracts, seasonPlan, seasonReview } from './templates/season';
import { teamTraining } from './templates/teamTraining';
import { tradePitching, tradeVeteran } from './templates/trade';
import type { EventTemplate } from './types';

export const TEMPLATES: EventTemplate[] = [
  teamTraining,
  teamScrimmage,
  individualProspect,
  individualVeteran,
  fansTicketPrices,
  fansCommunityDay,
  fansAfterLoss,
  fansProtest,
  mediaExpectations,
  mediaSpotlight,
  boardCheckin,
  boardEmergency,
  boardCourseChange,
  boardUltimatum,
  facilitySponsorDiscount,
  facilityTrainingClinic,
  facilityDisruption,
  facilityExpansion,
  freeAgent,
  tryouts,
  tradeVeteran,
  tradePitching,
  tradeRequest,
  sponsorOffer,
  leagueGame,
  mediaPostgame,
  seasonPlan,
  promiseFollowUp,
  mediaStanceReview,
  draft,
  contracts,
  seasonReview,
];

const byId = new Map(TEMPLATES.map((t) => [t.id, t]));

export function getTemplate(id: string): EventTemplate {
  const t = byId.get(id);
  if (!t) throw new Error(`Unknown event template ${id}`);
  return t;
}

/** Club-slot templates in the weighted pool (calendar-placed board checkpoints excluded). */
export const managementTemplates = () => TEMPLATES.filter((t) => t.slot === 'management' && !t.scheduledOnly);
export const mediaTemplates = () => TEMPLATES.filter((t) => t.slot === 'media');
