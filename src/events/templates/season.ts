import { BALANCE } from '../../balance/config';
import { creditInfluence } from '../../simulation/cycle';
import type { SeasonDirection, SeasonPlan } from '../../domain/state';
import { absoluteRound, playerName, userClub } from '../../domain/state';
import { payrollPerSeason } from '../../simulation/economy';
import { DIRECTION_LABEL, goalProgress, prospectStarts, userRecord } from '../../simulation/goals';
import { expiringPlayers, renewContract, renewalTerms, startNextSeason } from '../../simulation/season';
import { computeStandings } from '../../simulation/standings';
import type { EventTemplate } from '../types';
import { cost, fmt, neg, neutral, pos } from './helpers';

const SP = BALANCE.seasonPlan;

function planFor(direction: SeasonDirection, cashTarget: number, stamp: SeasonPlan['setAt']): SeasonPlan {
  return {
    direction,
    winsTarget: direction === 'winNow' ? SP.winNow.winsTarget : direction === 'balanced' ? SP.balanced.winsTarget : null,
    prospectStartsTarget: direction === 'rebuild' ? SP.rebuild.prospectStartsTarget : null,
    cashTarget: direction === 'balanced' ? cashTarget : null,
    setAt: stamp,
    changes: [],
  };
}

// ---------- Preseason: season direction with the owners ----------

export const seasonPlan: EventTemplate = {
  id: 'season_plan',
  version: 1,
  type: 'boardMeeting',
  slot: 'preseason',
  cooldownRounds: 0,
  weight: () => 1,
  build: ({ state }) => {
    const c = userClub(state);
    const last = state.seasonSummaries[state.seasonSummaries.length - 1];
    return {
      kicker: 'Board Meeting',
      title: `Season ${state.calendar.season} Plan`,
      context: `The owners want a direction and a measurable goal before Opening Day.${last ? ` Last season: ${last.wins}–${last.losses}, finished #${last.position}${last.direction ? `, goal ${last.goalMet ? 'met' : 'missed'}` : ''}.` : ''} Cash ${fmt(c.cash)}.`,
      prompt: 'Which direction do you commit to?',
      subjects: { playerIds: [], clubIds: [] },
      data: {},
      options: [
        {
          id: 'winNow',
          label: 'Win now',
          summary: `Goal: ${SP.winNow.winsTarget}+ wins. The owners fund a push.`,
          certain: [pos(`Club Cash +${fmt(SP.winNow.budget)}`), neg('Fans react harder to losses (×1.5)')],
          uncertain: [neutral(`Met: owners +${SP.winNow.met.owners}, Influence +${SP.winNow.met.influence}. Missed: owners ${SP.winNow.missed.owners}`)],
          cost: cost(),
        },
        {
          id: 'rebuild',
          label: 'Rebuild',
          summary: `Goal: ${SP.rebuild.prospectStartsTarget}+ starts by players aged ≤${SP.rebuild.prospectMaxAge}.`,
          certain: [pos('Fans react more calmly to losses (×0.5)')],
          uncertain: [neutral(`Met: owners +${SP.rebuild.met.owners}, fans +${SP.rebuild.met.fans}, Influence +${SP.rebuild.met.influence}. Missed: owners ${SP.rebuild.missed.owners}`)],
          cost: cost(),
        },
        {
          id: 'balanced',
          label: 'Sustainable contender',
          summary: `Goal: ${SP.balanced.winsTarget}+ wins and end the season with at least today's cash.`,
          certain: [neutral('Normal fan expectations')],
          uncertain: [neutral(`Met: owners +${SP.balanced.met.owners}, Influence +${SP.balanced.met.influence}. Missed: owners ${SP.balanced.missed.owners}`)],
          cost: cost(),
          primary: true,
        },
      ],
      boosts: [],
    };
  },
  resolve: ({ state, sink, option, event }) => {
    const c = userClub(state);
    const direction = option.id as SeasonDirection;
    c.seasonPlan = planFor(direction, c.cash, { season: state.calendar.season, round: state.calendar.round, eventId: event.id });
    if (direction === 'winNow') sink.cash(c.id, SP.winNow.budget, 'event', 'Owners fund a win-now season');
    return {
      headline: `${DIRECTION_LABEL[direction]}: the plan is set.`,
      narrative: [`Goal for the season: ${goalProgress(state)!.items.map((i) => `${i.label} ${i.format === 'cash' ? fmt(i.target) : i.target}+`).join(', ')}. Progress is tracked on Home and Club.`],
    };
  },
};

