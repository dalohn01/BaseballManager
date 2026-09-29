/**
 * All tunable numbers live here. Every value is an MVP test value (see brief §1),
 * not settled balance. Engine code must read from BALANCE instead of hard-coding.
 */
export const BALANCE = {
  season: {
    rounds: 20,
    /** The match cycle: one club event, the league game, then post-match media (3 Time). */
    slotsPerRound: ['management', 'match', 'media'] as const,
  },

  time: {
    cap: 12,
    regenIntervalMs: 20 * 60 * 1000,
    costPerEvent: 1,
  },

  influence: {
    /** Scale 2 (×10 of the first prototype). New games start here; older saves are converted once. */
    start: 180,
    /** Normal storage cap; income never lifts the balance above it (a larger migrated balance is kept). */
    cap: 360,
    trainingBoostCost: 20,
    trainingBoostMultiplier: 1.5,
    /** Re-scouting recruitment candidates: Influence only, no Time, once per event. */
    rerollCost: 20,
    /** Per group: 20 + s/6 + s²/750 → 20 at 0, 40 at 75, 50 at 100 (three equal groups: 60/120/150). */
    contribution: { base: 20, linear: 1 / 6, quadratic: 1 / 750 },
  },

  /** Post-match media: small effects so a good standard reply cannot max out support every match. */
  media: { squad: 1, fans: 1, owners: 1, star: 3, sessionFans: 3, sessionInfluence: 20, spotlightChance: 0.35 },

  satisfaction: {
    /** Balance point every group drifts toward once per closed cycle. */
    neutral: 75,
    /** Share of the distance to neutral recovered per closed cycle. */
    driftRate: 0.05,
    /** Serious events need this many closed cycles in a row below their threshold. */
    persistCycles: 2,
  },

  /** Direct manager actions (Influence, no Time). Durations and cooldowns count completed league games. */
  actions: {
    pepTalk: { influence: 40, ratingBoost: 3 },
    extraTraining: { influence: 60, base: 45, fitness: -2, satisfaction: 2, duration: 1 },
    recovery: { influence: 60, cash: 0, fitnessNow: 10, duration: 1 },
    facilityUpgrade: { influence: 100 },
    boardMeeting: { influence: 80, cooldown: 3, funding: 40_000, fundingConfidenceCost: 4, presentOnTrack: 5, presentBehind: 1, lowerTargetCost: 4 },
    communityInitiative: { influence: 60, cash: 3_000, cooldown: 2, fans: 3, local: 1 },
    fundraiser: { influence: 100, cooldown: 3, duration: 3, amountPerSupport: 200 },
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
    /** Legacy: construction time for projects started in older saves. */
    buildRounds: { training: 3, scouting: 2, stadium: 4 },
    minOwnerConfidence: 50,
    /** Temporary happenings from events (separate from levels). Durations in league games. */
    happenings: {
      sponsorDiscount: 0.2,
      sponsorMatches: 3,
      clinicBoost: 0.15,
      clinicMatches: 3,
      clinicCost: 8_000,
      outageCut: 0.25,
      maintenanceCut: -0.2,
      outageMatches: 2,
      repairCost: 12_000,
    },
  },

  board: {
    investmentFunds: 40_000,
    investmentMinConfidence: 60,
    /** Board money per season, shared by the check-in event and direct meetings. */
    fundingPerSeason: 80_000,
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
    starterTiresAfterBatters: 18,
    /**
     * Match summary standouts: an internal score from this game only. A pick
     * is kept unless someone is better by `margin`; below `minScore` nobody is shown.
     */
    standouts: {
      slots: 2,
      minScore: 2.5,
      margin: 1,
      batter: { hit: 1, extraBase: 0.5, homeRun: 1.5, rbi: 0.8, run: 0.4, walk: 0.4, out: 0.35 },
      /** Pitchers qualify after 6 outs (two innings), so one scoreless out never beats a long outing. */
      pitcher: { minOuts: 6, out: 0.35, strikeout: 0.25, run: 1, hitOrWalk: 0.3 },
    },
    /**
     * Base plate-appearance odds for an average batter (50) against an average
     * pitcher (50) and defense (50), calibrated against MLB league averages
     * (see tests/calibration.test.ts). Ratings shift these per matchup.
     */
    odds: {
      walk: 0.103,
      strikeout: 0.215,
      /** Chance a ball in play (not a strikeout or walk) falls for a hit. */
      hit: 0.362,
      hitMax: 0.47,
      /** Shares of hits that go for extra bases (before power/speed shifts). */
      homeRunShare: 0.095,
      doubleShare: 0.18,
      tripleShare: 0.015,
      /** Balanced baserunning: runners at least this fast try to steal second. */
      stealMinSpeed: 45,
      stealBase: 0.1,
      stealPerSpeed: 0.006,
      stealSuccess: 0.72,
      /**
       * Extra bases on hits for an average runner (50). Set a little above MLB
       * rates to stand in for what the engine does not model (errors, wild
       * pitches, hit batters), so runs per game match real baseball.
       */
      scoreFromSecondOnSingle: 0.66,
      firstToThirdOnSingle: 0.34,
      scoreFromFirstOnDouble: 0.48,
      /** Productive outs: runner on first reaches second on a groundout; runner on second tags to third on a fly out. */
      groundOutAdvanceFromFirst: 0.45,
      tagSecondToThird: 0.3,
    },
    /**
     * When the starter is replaced (one change per game). The starter is pulled after
     * `maxBatters` batters faced, or earlier once he has allowed `pullRuns` runs and
     * faced at least `minBatters`. "balanced" equals the engine's earlier fixed rule.
     */
    hooks: {
      early: { maxBatters: 22, pullRuns: 4, minBatters: 9 },
      balanced: { maxBatters: 27, pullRuns: 6, minBatters: 12 },
      long: { maxBatters: 32, pullRuns: 8, minBatters: 15 },
    },
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
    winNow: { winsTarget: 12, budget: 60_000, lossFanMultiplier: 1.5, met: { owners: 8, influence: 30 }, missed: { owners: -12 } },
    rebuild: { prospectStartsTarget: 60, prospectMaxAge: 23, lossFanMultiplier: 0.5, met: { owners: 6, influence: 30, fans: 3 }, missed: { owners: -8 } },
    balanced: { winsTarget: 10, met: { owners: 6, influence: 20 }, missed: { owners: -6 } },
    seasonEndInfluence: 10,
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

  /** 75 is neutral: 0–34 critical, 35–49 serious, 50–64 uneasy, 65–84 around neutral, 85–100 very positive. */
  moodBands: [35, 50, 65, 85] as const,
} as const;

export type Balance = typeof BALANCE;
