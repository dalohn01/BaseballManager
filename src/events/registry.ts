import { boardCheckin, boardEmergency, facilityExpansion, mediaExpectations, mediaSpotlight, sponsorOffer } from './templates/club';
import { fansAfterLoss, fansCommunityDay, fansTicketPrices } from './templates/fanInteraction';
import { individualProspect, individualVeteran, teamScrimmage } from './templates/individualTraining';
import { leagueGame } from './templates/leagueGame';
import { draft, freeAgent, tryouts } from './templates/recruitment';
import { seasonReview } from './templates/seasonReview';
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
  mediaExpectations,
  mediaSpotlight,
  boardCheckin,
  boardEmergency,
  facilityExpansion,
  freeAgent,
  tryouts,
  tradeVeteran,
  tradePitching,
  sponsorOffer,
  leagueGame,
  draft,
  seasonReview,
];

const byId = new Map(TEMPLATES.map((t) => [t.id, t]));

export function getTemplate(id: string): EventTemplate {
  const t = byId.get(id);
  if (!t) throw new Error(`Unknown event template ${id}`);
  return t;
}

export const managementTemplates = () => TEMPLATES.filter((t) => t.slot === 'management');
