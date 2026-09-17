import { LearnedPattern } from './learningPattern';
import { LearningMetric } from './learningObservation';
import { SegmentKey } from './segmentDefinitions';
import { generateSegmentedBenchmark } from './segmentedBenchmark';
import { ValidatedLabeledDataset, ValidatedLabeledSignal } from './validatedDataset';
import { BenchmarkReport } from './benchmarkReport';

export interface TemporalDatasetSplit {
  train: ValidatedLabeledDataset;
  outOfSample: ValidatedLabeledDataset;
  trainCutoffTimestamp: string;
  outOfSampleStartTimestamp: string;
  trainFraction: number;
  rawTrainCandidateCount: number;
  purgedTrainCount: number;
}

export type OosPatternStatus = 'VALIDATED' | 'FAILED' | 'INSUFFICIENT_SAMPLE' | 'SEGMENT_MISSING';

export interface OosPatternValidation {
  patternId: string;
  segment: SegmentKey;
  value: string;
  metric: LearningMetric;
  status: OosPatternStatus;
  trainDifference: number;
  outOfSampleDifference: number | null;
  outOfSampleSampleSize: number;
  message: string;
}

export interface OosValidationReport {
  status: 'VALIDATED' | 'PARTIAL' | 'INSUFFICIENT_DATA' | 'NO_PATTERNS';
  trainSampleSize: number;
  outOfSampleSampleSize: number;
  validatedPatternCount: number;
  failedPatternCount: number;
  insufficientPatternCount: number;
  segmentMissingCount: number;
  patterns: readonly OosPatternValidation[];
}

export function splitDatasetByTime(
  dataset: ValidatedLabeledDataset,
  trainFraction = 0.7
): TemporalDatasetSplit | undefined {
  if (dataset.items.length < 2) return undefined;
  if (!Number.isFinite(trainFraction) || trainFraction <= 0 || trainFraction >= 1) {
    throw new Error('trainFraction must be > 0 and < 1.');
  }

  const items = [...dataset.items].sort((a, b) => {
    const timeA = Date.parse(a.snapshot.timestamp);
    const timeB = Date.parse(b.snapshot.timestamp);
    return timeA - timeB || a.candidateId.localeCompare(b.candidateId);
  });

  const splitIndex = Math.min(items.length - 1, Math.max(1, Math.floor(items.length * trainFraction)));
  const rawTrainItems = items.slice(0, splitIndex);
  const outOfSampleItems = items.slice(splitIndex);
  const outOfSampleStartTimestamp = outOfSampleItems[0].snapshot.timestamp;
  const boundaryTimestamp = Date.parse(outOfSampleStartTimestamp);

  // Purge training observations whose realized outcome extends into the OOS period.
  // Otherwise the training label contains information from the future relative to the model's split point.
  const trainItems = rawTrainItems.filter(item => {
    const outcomeEnd = item.outcome.metadata.endTimestamp ?? item.outcome.metadata.resolvedAtTimestamp;
    return outcomeEnd === null || outcomeEnd < boundaryTimestamp;
  });

  return {
    train: createSubsetDataset(trainItems),
    outOfSample: createSubsetDataset(outOfSampleItems),
    trainCutoffTimestamp: trainItems.length > 0
      ? trainItems[trainItems.length - 1].snapshot.timestamp
      : rawTrainItems[rawTrainItems.length - 1].snapshot.timestamp,
    outOfSampleStartTimestamp,
    trainFraction: splitIndex / items.length,
    rawTrainCandidateCount: rawTrainItems.length,
    purgedTrainCount: rawTrainItems.length - trainItems.length,
  };
}

