export const GRADE_RULEBOOK_VERSION = 'GradeRulebook.v2' as const;

export const GRADE_RULES = Object.freeze({
  thresholds: Object.freeze({ aPlus: 8, a: 6, bPlus: 4, b: 2 }),
  poi: Object.freeze({ overtestedAt: 2, vetoAt: 3, freshCount: 0, reversalSweepMinTests: 1 }),
  aPlus: Object.freeze({
    maxTests: 0,
    requireStrongDisplacement: true,
    requireFullHtfAlignment: true,
    disallowEquilibrium: true,
    disallowOppositePd: true,
    requireSweepConfirmation: true,
  }),
  caps: Object.freeze({
    weakDisplacementMaxGrade: 'B+',
    overtestedMaxGrade: 'B+',
    mixedContinuationHtfMaxGrade: 'B+',
    doubleIntradayPdConflictMaxGrade: 'B+',
    oneHourOppositeWithFourHourEqMaxGrade: 'B+',
    immediateObstacleDistancePips: 15,
    immediateObstacleMaxGrade: 'B+',
  }),
  scoring: Object.freeze({
    fifteenMinuteOppositePdPenalty: 1,
    liquidityMagnetBonus: 1,
  }),
  minEntry: Object.freeze({ displacementGradePoints: 1, maxPoiTests: 1 }),
});

export type GradeRulebookSnapshot = typeof GRADE_RULES & { version: typeof GRADE_RULEBOOK_VERSION };

export function getGradeRulebookSnapshot(): GradeRulebookSnapshot {
  return Object.freeze({ version: GRADE_RULEBOOK_VERSION, ...GRADE_RULES });
}
