import { generateLearningReport } from './learningEngine';
import { generateSegmentedBenchmark } from './segmentedBenchmark';
import { LearningReport } from './learningReport';
import { SegmentedBenchmarkReport } from './segmentedBenchmarkReport';
import { HistoricalLearningAdapterOptions, HistoricalLearningAdapterResult, buildHistoricalLearningDataset } from './historicalLearningAdapter';
import { OosValidationReport, TemporalDatasetSplit, splitDatasetByTime, validatePatternsOutOfSample } from './historicalOosValidation';

export interface HistoricalLearningPipelineResult extends HistoricalLearningAdapterResult {
  segmentedBenchmark: SegmentedBenchmarkReport;
  learningReport: LearningReport;
  temporalSplit: TemporalDatasetSplit | undefined;
  outOfSampleSegmentedBenchmark: SegmentedBenchmarkReport | undefined;
  outOfSampleValidation: OosValidationReport;
}

export function generateHistoricalLearningReport(
  options: HistoricalLearningAdapterOptions = {}
): HistoricalLearningPipelineResult {
  const adapter = buildHistoricalLearningDataset(options);
  if (!adapter.validationReport.valid) {
    throw new Error(`Historical learning dataset is invalid: ${adapter.validationReport.summary.errorCount} error(s).`);
  }

  const temporalSplit = splitDatasetByTime(adapter.dataset);
  const learningDataset = temporalSplit?.train ?? adapter.dataset;
  const segmentedBenchmark = generateSegmentedBenchmark(learningDataset);
  const learningReport = generateLearningReport(segmentedBenchmark);

  if (!temporalSplit) {
    return Object.freeze({
      ...adapter,
      segmentedBenchmark,
      learningReport,
      temporalSplit: undefined,
      outOfSampleSegmentedBenchmark: undefined,
      outOfSampleValidation: Object.freeze({
        status: 'INSUFFICIENT_DATA' as const,
        trainSampleSize: learningDataset.items.length,
        outOfSampleSampleSize: 0,
        validatedPatternCount: 0,
        failedPatternCount: 0,
        insufficientPatternCount: learningReport.patterns.length,
        segmentMissingCount: 0,
        patterns: Object.freeze([]),
      }),
    });
  }

  const outOfSampleSegmentedBenchmark = generateSegmentedBenchmark(temporalSplit.outOfSample);
  const outOfSampleValidation = validatePatternsOutOfSample(
    learningReport.patterns,
    temporalSplit.train.items.length,
    temporalSplit.outOfSample
  );

  return Object.freeze({
    ...adapter,
    segmentedBenchmark,
    learningReport,
    temporalSplit,
    outOfSampleSegmentedBenchmark,
    outOfSampleValidation,
  });
}
