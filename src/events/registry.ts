import { fansAfterLoss, fansCommunityDay, fansTicketPrices } from './templates/fanInteraction';
import { leagueGame } from './templates/leagueGame';
import { seasonReview } from './templates/seasonReview';
import { teamTraining } from './templates/teamTraining';
import type { EventTemplate } from './types';

export const TEMPLATES: EventTemplate[] = [
  teamTraining,
  fansTicketPrices,
  fansCommunityDay,
  fansAfterLoss,
  leagueGame,
  seasonReview,
];

const byId = new Map(TEMPLATES.map((t) => [t.id, t]));

export function getTemplate(id: string): EventTemplate {
  const t = byId.get(id);
  if (!t) throw new Error(`Unknown event template ${id}`);
  return t;
}

export const managementTemplates = () => TEMPLATES.filter((t) => t.slot === 'management');
