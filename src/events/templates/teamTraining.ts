import { BALANCE } from '../../balance/config';
import { userClub, clubPlayers, shortName } from '../../domain/state';
import { runTeamTraining, type TeamTrainingFocus } from '../../simulation/training';
import type { EventTemplate } from '../types';

const cost = (cash = 0) => ({ time: BALANCE.time.costPerEvent, cash, influence: 0 });

export const teamTraining: EventTemplate = {
  id: 'team_training',
  version: 1,
  type: 'teamTraining',
  slot: 'management',
  cooldownRounds: 0,
  weight: () => 5,
  build: ({ followUp }) => {
    const facility = followUp?.data.facilityLevel
      ? `First session in the upgraded Training Center (level ${followUp.data.facilityLevel}, finished after round ${followUp.data.completedRound}). `
      : '';
    const context = facility + 'The group is ready to work.';
    return {
      kicker: 'Team Training',
      title: facility ? 'Training in the New Center' : 'Team Training',
      context,
      prompt: 'Where should we focus today?',
      subjects: { playerIds: [], clubIds: [] },
      data: { newFacility: !!facility },
      options: [
        {
          id: 'batting',
          label: 'Batting',
          summary: 'Cage work for every hitter.',
          certain: [],
          uncertain: [{ text: 'Contact & Power progress', tone: 'positive' }],
          cost: cost(),
          primary: true,
        },
        {
          id: 'defense',
          label: 'Defense',
          summary: 'Fielding drills and bullpen sessions.',
          certain: [],
          uncertain: [{ text: 'Fielding & Pitching progress', tone: 'positive' }],
          cost: cost(),
        },
        {
          id: 'recovery',
          label: 'Team bonding',
          summary: 'A light session and a team dinner.',
          certain: [{ text: 'Squad happiness +1', tone: 'positive' }],
          uncertain: [],
          cost: cost(),
        },
      ],
      boosts: [
        {
          id: 'extra_coaching',
          label: 'Extra coaching',
          description: `+${Math.round((BALANCE.influence.trainingBoostMultiplier - 1) * 100)}% development progress this session`,
          cost: { time: 0, cash: 0, influence: BALANCE.influence.trainingBoostCost },
          appliesTo: ['batting', 'defense'],
        },
      ],
    };
  },
  resolve: ({ state, rng, sink, option, boost }) => {
    const focus = option.id as TeamTrainingFocus;
    const mult = boost ? BALANCE.influence.trainingBoostMultiplier : 1;
    const club = userClub(state);
    const summary = runTeamTraining(state, club.id, focus, mult, rng, sink);
    const narrative: string[] = [];
    const reactions: { playerId: string; text: string }[] = [];

    if (focus === 'recovery') {
      for (const p of clubPlayers(state, club.id)) sink.playerMood(p.id, 'satisfaction', 1, 'Team bonding');
      narrative.push('The squad spent the evening together.');
    } else {
      narrative.push(`${summary.totalProgress} development points across the squad${boost ? ' (extra coaching +50%)' : ''}.`);
      if (summary.group) narrative.push(summary.group.text);
      if (summary.facilityLevel > 1) {
        narrative.push(`Training Center level ${summary.facilityLevel} contributed ${summary.facilityContribution} of those points compared with the old facility.`);
      }
      if (summary.pointsGained.length > 0) {
        const names = summary.pointsGained.map((g) => `${shortName(state.players[g.playerId])} ${g.key} ${g.before}→${g.after}`);
        narrative.push(`Rating gains: ${names.join(', ')}.`);
        const best = summary.pointsGained[0];
        reactions.push({ playerId: best.playerId, text: 'That work is paying off. I can feel it.' });
      } else {
        narrative.push('No rating ticked over this time, but progress carries into the next session.');
      }
      const capped = clubPlayers(state, club.id).filter((p) => !p.isPitcher && p.ratings.contact >= p.potential);
      if (capped.length > 0 && focus === 'batting') {
        narrative.push(`${capped.map(shortName).slice(0, 2).join(', ')} ${capped.length > 1 ? 'are' : 'is'} near their ceiling and gained little.`);
      }
    }
    const headline =
      focus === 'recovery'
        ? 'A lighter day, closer as a group.'
        : summary.pointsGained.length > 0
          ? 'Hard work pays off.'
          : 'Progress made.';
    return { headline, narrative, reactions, metrics: { developmentPoints: summary.totalProgress, facilityPoints: summary.facilityContribution } };
  },
};
