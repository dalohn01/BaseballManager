/**
 * All tunable numbers live here. Every value is an MVP test value (see brief §1),
 * not settled balance. Engine code must read from BALANCE instead of hard-coding.
 */
export const BALANCE = {
  season: {
    rounds: 20,
    /** Slots per round: two management events, then the league game. */
    slotsPerRound: ['management', 'management', 'match'] as const,
  },

  time: {
    cap: 12,
    regenIntervalMs: 20 * 60 * 1000,
    costPerEvent: 1,
  },

  influence: {
    start: 10,
    trainingBoostCost: 2,
    trainingBoostMultiplier: 1.5,
  },

  economy: {
    startingCash: 245_000,
    /** Ticket price per level (index 0 = level 1). */
    ticketPrices: [5, 6, 7, 8, 10],
    /** Demand multiplier per price level. */
    ticketDemand: [1.12, 1.04, 0.95, 0.86, 0.74],
    stadiumCapacity: [7000, 8500, 10000],
    stadiumUpkeepPerRound: [1500, 2500, 3500],
    trainingUpkeepPerRound: [1000, 1800, 2600],
    scoutingUpkeepPerRound: [600, 1200, 1800],
  },

  match: {
    innings: 9,
    ghostRunnerFromInning: 10,
    /** After this many innings a clearly labelled prototype sudden-death decides the game. */
    suddenDeathAfterInning: 15,
    homeAdvantage: 1.5,
    fatiguePenaltyPerPoint: 0.12,
    satisfactionSwing: 0.06,
    outOfPositionFieldingPenalty: 15,
    starterMaxBattersFaced: 27,
    starterTiresAfterBatters: 18,
    pullAfterRunsAllowed: 6,
    pullMinBattersFaced: 12,
  },

  fatigue: {
    /** Everyone recovers this much per round before match load is added. */
    naturalRecoveryPerRound: 4,
    lineupPerGame: 6,
    benchRecoveryPerGame: 10,
    startingPitcherPerGame: 38,
    reliefPitcherPerGame: 12,
    restingPitcherRecoveryPerGame: 18,
    restThreshold: 55,
    aiRestThreshold: 65,
  },

  training: {
    /** Progress points toward the next rating point (100 = +1). */
    baseProgress: 32,
    pitcherBaseProgress: 26,
    variance: [0.7, 1.3] as const,
    battingFatigue: 3,
    defenseFatigue: 2,
    recoveryFatigue: -8,
    /** Headroom (potential − rating) at which training reaches full effect. */
    fullEffectHeadroom: 15,
  },

  mood: {
    startedPlayingTimePriority: 1,
    benchedPlayingTimePriority: -2,
    benchedStarterRole: -1,
    /** Fan change = round((won − forecast win chance) × scale): results relative to expectation. */
    fanExpectationScale: 5,
    ownerWin: 1,
    ownerLoss: -1,
  },

  /** 0–19 critical, 20–39 unhappy, 40–69 neutral, 70–89 positive, 90–100 very positive. */
  moodBands: [20, 40, 70, 90] as const,
} as const;

export type Balance = typeof BALANCE;
