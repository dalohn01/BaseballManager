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
    /** Re-scouting recruitment candidates: Influence only, no Time, once per event. */
    rerollCost: 2,
  },

  roster: {
    max: 18,
    minPitchers: 3,
    minHitters: 10,
    /** Releasing a player pays this share of his remaining salary this season. */
    releaseBuyoutShare: 0.5,
  },

  recruitment: {
    /** Signing fee as a share of the season salary. */
    freeAgentFeeShare: 0.25,
    tryoutFee: 2_000,
    draftBonus: 10_000,
    /** Scouting error (±) and shown range half-width per Scouting Department level. */
    scoutError: [6, 4, 2],
    scoutRangeHalfWidth: [8, 5, 3],
  },

  facilities: {
    /** Cost to reach level 2 and level 3. */
    cost: { training: [80_000, 140_000], scouting: [60_000, 110_000], stadium: [120_000, 200_000] },
    buildRounds: { training: 3, scouting: 2, stadium: 4 },
    minOwnerConfidence: 50,
  },

  board: {
    investmentFunds: 40_000,
    investmentMinConfidence: 60,
    emergencyInjection: 60_000,
    emergencyAdDeal: 35_000,
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
    /** Rating points lost per fitness point below 100% (90% → −3, 80% → −6). */
    fitnessPenaltyPerPoint: 0.3,
    satisfactionSwing: 0.06,
    outOfPositionFieldingPenalty: 15,
    starterMaxBattersFaced: 27,
    starterTiresAfterBatters: 18,
    pullAfterRunsAllowed: 6,
    pullMinBattersFaced: 12,
  },

  /**
   * Fitness: match readiness in percent. 100 = fully ready; anything lower is
   * a penalty. Positive numbers below restore fitness, negative ones cost it.
   */
  fitness: {
    /** Everyone recovers this much per round before match load is applied. */
    naturalRecoveryPerRound: 3,
    lineupPerGame: -3,
    benchRecoveryPerGame: 4,
    startingPitcherPerGame: -24,
    reliefPitcherPerGame: -3,
    restingPitcherRecoveryPerGame: 8,
    /** "Rest tired players" sits anyone below this if a replacement exists. */
    restBelow: 90,
    aiRestBelow: 82,
    /** UI thresholds. */
    warnBelow: 85,
    needsRestBelow: 80,
    exhaustedBelow: 72,
  },

  training: {
    /** Progress points toward the next rating point (100 = +1). */
    baseProgress: 32,
    pitcherBaseProgress: 26,
    variance: [0.7, 1.3] as const,
    /** Fitness change per team session. */
    battingFitness: -1,
    defenseFitness: -1,
    recoveryFitness: 3,
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

  seasonPlan: {
    winNow: { winsTarget: 12, budget: 60_000, lossFanMultiplier: 1.5, met: { owners: 8, influence: 3 }, missed: { owners: -12 } },
    rebuild: { prospectStartsTarget: 60, prospectMaxAge: 23, lossFanMultiplier: 0.5, met: { owners: 6, influence: 3, fans: 3 }, missed: { owners: -8 } },
    balanced: { winsTarget: 10, met: { owners: 6, influence: 2 }, missed: { owners: -6 } },
    seasonEndInfluence: 1,
  },

  promises: {
    startsThreshold: 2,
    windowGames: 3,
    madeProspect: 8,
    madeRival: -4,
    kept: 4,
    broken: -8,
    brokenPopularPlayerFans: -2,
  },

  stance: {
    reviewAfterRounds: 4,
    contendLossMultiplier: 1.5,
    patienceLossMultiplier: 0.5,
  },

  offseason: {
    /** Market value per rating point above 30, and the allowed band around the current salary. */
    renewalPerRatingPoint: 1_400,
    renewalBand: [0.85, 1.3] as const,
    renewalMoneyPremium: 0.1,
    renewalSeasons: 2,
    /** Players below this satisfaction refuse to re-sign. */
    renewalMinSatisfaction: 45,
    aiRenewMaxAge: 33,
    minRosterSize: 15,
    ageingFrom: 31,
    fitnessAfterBreak: [94, 100] as const,
    moodDriftToward: 62,
    moodDriftShare: 0.3,
    fanDriftToward: 70,
    fanDriftShare: 0.25,
    pastSeasonsKept: 3,
  },

  lowMood: {
    tradeRequestBelow: 30,
    ultimatumBelow: 35,
    protestBelow: 35,
    freezeRounds: 5,
  },

  /** 0–19 critical, 20–39 unhappy, 40–69 neutral, 70–89 positive, 90–100 very positive. */
  moodBands: [20, 40, 70, 90] as const,
} as const;

export type Balance = typeof BALANCE;