// ---------- Mid-season course change ----------

export const boardCourseChange: EventTemplate = {
  id: 'board_course_change',
  version: 1,
  type: 'boardMeeting',
  slot: 'management',
  // Off Track comes at the season checkpoints (a third and two thirds in), if the team is behind.
  scheduledOnly: true,
  cooldownRounds: 20,
  weight: (s) => {
    const g = goalProgress(s);
    return g && !g.onTrack && s.calendar.round >= 7 && s.calendar.round <= 14 && g.direction !== 'rebuild' ? 4 : 0;
  },
  build: ({ state }) => {
    const g = goalProgress(state)!;
    const rec = userRecord(state);
    const c = userClub(state);
    return {
      kicker: 'Board Meeting',
      title: 'Off Track',
      context: `You are ${rec.wins}–${rec.losses}. The ${DIRECTION_LABEL[g.direction].toLowerCase()} goal (${g.items.map((i) => `${i.label} ${i.current}/${i.target}`).join(', ')}) is slipping.${c.publicStance?.stance === 'contend' && c.publicStance.season === state.calendar.season ? ' You also told the press you were going for the title.' : ''}`,
      prompt: 'What do you propose?',
      subjects: { playerIds: [], clubIds: [] },
      data: {},
      options: [
        { id: 'stay', label: 'Stay the course', summary: 'Same goal, more conviction.', certain: [neg('Owner confidence −1')], uncertain: [], cost: cost(), primary: true },
        {
          id: 'rebuild',
          label: 'Switch to a rebuild',
          summary: `New goal: ${SP.rebuild.prospectStartsTarget}+ young-player starts (counted from now).`,
          certain: [neg('Owner confidence −6'), neutral('Earlier plan stays on record'), ...(c.publicStance?.stance === 'contend' ? [neg('Fan support −4 (title talk abandoned)')] : [])],
          uncertain: [],
          cost: cost(),
        },
        {
          id: 'lower',
          label: 'Ask for a lower target',
          summary: 'Two fewer wins required.',
          certain: [neg('Owner confidence −4')],
          uncertain: [],
          cost: cost(),
        },
      ],
      boosts: [],
    };
  },
  resolve: ({ state, sink, option, event }) => {
    const c = userClub(state);
    const plan = c.seasonPlan!;
    if (option.id === 'stay') {
      sink.clubMood(c.id, 'ownerConfidence', -1, 'Stayed the course while off track');
      return { headline: '"We believe in this group."', narrative: [] };
    }
    if (option.id === 'lower') {
      sink.clubMood(c.id, 'ownerConfidence', -4, 'Asked for a lower target');
      plan.winsTarget = Math.max(0, (plan.winsTarget ?? 0) - 2);
      return { headline: 'The bar is lowered.', narrative: [`New wins target: ${plan.winsTarget}.`] };
    }
    const from = plan.direction;
    const next = planFor('rebuild', c.cash, { season: state.calendar.season, round: state.calendar.round, eventId: event.id });
    // Starts already made this season still count toward the new target, but the target is scaled to the games left.
    const left = BALANCE.season.rounds - userRecord(state).played;
    next.prospectStartsTarget = prospectStarts(state) + Math.round((SP.rebuild.prospectStartsTarget * left) / BALANCE.season.rounds);
    next.changes = [...plan.changes, { from, to: 'rebuild', round: state.calendar.round }];
    c.seasonPlan = next;
    sink.clubMood(c.id, 'ownerConfidence', -6, `Changed plan mid-season (${DIRECTION_LABEL[from]} → Rebuild)`);
    if (c.publicStance?.stance === 'contend' && c.publicStance.season === state.calendar.season) {
      sink.clubMood(c.id, 'fanSupport', -4, 'Abandoned the title push the club talked up');
    }
    return { headline: 'Change of course: rebuild.', narrative: [`New goal: ${next.prospectStartsTarget}+ young-player starts. The original plan stays in the club history.`] };
  },
};

