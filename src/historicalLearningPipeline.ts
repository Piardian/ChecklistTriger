import { generateLearningReport } from './learningEngine';
import { generateSegmentedBenchmark } from './segmentedBenchmark';
import { LearningReport } from './learningReport';
import { SegmentedBenchmarkReport } from './segmentedBenchmarkReport';
import { HistoricalLearningAdapterOptions, HistoricalLearningAdapterResult, buildHistoricalLearningDataset } from './historicalLearningAdapter';

export interface HistoricalLearningPipelineResult extends HistoricalLearningAdapterResult {
  segmentedBenchmark: SegmentedBenchmarkReport;
  learningReport: LearningReport;
}

export function generateHistoricalLearningReport(
  options: HistoricalLearningAdapterOptions = {}
): HistoricalLearningPipelineResult {
  const adapter = buildHistoricalLearningDataset(options);
  if (!adapter.validationReport.valid) {
    throw new Error(`Historical learning dataset is invalid: ${adapter.validationReport.summary.errorCount} error(s).`);
  }

  const segmentedBenchmark = generateSegmentedBenchmark(adapter.dataset);
  const learningReport = generateLearningReport(segmentedBenchmark);

  return Object.freeze({
    ...adapter,
    segmentedBenchmark,
    learningReport,
  });
}
