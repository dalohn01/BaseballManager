import { BALANCE } from '../../balance/config';
import { userClub, clubPlayers, shortName } from '../../domain/state';
import { runTeamTraining, type TeamTrainingFocus, avg } from '../../simulation/training';
import type { EventTemplate } from '../types';

const cost = (cash = 0) => ({ time: BALANCE.time.costPerEvent, cash, influence: 0 });
const t = BALANCE.training;

export const teamTraining: EventTemplate = {
  id: 'team_training',
  version: 1,
  type: 'teamTraining',
  slot: 'management',
  cooldownRounds: 0,
  weight: () => 5,
  build: ({ state, followUp }) => {
    const players = clubPlayers(state, state.userClubId);
    const fitness = Math.round(avg(players.map((p) => p.fitness)));
    const tired = players.filter((p) => p.fitness < BALANCE.fitness.warnBelow).sort((a, b) => a.fitness - b.fitness);
    const facility = followUp?.data.facilityLevel
      ? `First session in the upgraded Training Center (level ${followUp.data.facilityLevel}, finished after round ${followUp.data.completedRound}). `
      : '';
    const context =
      facility +
      (tired.length > 0
        ? `Average squad fitness is ${fitness}%. ${tired.slice(0, 2).map(shortName).join(' and ')} ${tired.length > 1 ? 'are' : 'is'} running low.`
        : `Average squad fitness is ${fitness}%. The group is ready to work.`);
    return {
      kicker: 'Team Training',
      title: facility ? 'Training in the New Center' : 'Team Training',
      context,
      prompt: 'Where should we focus today?',
      subjects: { playerIds: tired.slice(0, 2).map((p) => p.id), clubIds: [] },
      data: { newFacility: !!facility },
      options: [
        {
          id: 'batting',
          label: 'Batting',
          summary: 'Cage work for every hitter.',
          certain: [{ text: `Fitness ${t.battingFitness}%`, tone: 'negative' }],
          uncertain: [{ text: 'Contact & Power progress', tone: 'positive' }],
          cost: cost(),
          primary: true,
        },
        {
          id: 'defense',
          label: 'Defense',
          summary: 'Fielding drills and bullpen sessions.',
          certain: [{ text: `Fitness ${t.defenseFitness}%`, tone: 'negative' }],
          uncertain: [{ text: 'Fielding & Pitching progress', tone: 'positive' }],
          cost: cost(),
        },
        {
          id: 'recovery',
          label: 'Recovery',
          summary: 'Light session, physio and rest.',
          certain: [{ text: `Fitness +${t.recoveryFitness}%`, tone: 'positive' }],
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
      narrative.push(`Squad fitness up from ${Math.round(summary.fitnessBefore)}% to ${Math.round(summary.fitnessAfter)}%.`);
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
        ? 'A lighter day. The legs feel fresher.'
        : summary.pointsGained.length > 0
          ? 'Hard work pays off.'
          : 'Progress made.';
    return { headline, narrative, reactions, metrics: { developmentPoints: summary.totalProgress, facilityPoints: summary.facilityContribution } };
  },
};