// ---------- Low owner confidence ----------

export const boardUltimatum: EventTemplate = {
  id: 'board_ultimatum',
  version: 1,
  type: 'boardMeeting',
  slot: 'management',
  cooldownRounds: 6,
  weight: (s) => (userClub(s).ownerConfidence < BALANCE.lowMood.ultimatumBelow && s.cycle.lowStreak.owners >= BALANCE.satisfaction.persistCycles ? 6 : 0),
  build: ({ state }) => {
    const c = userClub(state);
    return {
      kicker: 'Board Meeting',
      title: 'The Owners Are Losing Patience',
      context: `Owner confidence is down to ${c.ownerConfidence}. Latest reason: ${c.reasons.ownerConfidence[0]?.text ?? 'results'}.`,
      prompt: 'How do you respond?',
      subjects: { playerIds: [], clubIds: [] },
      data: {},
      options: [
        {
          id: 'freeze',
          label: 'Accept a spending freeze',
          summary: `No voluntary spending for ${BALANCE.lowMood.freezeRounds} rounds.`,
          certain: [pos('Owner confidence +7'), neg('Signings, projects and paid options blocked')],
          uncertain: [],
          cost: cost(),
          primary: true,
        },
        { id: 'plan', label: 'Present a recovery plan', summary: 'Promise more wins.', certain: [pos('Owner confidence +3'), neg('Wins target +1')], uncertain: [], cost: cost() },
        { id: 'push', label: 'Push back', summary: '"Trust the process."', certain: [neg('Owner confidence −3'), pos('Fan support +2')], uncertain: [], cost: cost() },
      ],
      boosts: [],
    };
  },
  resolve: ({ state, sink, option }) => {
    const c = userClub(state);
    const { season, round } = state.calendar;
    if (option.id === 'freeze') {
      c.spendingFreezeUntil = absoluteRound(season, round + BALANCE.lowMood.freezeRounds);
      sink.clubMood(c.id, 'ownerConfidence', 7, 'Accepted a spending freeze');
      return { headline: 'Spending freeze in place.', narrative: [`Voluntary spending is blocked through round ${round + BALANCE.lowMood.freezeRounds}.`] };
    }
    if (option.id === 'plan') {
      sink.clubMood(c.id, 'ownerConfidence', 3, 'Presented a recovery plan');
      if (c.seasonPlan) c.seasonPlan.winsTarget = (c.seasonPlan.winsTarget ?? 0) + 1;
      return { headline: 'The owners will hold you to it.', narrative: c.seasonPlan ? [`Wins target now ${c.seasonPlan.winsTarget}.`] : [] };
    }
    sink.clubMood(c.id, 'ownerConfidence', -3, 'Pushed back against the owners');
    sink.clubMood(c.id, 'fanSupport', 2, 'Stood up to the owners');
    return { headline: 'Tension in the boardroom.', narrative: ['The fans like it. The owners do not.'] };
  },
};

// ---------- Off-season contracts ----------

