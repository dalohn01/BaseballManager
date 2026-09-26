import type { Club } from '../domain/types';

/** Home ballpark name. One rule everywhere (intro, gate texts, events) so names never disagree. */
export const ballparkName = (club: Pick<Club, 'city'>) => `${club.city} Park`;
