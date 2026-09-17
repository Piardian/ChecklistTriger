import { DecisionCalibrationResult } from './decisionCalibration';
import { DecisionEvaluation, DecisionEvaluationStatus } from './decisionEvaluation';
import { DECISION_REPORT_VERSION, DecisionReport } from './decisionReport';
import { GradeResult } from './gradeCalculator';
import { PatternPolicyResult } from './policyResult';

export interface RuntimeDecisionInput {
  readonly candidateId: string;
  readonly gradeResult: GradeResult;
  readonly calibration: DecisionCalibrationResult;
  readonly policyId: string;
  readonly policyName: string;
  readonly policyVersion: number;
}

/**
 * Evaluates the current runtime candidate directly from production admission
 * evidence. It deliberately does not construct a LearningReport or fabricate
 * historical metrics such as TPRate, sample size, coverage, or confidence.
 */
export function generateRuntimeDecisionReport(input: RuntimeDecisionInput): DecisionReport {
  const decisionId = `runtime-decision:${input.policyId}:${input.candidateId}`;
  const patternId = `runtime-candidate:${input.candidateId}`;
  const admissionPassed = input.gradeResult.entryAllowed && input.calibration.status === 'ELIGIBLE';
  const status = determineRuntimeStatus(input.gradeResult, input.calibration);
  const policyResults = createRuntimePolicyResult(patternId, input.gradeResult, input.calibration, admissionPassed);

  const decision: DecisionEvaluation = Object.freeze({
    id: decisionId,
    status,
    policyResults,
    reason: Object.freeze(reasonForStatus(status, input.calibration)),
    summary: `${patternId} is ${status} under runtime admission policy ${input.policyId}.`,
    explanation: Object.freeze({
      policyReference: Object.freeze({
        policyId: input.policyId,
        version: input.policyVersion,
      }),
      policyChecks: policyResults.checks,
    }),
    executionEligibility: Object.freeze({
      executable: false as const,
      reason: 'Execution Engine not implemented' as const,
    }),
  });

  return Object.freeze({
    metadata: Object.freeze({
      decisionReportVersion: DECISION_REPORT_VERSION,
      learningReportVersion: 0,
      datasetFingerprint: `runtime-candidate:${input.candidateId}`,
      source: 'RUNTIME_CANDIDATE' as const,
      generatedFromPolicyId: input.policyId,
      generatedFromPolicyVersion: input.policyVersion,
    }),
    policyReference: Object.freeze({
      policyId: input.policyId,
      name: input.policyName,
      version: input.policyVersion,
    }),
    evaluatedPatterns: 0,
    eligiblePatterns: status === 'ELIGIBLE' ? 1 : 0,
    blockedPatterns: status === 'ELIGIBLE' ? 0 : 1,
    decisions: Object.freeze([decision]),
    warnings: Object.freeze([
      Object.freeze({
        type: 'RUNTIME_CANDIDATE_ONLY',
        message: 'Runtime admission is evaluated from current candidate evidence; no historical learning evidence is used.',
      }),
      ...input.calibration.checks
        .filter(check => check.status !== 'PASS')
        .map(check => Object.freeze({ type: check.code, message: check.message })),
    ]),
  });
}

function createRuntimePolicyResult(
  patternId: string,
  gradeResult: GradeResult,
  calibration: DecisionCalibrationResult,
  admissionPassed: boolean
): PatternPolicyResult {
  return Object.freeze({
    patternId,
    passed: admissionPassed,
    checks: Object.freeze([
      Object.freeze({
        check: 'RUNTIME_CANDIDATE_ADMISSION' as const,
        status: admissionPassed ? 'PASS' as const : 'FAIL' as const,
        severity: admissionPassed ? 'INFO' as const : 'ERROR' as const,
        expected: 'entryAllowed=true and calibration=ELIGIBLE',
        actual: Object.freeze({
          entryAllowed: gradeResult.entryAllowed,
          calibrationStatus: calibration.status,
        }),
        message: admissionPassed
          ? 'Runtime candidate satisfies the production admission gates.'
          : `Runtime candidate is blocked by production admission gates: ${[...
              gradeResult.blockReasons,
              ...calibration.checks.filter(check => check.status !== 'PASS').map(check => check.code),
            ].join('; ') || 'runtime admission conditions were not satisfied'}.`,
      }),
      ...calibration.checks.map(check => Object.freeze({
        check: 'RUNTIME_CANDIDATE_ADMISSION' as const,
        status: check.status === 'PASS' ? 'PASS' as const : 'FAIL' as const,
        severity: check.severity,
        expected: 'PASS',
        actual: check.status,
        message: check.message,
      })),
    ]),
  });
}

function determineRuntimeStatus(
  gradeResult: GradeResult,
  calibration: DecisionCalibrationResult
): DecisionEvaluationStatus {
  if (calibration.status !== 'ELIGIBLE') {
    return calibration.status;
  }
  if (!gradeResult.entryAllowed) {
    return 'NOT_ELIGIBLE';
  }
  return 'ELIGIBLE';
}

function reasonForStatus(
  status: DecisionEvaluationStatus,
  calibration: DecisionCalibrationResult
): DecisionEvaluation['reason'] {
  if (calibration.status !== 'ELIGIBLE' && calibration.reason) {
    return calibration.reason;
  }
  if (!calibration.reason && status === 'NOT_ELIGIBLE') {
    return { code: 'NOT_ELIGIBLE', message: 'Current candidate failed production admission gates.' };
  }
  switch (status) {
    case 'ELIGIBLE':
      return { code: 'RUNTIME_ADMISSION_PASSED', message: 'Current candidate passed grade and runtime context admission gates.' };
    case 'WAIT':
      return { code: 'WAIT_FOR_CONTEXT', message: 'Current candidate requires clearer runtime context.' };
    case 'LOW_CONFIDENCE':
      return { code: 'LOW_CONFIDENCE', message: 'Current candidate failed runtime confidence calibration.' };
    case 'FILTERED':
      return { code: 'FILTERED_BY_CONTEXT', message: 'Current candidate failed a hard runtime context filter.' };
    default:
      return { code: 'NOT_ELIGIBLE', message: 'Current candidate failed production admission gates.' };
  }
}