export const contracts: EventTemplate = {
  id: 'contracts',
  version: 1,
  type: 'contracts',
  slot: 'seasonEnd',
  cooldownRounds: 0,
  weight: (s) => (expiringPlayers(s, s.userClubId).length > 0 ? 1 : 0),
  build: ({ state }) => {
    const exp = expiringPlayers(state, state.userClubId);
    const willing = exp.filter((p) => renewalTerms(p).willing);
    const young = willing.filter((p) => p.age <= 28);
    const payroll = payrollPerSeason(state, state.userClubId);
    const cost_ = (list: typeof exp) => list.reduce((a, p) => a + renewalTerms(p).salary - p.contract.salary, 0);
    const leaving = (list: typeof exp) => exp.filter((p) => !list.includes(p)).reduce((a, p) => a + p.contract.salary, 0);
    const describe = exp
      .map((p) => `${playerName(p)} (${p.age}, ${fmt(p.contract.salary)}${renewalTerms(p).willing ? ` → asks ${fmt(renewalTerms(p).salary)}` : ', will not re-sign: unhappy'})`)
      .join('; ');
    const next = (list: typeof exp) => payroll + cost_(list) - leaving(list);
    return {
      kicker: 'Contracts',
      title: 'Expiring Contracts',
      context: `${exp.length} contract${exp.length > 1 ? 's end' : ' ends'} this season: ${describe}. Squad holes are filled with cheap replacements.`,
      prompt: 'Who do you keep?',
      subjects: { playerIds: exp.slice(0, 4).map((p) => p.id), clubIds: [] },
      data: {},
      options: [
        {
          id: 'all',
          label: `Re-sign all willing (${willing.length})`,
          summary: `${BALANCE.offseason.renewalSeasons} more seasons each.`,
          certain: [neutral(`Payroll next season ≈ ${fmt(next(willing))}`)],
          uncertain: [],
          cost: cost(),
          primary: true,
        },
        {
          id: 'young',
          label: `Re-sign only age ≤28 (${young.length})`,
          summary: 'Let the veterans go.',
          certain: [neutral(`Payroll next season ≈ ${fmt(next(young))}`), ...(exp.some((p) => p.popularity >= 70 && !young.includes(p)) ? [neg('Fans lose a favourite')] : [])],
          uncertain: [],
          cost: cost(),
        },
        { id: 'none', label: 'Let every contract end', summary: 'Maximum flexibility.', certain: [neutral(`Payroll next season ≈ ${fmt(next([]))}`)], uncertain: [], cost: cost() },
      ],
      boosts: [],
    };
  },
  resolve: ({ state, sink, option }) => {
    const exp = expiringPlayers(state, state.userClubId);
    const willing = exp.filter((p) => renewalTerms(p).willing);
    const keep = option.id === 'all' ? willing : option.id === 'young' ? willing.filter((p) => p.age <= 28) : [];
    for (const p of keep) {
      const before = p.contract.salary;
      renewContract(p);
      sink.record({ targetKind: 'player', targetId: p.id, targetLabel: playerName(p), stat: 'salary', statLabel: 'Salary (re-signed)', before, after: p.contract.salary, format: 'cash' });
    }
    const gone = exp.filter((p) => !keep.includes(p));
    for (const p of gone) {
      if (p.popularity >= 70) sink.clubMood(state.userClubId, 'fanSupport', -3, `Let fan favourite ${p.lastName} leave`);
    }
    return {
      headline: keep.length ? `${keep.length} re-signed, ${gone.length} leaving.` : 'Every expiring contract ends.',
      narrative: [
        keep.length ? `Re-signed: ${keep.map((p) => p.lastName).join(', ')}.` : '',
        gone.length ? `Leaving after the season: ${gone.map((p) => p.lastName).join(', ')}.` : '',
      ].filter(Boolean),
      reactions: keep.slice(0, 1).map((p) => ({ playerId: p.id, text: 'Glad to stay. Let’s build on this.' })),
    };
  },
};

// ---------- Season review: goal evaluation and transition ----------

