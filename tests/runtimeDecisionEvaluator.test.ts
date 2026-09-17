import { calibrateDecision } from '../src/decisionCalibration';
import { GradeResult } from '../src/gradeCalculator';
import { generateRuntimeDecisionReport } from '../src/runtimeDecisionEvaluator';

function gradeResult(entryAllowed: boolean, blockReasons: string[] = []): GradeResult {
  return {
    totalScore: entryAllowed ? 8 : 4,
    grade: entryAllowed ? 'A+' : 'B+',
    entryAllowed,
    blockReasons,
    breakdown: {
      htfBiasPD: 2,
      displacement: 2,
      structure: 2,
      sweep: 2,
      poiQuality: entryAllowed ? 1 : 0,
    },
    poiIntegrity: {
      decision: entryAllowed ? 'PASS' : 'FAIL',
      contributingReasons: [],
    },
    liquidityMagnet: null,
    opposingObstacle: null,
  };
}

function calibrationFor(entryAllowed: boolean, blockReasons: string[]) {
  return calibrateDecision({
    tradeDirection: 'long',
    bias4H: 'bullish',
    bias1H: 'bullish',
    pd4H: 'discount',
    pd1H: 'discount',
    pd15M: 'discount',
    poiTestCount: 0,
    grade: entryAllowed ? 'A+' : 'B+',
    score: entryAllowed ? 8 : 4,
    blockReasons,
    breakdown: gradeResult(entryAllowed, blockReasons).breakdown,
  });
}

describe('generateRuntimeDecisionReport', () => {
  test('does not create a historical learning pattern or synthetic TPRate', () => {
    const calibration = calibrationFor(true, []);
    const report = generateRuntimeDecisionReport({
      candidateId: 'candidate-1',
      gradeResult: gradeResult(true),
      calibration,
      policyId: 'runtime-policy:candidate-1',
      policyName: 'Runtime Candidate Admission',
      policyVersion: 1,
    });

    expect(report.metadata.source).toBe('RUNTIME_CANDIDATE');
    expect(report.metadata.learningReportVersion).toBe(0);
    expect(report.metadata.datasetFingerprint).toBe('runtime-candidate:candidate-1');
    expect(report.evaluatedPatterns).toBe(0);
    expect(report.decisions).toHaveLength(1);
    expect(report.decisions[0].status).toBe('ELIGIBLE');
    expect(report.decisions[0].policyResults.checks[0].check).toBe('RUNTIME_CANDIDATE_ADMISSION');
  });

  test('blocks a runtime candidate when grade admission is false', () => {
    const blockReasons = ['4H bias is not directional or conflicts with the trade'];
    const calibration = calibrationFor(false, blockReasons);
    const report = generateRuntimeDecisionReport({
      candidateId: 'candidate-2',
      gradeResult: gradeResult(false, blockReasons),
      calibration,
      policyId: 'runtime-policy:candidate-2',
      policyName: 'Runtime Candidate Admission',
      policyVersion: 1,
    });

    expect(report.decisions[0].status).toBe('FILTERED');
    expect(report.decisions[0].policyResults.passed).toBe(false);
    expect(report.decisions[0].policyResults.checks.some(check => check.status === 'FAIL')).toBe(true);
  });
});
