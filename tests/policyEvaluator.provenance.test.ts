import { createDecisionPolicy } from '../src/decisionPolicy';
import { evaluatePolicy } from '../src/policyEvaluator';
import type { LearnedPattern } from '../src/learningPattern';

function buildPattern(): LearnedPattern {
  return {
    id: 'runtime-pattern:test',
    type: 'PERFORMANCE_ADVANTAGE',
    metric: 'TPRate',
    segment: 'grade',
    value: 'A+',
    sampleSize: 100,
    coverage: 1,
    confidence: 'HIGH',
    confidenceFactors: { sample: 'HIGH', coverage: 'HIGH', stability: 'HIGH' },
    comparisonEvidence: {
      metric: 'TPRate',
      segment: { label: 'Grade A+', value: 0.8 },
      baseline: { label: 'overall', value: 0.5 },
      difference: 0.3,
      relativeDifference: 0.6,
    },
    evidence: {
      observationId: 'observation:test',
      segmentBenchmark: { TP: 80, SL: 20, BE: 0, EXPIRED: 0, UNKNOWN: 0, sampleSize: 100, coverage: 1 },
      overallBenchmark: { TP: 80, SL: 20, sampleSize: 100, coverage: 1 },
    },
    summary: 'test',
    explanation: { because: ['test'], formula: 'historical', interpretation: 'DESCRIPTIVE_HISTORICAL_PATTERN' },
    benchmarkReference: { datasetFingerprint: 'runtime:test', benchmarkVersion: 1, segmentedBenchmarkVersion: 1 },
  };
}

test('runtime fingerprints cannot pass historical learning policy even with strong-looking metrics', () => {
  const policy = createDecisionPolicy({
    policyId: 'test-policy',
    name: 'test',
    minimumSampleSize: 30,
    minimumCoverage: 0.8,
    minimumConfidence: 'HIGH',
  });

  const result = evaluatePolicy(buildPattern(), policy);
  const provenance = result.checks.find(check => check.check === 'EVIDENCE_PROVENANCE');

  expect(provenance?.status).toBe('FAIL');
  expect(result.passed).toBe(false);
});