export function validatePatternsOutOfSample(
  patterns: readonly LearnedPattern[],
  trainSampleSize: number,
  outOfSample: ValidatedLabeledDataset,
  minimumOosSampleSize = 30
): OosValidationReport {
  if (patterns.length === 0) {
    return Object.freeze({
      status: 'NO_PATTERNS',
      trainSampleSize,
      outOfSampleSampleSize: outOfSample.items.length,
      validatedPatternCount: 0,
      failedPatternCount: 0,
      insufficientPatternCount: 0,
      segmentMissingCount: 0,
      patterns: Object.freeze([]),
    });
  }

  const outOfSampleSegmented = generateSegmentedBenchmark(outOfSample);
  const results: OosPatternValidation[] = [];

  for (const pattern of patterns) {
    const group = outOfSampleSegmented.segments[pattern.segment];
    const segment = group?.[pattern.value];

    if (!segment) {
      results.push(Object.freeze({
        patternId: pattern.id,
        segment: pattern.segment,
        value: pattern.value,
        metric: pattern.metric,
        status: 'SEGMENT_MISSING',
        trainDifference: pattern.comparisonEvidence.difference,
        outOfSampleDifference: null,
        outOfSampleSampleSize: 0,
        message: 'The learned segment value is absent from the out-of-sample dataset.',
      }));
      continue;
    }

    const oosSampleSize = segment.sampleSize;
    if (oosSampleSize < minimumOosSampleSize) {
      results.push(Object.freeze({
        patternId: pattern.id,
        segment: pattern.segment,
        value: pattern.value,
        metric: pattern.metric,
        status: 'INSUFFICIENT_SAMPLE',
        trainDifference: pattern.comparisonEvidence.difference,
        outOfSampleDifference: null,
        outOfSampleSampleSize: oosSampleSize,
        message: `Out-of-sample segment has ${oosSampleSize} observations; ${minimumOosSampleSize} are required for validation.`,
      }));
      continue;
    }

    const overallValue = getMetricValue(outOfSampleSegmented.overallBenchmark, pattern.metric);
    const segmentValue = getMetricValue(segment.benchmark, pattern.metric);
    const difference = round(segmentValue - overallValue);
    const preservedDirection = preservesPatternDirection(pattern.type, difference);

    results.push(Object.freeze({
      patternId: pattern.id,
      segment: pattern.segment,
      value: pattern.value,
      metric: pattern.metric,
      status: preservedDirection ? 'VALIDATED' : 'FAILED',
      trainDifference: pattern.comparisonEvidence.difference,
      outOfSampleDifference: difference,
      outOfSampleSampleSize: oosSampleSize,
      message: preservedDirection
        ? 'Out-of-sample segment preserved the direction of the historical pattern.'
        : 'Out-of-sample segment did not preserve the direction of the historical pattern.',
    }));
  }

  const validatedPatternCount = results.filter(result => result.status === 'VALIDATED').length;
  const failedPatternCount = results.filter(result => result.status === 'FAILED').length;
  const insufficientPatternCount = results.filter(result => result.status === 'INSUFFICIENT_SAMPLE').length;
  const segmentMissingCount = results.filter(result => result.status === 'SEGMENT_MISSING').length;

  let status: OosValidationReport['status'];
  if (validatedPatternCount > 0 && failedPatternCount === 0 && insufficientPatternCount === 0 && segmentMissingCount === 0) {
    status = 'VALIDATED';
  } else if (validatedPatternCount > 0) {
    status = 'PARTIAL';
  } else if (failedPatternCount === 0 && insufficientPatternCount === results.length) {
    status = 'INSUFFICIENT_DATA';
  } else {
    status = 'PARTIAL';
  }

  return Object.freeze({
    status,
    trainSampleSize,
    outOfSampleSampleSize: outOfSample.items.length,
    validatedPatternCount,
    failedPatternCount,
    insufficientPatternCount,
    segmentMissingCount,
    patterns: Object.freeze(results),
  });
}

export function createSubsetDataset(items: readonly ValidatedLabeledSignal[]): ValidatedLabeledDataset {
  return Object.freeze({
    items: Object.freeze([...items]),
    coverage: Object.freeze({
      snapshotCount: items.length,
      labeledCount: items.length,
      missingOutcomeCount: 0,
      coverageRate: items.length === 0 ? 0 : 1,
    }),
  });
}

function getMetricValue(benchmark: BenchmarkReport, metric: LearningMetric): number {
  switch (metric) {
    case 'TPRate': return benchmark.rates.TPRate;
    case 'SLRate': return benchmark.rates.SLRate;
    case 'averageEvaluationBars': return benchmark.duration.averageEvaluationBars;
    case 'averageMFE': return benchmark.excursion.averageMFE;
    case 'averageMAE': return benchmark.excursion.averageMAE;
  }
}

function preservesPatternDirection(type: LearnedPattern['type'], difference: number): boolean {
  if (difference === 0) return false;
  switch (type) {
    case 'PERFORMANCE_ADVANTAGE':
    case 'RISK_DISADVANTAGE':
    case 'EFFICIENCY_DISADVANTAGE':
      return difference > 0;
    case 'PERFORMANCE_DISADVANTAGE':
    case 'RISK_ADVANTAGE':
    case 'EFFICIENCY_ADVANTAGE':
      return difference < 0;
    case 'STABILITY_SIGNAL':
      return true;
  }
}

function round(value: number): number {
  return Math.round(value * 10000) / 10000;
}