export const seasonReview: EventTemplate = {
  id: 'season_review',
  version: 2,
  type: 'seasonReview',
  slot: 'seasonEnd',
  cooldownRounds: 0,
  weight: () => 1,
  build: ({ state }) => {
    const table = computeStandings(state);
    const pos_ = table.findIndex((r) => r.clubId === state.userClubId) + 1;
    const row = table[pos_ - 1];
    const champ = state.clubs[table[0].clubId];
    const g = goalProgress(state);
    const bonus = userClub(state).sponsor?.bonus;
    const bonusText = bonus && !bonus.paid ? (pos_ <= 3 ? ` Your sponsor pays a ${fmt(bonus.amount)} top-3 bonus.` : ' No sponsor bonus: you missed the top 3.') : '';
    const goalLine = g ? ` Goal (${DIRECTION_LABEL[g.direction]}): ${g.items.map((i) => `${i.label} ${i.format === 'cash' ? fmt(i.current) : i.current}/${i.format === 'cash' ? fmt(i.target) : i.target}`).join(', ')} — ${g.met ? 'MET' : 'MISSED'}.` : '';
    return {
      kicker: 'Season Review',
      title: `Season ${state.calendar.season} Complete`,
      context: `${champ.city} ${champ.name} are champions. You finished ${pos_} of ${table.length} at ${row.wins}–${row.losses} (run differential ${row.diff >= 0 ? '+' : ''}${row.diff}).${goalLine}${bonusText} Next: ageing, contracts run down and season ${state.calendar.season + 1}.`,
      prompt: 'Close the book on this season.',
      subjects: { playerIds: [], clubIds: [champ.id] },
      data: { position: pos_, wins: row.wins, losses: row.losses },
      options: [{ id: 'close', label: `Start season ${state.calendar.season + 1}`, summary: 'Off-season moves happen now.', certain: [], uncertain: [], cost: { time: 0, cash: 0, influence: 0 }, primary: true }],
      boosts: [],
    };
  },
  resolve: ({ state, rng, sink, event }) => {
    const club = userClub(state);
    const season = state.calendar.season;
    const narrative: string[] = [];
    const bonus = club.sponsor?.bonus;
    if (bonus && !bonus.paid && Number(event.data.position) <= 3) {
      bonus.paid = true;
      sink.cash(club.id, bonus.amount, 'sponsor', `${club.sponsor!.name} top-3 bonus`);
      narrative.push('Sponsor bonus paid.');
    }

    const g = goalProgress(state);
    let influenceGain = SP.seasonEndInfluence;
    if (g) {
      const cfg = SP[g.direction];
      if (g.met) {
        sink.clubMood(club.id, 'ownerConfidence', cfg.met.owners, `Season goal met (${DIRECTION_LABEL[g.direction]})`);
        if ('fans' in cfg.met) sink.clubMood(club.id, 'fanSupport', cfg.met.fans, 'The rebuild is visibly working');
        influenceGain += cfg.met.influence;
        narrative.push(`Goal met: ${DIRECTION_LABEL[g.direction]}.`);
      } else {
        sink.clubMood(club.id, 'ownerConfidence', cfg.missed.owners, `Season goal missed (${DIRECTION_LABEL[g.direction]})`);
        narrative.push(`Goal missed: ${DIRECTION_LABEL[g.direction]}.`);
      }
    } else {
      narrative.push('No season plan was agreed.');
    }
    const before = state.influence;
    creditInfluence(state, influenceGain);
    sink.record({ targetKind: 'resource', targetId: 'influence', targetLabel: 'Manager', stat: 'influence', statLabel: 'Influence', before, after: state.influence });

    const rec = userRecord(state);
    state.seasonSummaries.push({
      season,
      direction: g?.direction ?? null,
      goalMet: g ? g.met : null,
      goalText: g ? g.items.map((i) => `${i.label} ${i.format === 'cash' ? fmt(i.current) : i.current}/${i.format === 'cash' ? fmt(i.target) : i.target}`).join(', ') : '—',
      wins: rec.wins,
      losses: rec.losses,
      position: Number(event.data.position),
      championId: computeStandings(state)[0].clubId,
      cashStart: club.seasonStartCash,
      cashEnd: club.cash,
      payrollEnd: payrollPerSeason(state, club.id),
      fanSupport: club.fanSupport,
      ownerConfidence: club.ownerConfidence,
      prospectStarts: prospectStarts(state),
    });

    const sizeBefore = club.roster.length;
    const report = startNextSeason(state, rng);
    sink.record({ targetKind: 'club', targetId: club.id, targetLabel: 'Roster', stat: 'roster', statLabel: 'Players', before: sizeBefore, after: club.roster.length });
    if (report.departures.length) narrative.push(`Left the club: ${report.departures.join(', ')}.`);
    if (report.replacements.length) narrative.push(`Low-cost replacements signed: ${report.replacements.join(', ')}.`);
    if (report.declines.length) narrative.push(`Ageing: ${report.declines.join(', ')}.`);
    if (report.sponsorEnded) narrative.push(`The ${report.sponsorEnded} deal has ended. Find a new sponsor in preseason.`);
    narrative.push(`Season ${state.calendar.season} begins with preseason.`);
    return { headline: `Season ${season}: ${event.data.wins}–${event.data.losses}, finished #${event.data.position}.`, narrative };
  },
};
